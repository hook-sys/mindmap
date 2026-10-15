/**
 * MindMap Studio — Fal AI Provider Adapter
 * 
 * Integrates Fal AI's serverless LLM router endpoints:
 * - Direct synchronous endpoint: https://fal.run/fal-ai/any-llm
 * - OpenAI-compatible endpoint: https://fal.run/openrouter/router/openai/v1/chat/completions
 * - Authenticates securely via server-side process.env.FAL_KEY
 */

const BaseProvider = require('./base');
const { extractAndParseJson, normalizeMindMap, normalizeExpandedNodes } = require('../schema');

class FalProvider extends BaseProvider {
  constructor() {
    super({
      id: 'fal',
      name: 'Fal AI',
      defaultModel: 'anthropic/claude-3.5-sonnet'
    });

    this.apiUrl = 'https://fal.run/fal-ai/any-llm';
    this.openAiCompatibleUrl = 'https://fal.run/openrouter/router/openai/v1/chat/completions';
  }

  /**
   * Validates Fal AI configuration on server
   */
  validateConfiguration(config = {}) {
    const key = config.apiKey || process.env.FAL_KEY;
    if (!key || typeof key !== 'string' || !key.trim()) {
      return {
        valid: false,
        error: 'Fal AI configuration missing: FAL_KEY environment variable is not set on the server.',
        missingKey: 'FAL_KEY'
      };
    }

    if (key.trim().length < 10) {
      return {
        valid: false,
        error: 'FAL_KEY appears invalid or too short.',
        missingKey: 'FAL_KEY'
      };
    }

    return { valid: true };
  }

  /**
   * List of supported models on Fal AI
   */
  getAvailableModels() {
    return [
      {
        id: 'anthropic/claude-3.5-sonnet',
        name: 'Claude 3.5 Sonnet (via Fal)',
        description: 'Frontier reasoning and optimal structured JSON tree generation.',
        capabilities: ['structured_json', 'deep_hierarchy', 'fast_inference'],
        default: true
      },
      {
        id: 'google/gemini-flash-1.5',
        name: 'Gemini 1.5 Flash (via Fal)',
        description: 'Ultra high-speed generation with broad topic comprehension.',
        capabilities: ['structured_json', 'fast_inference']
      },
      {
        id: 'openai/gpt-4o-mini',
        name: 'GPT-4o Mini (via Fal)',
        description: 'Compact, efficient model with high structural accuracy.',
        capabilities: ['structured_json', 'fast_inference']
      },
      {
        id: 'meta-llama/llama-3.1-8b-instruct',
        name: 'Llama 3.1 8B (via Fal)',
        description: 'Open-weights community model for fast mind mapping.',
        capabilities: ['general_text']
      }
    ];
  }

