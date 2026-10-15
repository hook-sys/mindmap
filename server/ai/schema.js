/**
 * MindMap Studio — AI Schema Validator and Normalizer
 * 
 * Treats AI responses as untrusted input:
 * - Validates JSON schemas
 * - Sanitizes strings & strips HTML/scripts
 * - Prevents circular references & orphans
 * - Generates clean, deterministic node structures matching MindMap Studio format
 * - Pre-computes initial layout coordinates (left-right balance)
 */

const PALETTE = [
  '#4F46E5', // Indigo (Default root)
  '#0284C7', // Sky Blue
  '#0D9488', // Teal
  '#16A34A', // Green
  '#D97706', // Amber
  '#DC2626', // Red
  '#9333EA', // Purple
  '#DB2777'  // Pink
];

/**
 * Sanitizes input string, removing script tags/control chars and capping length
 */
function sanitizeText(str, maxLength = 120, fallback = 'Untitled') {
  if (typeof str !== 'string') {
    if (str === null || str === undefined) return fallback;
    str = String(str);
  }
  let clean = str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/[<>]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();

  if (!clean) return fallback;
  if (clean.length > maxLength) {
    clean = clean.substring(0, maxLength).trim() + '…';
  }
  return clean;
}

/**
 * Robust JSON parser capable of extracting JSON from raw AI text, markdown blocks, etc.
 */
function extractAndParseJson(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Empty AI response received.');
  }

  // 1. Try direct JSON.parse
  try {
    return JSON.parse(rawText.trim());
  } catch (e) {}

  // 2. Try markdown code block extraction (```json ... ``` or ``` ...)
  const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch (e) {}
  }

  // 3. Try finding first '{' and last '}'
  const firstBrace = rawText.indexOf('{');
  const lastBrace = rawText.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = rawText.substring(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch (e) {}
  }

  throw new Error('AI response did not contain a valid JSON payload.');
}

/**
 * Normalizes raw hierarchical mind map into flat node dictionary
 * 
 * Expected raw format:
 * {
 *   title: "...",
 *   rootText: "...",
 *   branches: [
 *     { text: "...", children: [ { text: "...", children: [] } ] }
 *   ]
 * }
 */
function normalizeMindMap(rawData, defaultPrompt = 'New Mind Map') {
  if (!rawData || typeof rawData !== 'object') {
    throw new Error('Invalid mind map data structure: root must be an object.');
  }

  const title = sanitizeText(rawData.title, 80, defaultPrompt);
  const rootText = sanitizeText(rawData.rootText || rawData.title, 80, title);

  const nodes = {};
  const rootId = 'root';

  nodes[rootId] = {
    id: rootId,
    text: rootText,
    parentId: null,
    x: 0,
    y: 0,
    color: '#4F46E5',
    collapsed: false
  };

  const branches = Array.isArray(rawData.branches) ? rawData.branches : [];
  if (branches.length === 0) {
    // Generate at least one starter branch if AI gave empty array
    branches.push({ text: 'Main Branch', children: [] });
  }

  let nodeCounter = 1;

  // Split top-level branches into left and right sides
  const rightBranches = [];
  const leftBranches = [];

  branches.forEach((branch, idx) => {
    if (idx % 2 === 0) {
      rightBranches.push({ branch, colorIdx: (idx + 1) % PALETTE.length });
    } else {
      leftBranches.push({ branch, colorIdx: (idx + 1) % PALETTE.length });
    }
  });

  // Helper to recursively process children
  function addBranch(branchData, parentId, color, direction, depth, yPos) {
    const id = `node_${nodeCounter++}`;
    const text = sanitizeText(branchData.text || branchData.title, 100, `Topic ${nodeCounter}`);
    const x = depth === 1 ? direction * 240 : (nodes[parentId].x + direction * 220);

    nodes[id] = {
      id,
      text,
      parentId,
      x,
      y: yPos,
      color,
      collapsed: false
    };

    const children = Array.isArray(branchData.children) ? branchData.children : [];
    if (children.length > 0) {
      const childCount = children.length;
      let startY = yPos - ((childCount - 1) * 60) / 2;
      children.forEach((c) => {
        addBranch(c, id, color, direction, depth + 1, startY);
        startY += 65;
      });
    }
  }

  // Layout right side
  let rightY = -((rightBranches.length - 1) * 80) / 2;
  rightBranches.forEach(({ branch, colorIdx }) => {
    const branchColor = PALETTE[colorIdx] || PALETTE[1];
    addBranch(branch, rootId, branchColor, 1, 1, rightY);
    rightY += 85;
  });

  // Layout left side
  let leftY = -((leftBranches.length - 1) * 80) / 2;
  leftBranches.forEach(({ branch, colorIdx }) => {
    const branchColor = PALETTE[colorIdx] || PALETTE[2];
    addBranch(branch, rootId, branchColor, -1, 1, leftY);
    leftY += 85;
  });

  return {
    title,
    rootId,
    nodes
  };
}

/**
 * Normalizes expanded child nodes for a target parent node
 * 
 * Expected raw format:
 * {
 *   expandedNodes: ["Child 1", "Child 2", ...]
 * }
 * or simply an array of strings.
 */
function normalizeExpandedNodes(rawData, parentNode, existingNodes = {}) {
  let list = [];
  if (Array.isArray(rawData)) {
    list = rawData;
  } else if (rawData && Array.isArray(rawData.expandedNodes)) {
    list = rawData.expandedNodes;
  } else if (rawData && Array.isArray(rawData.children)) {
    list = rawData.children;
  }

  if (list.length === 0) {
    throw new Error('AI did not provide any expansion nodes.');
  }

  const existingIds = new Set(Object.keys(existingNodes));
  const newNodes = [];

  // Determine direction based on parent position relative to root
  const isRightSide = (parentNode.x >= 0);
  const direction = isRightSide ? 1 : -1;
  const childX = parentNode.x + (direction * 220);

  const count = Math.min(list.length, 7); // Cap to 7 to prevent clutter
  let startY = parentNode.y - ((count - 1) * 60) / 2;

  for (let i = 0; i < count; i++) {
    const rawItem = list[i];
    const textStr = typeof rawItem === 'string' ? rawItem : (rawItem.text || rawItem.title || 'Subtopic');
    const cleanText = sanitizeText(textStr, 100, `Idea ${i + 1}`);

    // Generate unique ID that never collides
    let newId;
    let attempts = 0;
    do {
      newId = `ai_exp_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
      attempts++;
    } while (existingIds.has(newId) && attempts < 100);

    existingIds.add(newId);

    newNodes.push({
      id: newId,
      text: cleanText,
      parentId: parentNode.id,
      x: childX,
      y: Math.round(startY),
      color: parentNode.color || '#4F46E5',
      collapsed: false
    });

    startY += 65;
  }

  return newNodes;
}

module.exports = {
  sanitizeText,
  extractAndParseJson,
  normalizeMindMap,
  normalizeExpandedNodes,
  PALETTE
};
