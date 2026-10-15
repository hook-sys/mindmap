/**
 * MindMap Studio — Anthropic Claude Provider Adapter
 */

const BaseProvider = require('./base');
const { extractAndParseJson, normalizeMindMap } = require('../schema');

class ClaudeProvider extends BaseProvider {
  constructor() {
    super({
      id: 'claude',
      name: 'Anthropic Claude',
      defaultModel: 'claude-3-5-sonnet-20241022'
    });
  }

  validateConfiguration(config = {}) {
    const key = config.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key || typeof key !== 'string' || !key.trim()) {
      return {
        valid: false,
        error: 'Anthropic Claude configuration missing: ANTHROPIC_API_KEY environment variable is not set on the server.',
        missingKey: 'ANTHROPIC_API_KEY'
      };
    }
    return { valid: true };
  }

  getAvailableModels() {
    return [
      {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        description: 'Industry-leading reasoning and clean JSON structuring.',
        capabilities: ['structured_json', 'deep_hierarchy'],
        default: true
      },
      {
        id: 'claude-3-5-haiku-20241022',
        name: 'Claude 3.5 Haiku',
        description: 'High speed, light-weight intelligence.',
        capabilities: ['structured_json', 'fast_inference']
      }
    ];
  }

  async generateMindMap(input, config = {}) {
    const validation = this.validateConfiguration(config);
    if (!validation.valid) throw new Error(validation.error);

    const apiKey = (config.apiKey || process.env.ANTHROPIC_API_KEY).trim();
    const model = input.model || this.defaultModel;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        max_tokens: 2500,
        system: 'You are a mind map architect. Output ONLY valid JSON matching: { "title": "...", "rootText": "...", "branches": [{ "text": "...", "children": [] }] }',
        messages: [{ role: 'user', content: `Generate a mind map for: "${input.prompt}"` }]
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Claude API failed with HTTP ${res.status}: ${errText.substring(0, 150)}`);
    }

    const data = await res.json();
    const content = data.content?.[0]?.text;
    const parsed = extractAndParseJson(content);
    return normalizeMindMap(parsed, input.prompt);
  }

  async expandNode(input, config = {}) {
    const validation = this.validateConfiguration(config);
    if (!validation.valid) throw new Error(validation.error);

    const apiKey = (config.apiKey || process.env.ANTHROPIC_API_KEY).trim();
    const model = input.model || this.defaultModel;
    const count = input.count || 4;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        max_tokens: 1000,
        system: `Generate ${count} child subtopics for a mind map node. Output ONLY valid JSON: { "expandedNodes": ["...", "..."] }`,
        messages: [{ role: 'user', content: `Expand node: "${input.nodeText}"` }]
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Claude API failed with HTTP ${res.status}: ${errText.substring(0, 150)}`);
    }

    const data = await res.json();
    const content = data.content?.[0]?.text;
    return extractAndParseJson(content);
  }
}

module.exports = ClaudeProvider;