  /**
   * Executes HTTP request to Fal AI with timeout and error translation
   */
  async _callFalApi(payload, config = {}) {
    const validation = this.validateConfiguration(config);
    if (!validation.valid) {
      const err = new Error(validation.error);
      err.statusCode = 503;
      err.code = 'CONFIG_MISSING';
      throw err;
    }

    const apiKey = (config.apiKey || process.env.FAL_KEY).trim();
    const timeoutMs = config.timeoutMs || 45000;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let rawOutput = null;

    try {
      // 1. First attempt: Direct synchronous endpoint (https://fal.run/fal-ai/any-llm)
      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Key ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (res.status === 401 || res.status === 403) {
        throw new Error('Fal AI authentication failed. Please verify that FAL_KEY is valid and active.');
      }

      if (res.status === 429) {
        throw new Error('Fal AI rate limit or quota exceeded. Please wait a moment and try again.');
      }

      if (res.ok) {
        const data = await res.json();
        // Fal any-llm output format: { output: "..." } or { choices: [...] }
        rawOutput = data.output || (data.choices && data.choices[0]?.message?.content);
      } else {
        // Fallback attempt: Try OpenAI-compatible route (https://fal.run/openrouter/router/openai/v1/chat/completions)
        const openAiPayload = {
          model: payload.model,
          messages: [
            { role: 'system', content: payload.system_prompt || '' },
            { role: 'user', content: payload.prompt }
          ],
          temperature: payload.temperature || 0.3,
          max_tokens: payload.max_tokens || 2048
        };

        const resFallback = await fetch(this.openAiCompatibleUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Key ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(openAiPayload),
          signal: controller.signal
        });

        if (resFallback.ok) {
          const fallbackData = await resFallback.json();
          rawOutput = fallbackData.choices && fallbackData.choices[0]?.message?.content;
        } else {
          const errText = await res.text().catch(() => '');
          throw new Error(`Fal AI request failed with HTTP ${res.status}: ${errText.substring(0, 200)}`);
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        const timeoutErr = new Error(`Fal AI request timed out after ${timeoutMs / 1000} seconds.`);
        timeoutErr.statusCode = 504;
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!rawOutput) {
      throw new Error('Fal AI completed but did not return any text content.');
    }

    return rawOutput;
  }

  /**
   * Generates a complete MindMap from prompt
   */
  async generateMindMap(input, config = {}) {
    const prompt = (input.prompt || '').trim();
    if (!prompt) {
      throw new Error('Prompt is required to generate a mind map.');
    }

    const model = input.model || this.defaultModel;
    const isDeep = input.detailLevel === 'deep';

    const systemPrompt = `You are an expert visual thinking assistant and mind map architect.
Given a topic or description, generate a comprehensive, well-structured mind map hierarchy.
Strictly return ONLY a valid JSON object matching this exact format, with NO explanation, NO conversational filler, and NO markdown ticks:
{
  "title": "Short Project Title",
  "rootText": "Central Core Concept",
  "branches": [
    {
      "text": "Major Subtopic 1",
      "children": [
        { "text": "Detail 1.1", "children": [] },
        { "text": "Detail 1.2", "children": [] }
      ]
    },
    {
      "text": "Major Subtopic 2",
      "children": [
        { "text": "Detail 2.1", "children": [] }
      ]
    }
  ]
}

Guidelines:
1. Provide between ${isDeep ? '4 to 6' : '3 to 5'} top-level branches.
2. For each branch, provide between ${isDeep ? '2 to 4' : '2 to 3'} sub-items.
3. Keep node texts concise (2 to 6 words each), engaging, and informative with relevant emoji icons where helpful.
4. Output raw JSON only.`;

    const userPrompt = `Create a complete mind map about: "${prompt}"`;

    const rawResponse = await this._callFalApi({
      model,
      prompt: userPrompt,
      system_prompt: systemPrompt,
      temperature: 0.35,
      max_tokens: 2500
    }, config);

    // Extract, validate and normalize the response
    const parsedJson = extractAndParseJson(rawResponse);
    return normalizeMindMap(parsedJson, prompt);
  }

  /**
   * Expands a specific node with 3 to 5 child subtopics
   */
  async expandNode(input, config = {}) {
    const nodeText = (input.nodeText || '').trim();
    if (!nodeText) {
      throw new Error('Node text is required to expand.');
    }

    const model = input.model || this.defaultModel;
    const contextTopic = input.mindMapTopic ? ` (Context: Mind map about "${input.mindMapTopic}")` : '';
    const desiredCount = Math.min(Math.max(input.count || 4, 2), 6);

    const systemPrompt = `You are a creative brainstorming assistant specializing in mind maps.
Given a specific mind map node, generate ${desiredCount} distinct, relevant child subtopics or actionable steps.
Strictly return ONLY a valid JSON object matching this exact format:
{
  "expandedNodes": [
    "Sub-concept or action 1",
    "Sub-concept or action 2",
    "Sub-concept or action 3"
  ]
}
Keep each item concise (2 to 6 words each) with relevant emoji icons where helpful. Output raw JSON only.`;

    const userPrompt = `Generate ${desiredCount} child subtopics to expand the node: "${nodeText}"${contextTopic}`;

    const rawResponse = await this._callFalApi({
      model,
      prompt: userPrompt,
      system_prompt: systemPrompt,
      temperature: 0.4,
      max_tokens: 1000
    }, config);

    const parsedJson = extractAndParseJson(rawResponse);
    return parsedJson;
  }
}

module.exports = FalProvider;
