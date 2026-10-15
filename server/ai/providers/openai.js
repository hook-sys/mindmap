/**
 * MindMap Studio — OpenAI Provider Adapter
 */

const BaseProvider = require('./base');
const { extractAndParseJson, normalizeMindMap } = require('../schema');

class OpenAIProvider extends BaseProvider {
  constructor() {
    super({
      id: 'openai',
      name: 'OpenAI',
      defaultModel: 'gpt-4o-mini'
    });
  }

  validateConfiguration(config = {}) {
    const key = config.apiKey || process.env.OPENAI_API_KEY;
    if (!key || typeof key !== 'string' || !key.trim()) {
      return {
        valid: false,
        error: 'OpenAI configuration missing: OPENAI_API_KEY environment variable is not set on the server.',
        missingKey: 'OPENAI_API_KEY'
      };
    }
    return { valid: true };
  }

  getAvailableModels() {
    return [
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        description: 'Fast, highly efficient with structured JSON output.',
        capabilities: ['structured_json', 'fast_inference'],
        default: true
      },
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        description: 'Omni flagship model for deep analysis and reasoning.',
        capabilities: ['structured_json', 'deep_hierarchy']
      }
    ];
  }

  async generateMindMap(input, config = {}) {
    const validation = this.validateConfiguration(config);
    if (!validation.valid) throw new Error(validation.error);

    const apiKey = (config.apiKey || process.env.OPENAI_API_KEY).trim();
    const model = input.model || this.defaultModel;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a mind map architect. Generate a mind map hierarchy as raw JSON matching: { "title": "...", "rootText": "...", "branches": [{ "text": "...", "children": [] }] }'
          },
          { role: 'user', content: `Generate a mind map for: "${input.prompt}"` }
        ],
        response_format: { type: 'json_object' }
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenAI API failed with HTTP ${res.status}: ${errText.substring(0, 150)}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    const parsed = extractAndParseJson(content);
    return normalizeMindMap(parsed, input.prompt);
  }

  async expandNode(input, config = {}) {
    const validation = this.validateConfiguration(config);
    if (!validation.valid) throw new Error(validation.error);

    const apiKey = (config.apiKey || process.env.OPENAI_API_KEY).trim();
    const model = input.model || this.defaultModel;
    const count = input.count || 4;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `Generate ${count} child subtopics for a mind map node. Return JSON: { "expandedNodes": ["...", "..."] }`
          },
          { role: 'user', content: `Expand node: "${input.nodeText}"` }
        ],
        response_format: { type: 'json_object' }
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenAI API failed with HTTP ${res.status}: ${errText.substring(0, 150)}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    return extractAndParseJson(content);
  }
}

module.exports = OpenAIProvider;
