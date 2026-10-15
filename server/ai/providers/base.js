/**
 * MindMap Studio — Base AI Provider Adapter Interface
 * 
 * All provider adapters (Fal AI, Gemini, OpenAI, Claude, etc.)
 * must extend this class to ensure consistent multi-provider interoperability.
 */

class BaseProvider {
  /**
   * @param {Object} options
   * @param {string} options.id - Provider unique identifier (e.g. 'fal', 'gemini')
   * @param {string} options.name - Human-readable provider name
   * @param {string} options.defaultModel - Default model ID
   */
  constructor(options = {}) {
    if (!options.id) throw new Error('Provider id is required');
    if (!options.name) throw new Error('Provider name is required');

    this.id = options.id;
    this.name = options.name;
    this.defaultModel = options.defaultModel || '';
  }

  /**
   * Validates server-side provider configuration (e.g. environment variable existence)
   * @param {Object} [config] - Optional runtime overrides
   * @returns {{ valid: boolean, error?: string, missingKey?: string }}
   */
  validateConfiguration(config = {}) {
    throw new Error(`validateConfiguration() must be implemented by ${this.name}`);
  }

  /**
   * Returns list of supported models and their capabilities
   * @returns {Array<{ id: string, name: string, description: string, capabilities: string[], default?: boolean }>}
   */
  getAvailableModels() {
    throw new Error(`getAvailableModels() must be implemented by ${this.name}`);
  }

  /**
   * Generates a complete MindMap hierarchy from a prompt/topic
   * @param {Object} input
   * @param {string} input.prompt - User topic or description
   * @param {string} [input.model] - Specific model ID to use
   * @param {string} [input.detailLevel] - 'standard' | 'deep'
   * @param {Object} [config] - Provider configuration overrides
   * @returns {Promise<{ title: string, rootText: string, branches: Array }>}
   */
  async generateMindMap(input, config = {}) {
    throw new Error(`generateMindMap() must be implemented by ${this.name}`);
  }

  /**
   * Generates subtopics to expand a specific node
   * @param {Object} input
   * @param {string} input.nodeText - The text of the node to expand
   * @param {string[]} [input.contextPath] - Ancestor titles for context
   * @param {string} [input.mindMapTopic] - Main mindmap topic
   * @param {number} [input.count] - Desired number of child nodes (default: 3-5)
   * @param {string} [input.model] - Specific model ID to use
   * @param {Object} [config] - Provider configuration overrides
   * @returns {Promise<{ expandedNodes: string[] }>}
   */
  async expandNode(input, config = {}) {
    throw new Error(`expandNode() must be implemented by ${this.name}`);
  }
}

module.exports = BaseProvider;
