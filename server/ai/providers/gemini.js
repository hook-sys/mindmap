/**
 * MindMap Studio — Google Gemini Provider Adapter
 */

const BaseProvider = require('./base');
const { extractAndParseJson, normalizeMindMap } = require('../schema');

class GeminiProvider extends BaseProvider {
  constructor() {
    super({
      id: 'gemini',
      name: 'Google Gemini',
      defaultModel: 'gemini-1.5-flash'
    });
  }

  validateConfiguration(config = {}) {
    const key = config.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!key || typeof key !== 'string' || !key.trim()) {
      return {
        valid: false,
        error: 'Google Gemini configuration missing: GEMINI_API_KEY environment variable is not set on the server.',
        missingKey: 'GEMINI_API_KEY'
      };
    }
    return { valid: true };
  }

  getAvailableModels() {
    return [
      {
        id: 'gemini-1.5-flash',
        name: 'Gemini 1.5 Flash',
        description: 'Fast, cost-efficient model with structured JSON support.',
        capabilities: ['structured_json', 'fast_inference'],
        default: true
      },
      {
        id: 'gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        description: 'Advanced reasoning and complex topic decomposition.',
        capabilities: ['structured_json', 'deep_hierarchy']
      },
      {
        id: 'gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        description: 'Next-gen high speed multimodal model.',
        capabilities: ['structured_json', 'fast_inference']
      }
    ];
  }

  async generateMindMap(input, config = {}) {
    const validation = this.validateConfiguration(config);
    if (!validation.valid) throw new Error(validation.error);

    const apiKey = (config.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY).trim();
    const model = input.model || this.defaultModel;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const promptText = `Generate a complete mind map about "${input.prompt}". Return strictly a JSON object with: { "title": "...", "rootText": "...", "branches": [{ "text": "...", "children": [...] }] }`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Gemini API failed with HTTP ${res.status}: ${errText.substring(0, 150)}`);
    }

    const data = await res.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = extractAndParseJson(content);
    return normalizeMindMap(parsed, input.prompt);
  }

  async expandNode(input, config = {}) {
    const validation = this.validateConfiguration(config);
    if (!validation.valid) throw new Error(validation.error);

    const apiKey = (config.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY).trim();
    const model = input.model || this.defaultModel;
    const count = input.count || 4;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const promptText = `Generate ${count} child subtopics to expand mind map node "${input.nodeText}". Return strictly JSON: { "expandedNodes": ["...", "..."] }`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Gemini API failed with HTTP ${res.status}: ${errText.substring(0, 150)}`);
    }

    const data = await res.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return extractAndParseJson(content);
  }
}

module.exports = GeminiProvider;
