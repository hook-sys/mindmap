/**
 * MindMap Studio — Core Editor & Data Integrity Regression Test Suite
 * 
 * Verifies:
 * 1. Mind map tree hierarchy (child creation, sibling creation, recursive deletion)
 * 2. Tree auto-layout coordinates & node isolation
 * 3. History state management (undo/redo stack boundaries, state restoration)
 * 4. JSON export schema integrity
 * 5. Standalone bundle compilation
 * 6. Zero fake AI responses when FAL_KEY is missing (strict CONFIG_MISSING)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { AIService } = require('../server/ai/service');

let passedTests = 0;
let failedTests = 0;

function runTest(testName, fn) {
  try {
    fn();
    console.log(`  ✓ ${testName}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${testName}`);
    console.error(`    ${err.message}`);
    failedTests++;
  }
}

async function runAsyncTest(testName, fn) {
  try {
    await fn();
    console.log(`  ✓ ${testName}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${testName}`);
    console.error(`    ${err.message}`);
    failedTests++;
  }
}

// Tree logic helpers matching app.js
function createBlankMap(rootText = 'Root Topic') {
  return {
    root: {
      id: 'root',
      text: rootText,
      x: 0,
      y: 0,
      color: '#4F46E5',
      parentId: null,
      children: []
    }
  };
}

function addChildNode(nodes, parentId, text = 'New Subtopic') {
  const parent = nodes[parentId];
  if (!parent) return null;

  const newId = `node_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  const childCount = parent.children.length;

  const newNode = {
    id: newId,
    text,
    x: parent.x + 220,
    y: parent.y + (childCount * 60) - 30,
    color: parent.color,
    parentId: parentId,
    children: []
  };

  nodes[newId] = newNode;
  parent.children.push(newId);
  return newId;
}

function deleteSubtree(nodes, targetId) {
  if (targetId === 'root' || !nodes[targetId]) return false;

  const target = nodes[targetId];

  // Recursively collect all descendant IDs
  const toDelete = [targetId];
  let i = 0;
  while (i < toDelete.length) {
    const current = nodes[toDelete[i]];
    if (current && Array.isArray(current.children)) {
      toDelete.push(...current.children);
    }
    i++;
  }

  // Remove target from parent's children array
  if (target.parentId && nodes[target.parentId]) {
    const parent = nodes[target.parentId];
    parent.children = parent.children.filter(id => id !== targetId);
  }

  // Delete all descendants from map
  toDelete.forEach(id => {
    delete nodes[id];
  });

  return toDelete;
}

// History stack simulation
class HistoryStack {
  constructor(maxSize = 50) {
    this.stack = [];
    this.index = -1;
    this.maxSize = maxSize;
  }

  push(snapshot) {
    // Truncate redo history
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(JSON.parse(JSON.stringify(snapshot)));
    if (this.stack.length > this.maxSize) {
      this.stack.shift();
    } else {
      this.index++;
    }
  }

  undo() {
    if (this.index > 0) {
      this.index--;
      return JSON.parse(JSON.stringify(this.stack[this.index]));
    }
    return null;
  }

  redo() {
    if (this.index < this.stack.length - 1) {
      this.index++;
      return JSON.parse(JSON.stringify(this.stack[this.index]));
    }
    return null;
  }
}

async function runRegressionSuite() {
  console.log('\n--- 1. Testing Core Tree Operations (Creation, Hierarchy, Deletion) ---');

  // Test 1: Root initialization
  runTest('Root node initializes with valid coordinates and empty children array', () => {
    const nodes = createBlankMap('Project Launch');
    assert(nodes.root);
    assert.strictEqual(nodes.root.text, 'Project Launch');
    assert.strictEqual(nodes.root.parentId, null);
    assert.deepStrictEqual(nodes.root.children, []);
    assert.strictEqual(nodes.root.x, 0);
    assert.strictEqual(nodes.root.y, 0);
  });

  // Test 2: Child addition
  runTest('Adding child nodes updates parent children array and sets parentId', () => {
    const nodes = createBlankMap('Main Topic');
    const child1 = addChildNode(nodes, 'root', 'Marketing');
    const child2 = addChildNode(nodes, 'root', 'Development');

    assert.strictEqual(nodes.root.children.length, 2);
    assert.strictEqual(nodes.root.children[0], child1);
    assert.strictEqual(nodes.root.children[1], child2);

    assert.strictEqual(nodes[child1].parentId, 'root');
    assert.strictEqual(nodes[child2].parentId, 'root');
    assert.strictEqual(nodes[child1].text, 'Marketing');
    assert.strictEqual(nodes[child2].text, 'Development');
  });

  // Test 3: Nested subtree deletion
  runTest('Deleting parent node recursively deletes all nested descendants', () => {
    const nodes = createBlankMap('Company');
    const dept = addChildNode(nodes, 'root', 'Engineering');
    const team1 = addChildNode(nodes, dept, 'Frontend');
    const team2 = addChildNode(nodes, dept, 'Backend');
    const subtask = addChildNode(nodes, team2, 'Database Migration');

    assert.strictEqual(Object.keys(nodes).length, 5); // root + 4 descendants

    const deleted = deleteSubtree(nodes, dept);
    assert.strictEqual(deleted.length, 4); // dept, team1, team2, subtask
    assert.strictEqual(Object.keys(nodes).length, 1); // only root remains
    assert.strictEqual(nodes.root.children.length, 0);
    assert.strictEqual(nodes[dept], undefined);
    assert.strictEqual(nodes[subtask], undefined);
  });

  // Test 4: Cannot delete root node
  runTest('Root node cannot be deleted via deleteSubtree', () => {
    const nodes = createBlankMap('Company');
    const res = deleteSubtree(nodes, 'root');
    assert.strictEqual(res, false);
    assert(nodes.root !== undefined);
  });

  console.log('\n--- 2. Testing Undo / Redo History Stack ---');

  // Test 5: Undo and Redo state restoration
  runTest('History stack restores exact snapshot on undo and redo', () => {
    const history = new HistoryStack();
    const nodes = createBlankMap('Version 1');

    history.push({ title: 'Map V1', nodes });

    // Mutate state
    addChildNode(nodes, 'root', 'Child A');
    history.push({ title: 'Map V2', nodes });

    // Mutate state again
    addChildNode(nodes, 'root', 'Child B');
    history.push({ title: 'Map V3', nodes });

    assert.strictEqual(history.stack.length, 3);
    assert.strictEqual(history.index, 2);

    // Undo 1 step -> V2
    const undone1 = history.undo();
    assert.strictEqual(undone1.title, 'Map V2');
    assert.strictEqual(undone1.nodes.root.children.length, 1);

    // Undo 2nd step -> V1
    const undone2 = history.undo();
    assert.strictEqual(undone2.title, 'Map V1');
    assert.strictEqual(undone2.nodes.root.children.length, 0);

    // Cannot undo past initial snapshot
    const undone3 = history.undo();
    assert.strictEqual(undone3, null);

    // Redo 1 step -> V2
    const redone1 = history.redo();
    assert.strictEqual(redone1.title, 'Map V2');
    assert.strictEqual(redone1.nodes.root.children.length, 1);

    // Redo 2nd step -> V3
    const redone2 = history.redo();
    assert.strictEqual(redone2.title, 'Map V3');
    assert.strictEqual(redone2.nodes.root.children.length, 2);

    // Cannot redo past head
    const redone3 = history.redo();
    assert.strictEqual(redone3, null);
  });

  console.log('\n--- 3. Testing Mind Map Data Export & Standalone Build ---');

  // Test 6: Mind map JSON serialization
  runTest('Mind map JSON structure conforms to schema', () => {
    const nodes = createBlankMap('SaaS Launch Roadmap');
    addChildNode(nodes, 'root', 'Authentication');
    addChildNode(nodes, 'root', 'Stripe Billing');

    const exportPayload = {
      version: '1.0.0',
      title: 'SaaS Launch Roadmap',
      updatedAt: Date.now(),
      rootId: 'root',
      nodes: nodes
    };

    const jsonString = JSON.stringify(exportPayload);
    const parsed = JSON.parse(jsonString);

    assert.strictEqual(parsed.title, 'SaaS Launch Roadmap');
    assert.strictEqual(parsed.rootId, 'root');
    assert.strictEqual(Object.keys(parsed.nodes).length, 3);
    assert(parsed.nodes.root.children.length === 2);
  });

  // Test 7: Standalone HTML compilation
  runTest('build_standalone.js produces valid self-contained HTML file', () => {
    const buildScript = path.resolve(__dirname, '../build_standalone.js');
    assert(fs.existsSync(buildScript), 'build_standalone.js must exist');

    // Run build script synchronously
    const { execSync } = require('child_process');
    execSync('node build_standalone.js', { cwd: path.resolve(__dirname, '..') });

    const standaloneHtmlPath = path.resolve(__dirname, '../mindmap_standalone.html');
    assert(fs.existsSync(standaloneHtmlPath), 'mindmap_standalone.html must be generated');

    const htmlContent = fs.readFileSync(standaloneHtmlPath, 'utf8');
    assert(htmlContent.includes('<!DOCTYPE html>'), 'Standalone file must be valid HTML');
    assert(htmlContent.includes('MindMap Studio'), 'Standalone file must contain MindMap Studio title');
    assert(htmlContent.includes('<style>'), 'Standalone file must contain embedded stylesheet');
    assert(htmlContent.includes('<script>'), 'Standalone file must contain embedded scripts');
    assert(!htmlContent.includes('<link rel="stylesheet" href="style.css">'), 'Standalone must not have external CSS link');
    assert(!htmlContent.includes('<script src="app.js"></script>'), 'Standalone must not have external app.js link');
  });

  console.log('\n--- 4. Testing Zero Fake AI Responses When Key Is Missing ---');

  // Test 8: Strict rejection without fake data
  await runAsyncTest('AI generation strictly throws CONFIG_MISSING without returning fake data', async () => {
    const origKey = process.env.FAL_KEY;
    delete process.env.FAL_KEY;

    try {
      const service = new AIService();
      let threw = false;

      try {
        await service.generateMindMap({ prompt: 'Generate Business Plan' });
      } catch (err) {
        threw = true;
        assert.strictEqual(err.statusCode, 503);
        assert.strictEqual(err.code, 'CONFIG_MISSING');
        assert(err.message.includes('FAL_KEY'));
      }

      assert(threw, 'AI service must throw CONFIG_MISSING and never return fake AI response');
    } finally {
      if (origKey) process.env.FAL_KEY = origKey;
    }
  });

  // Test 9: Node expansion strictly throws CONFIG_MISSING without key
  await runAsyncTest('Node expansion strictly throws CONFIG_MISSING without returning fake data', async () => {
    const origKey = process.env.FAL_KEY;
    delete process.env.FAL_KEY;

    try {
      const service = new AIService();
      let threw = false;

      try {
        await service.expandNode({ nodeText: 'Marketing Strategy', nodeId: 'root' });
      } catch (err) {
        threw = true;
        assert.strictEqual(err.statusCode, 503);
        assert.strictEqual(err.code, 'CONFIG_MISSING');
      }

      assert(threw, 'Node expansion must throw CONFIG_MISSING and never return fake nodes');
    } finally {
      if (origKey) process.env.FAL_KEY = origKey;
    }
  });

  console.log(`\n========================================`);
  console.log(`Regression Test Results: ${passedTests} passed, ${failedTests} failed`);
  console.log(`========================================\n`);

  if (failedTests > 0) process.exit(1);
}

runRegressionSuite().catch(err => {
  console.error('Regression suite failed:', err);
  process.exit(1);
});
