/**
 * MindMap Studio — Multi-Provider AI Service
 * 
 * Central orchestrator for all AI generation requests:
 * - Decouples UI & mind-map logic from provider-specific APIs
 * - Manages active provider (Default: Fal AI)
 * - Normalizes inputs, outputs, and errors
 * - Sanitizes untrusted model outputs
 * - Strictly protects server-side secrets
 */

const FalProvider = require('./providers/fal');
const GeminiProvider = require('./providers/gemini');
const OpenAIProvider = require('./providers/openai');
const ClaudeProvider = require('./providers/claude');
const { normalizeExpandedNodes } = require('./schema');

class AIService {
  constructor() {
    this.providers = new Map();

    // Register all supported providers
    this.registerProvider(new FalProvider());
    this.registerProvider(new GeminiProvider());
    this.registerProvider(new OpenAIProvider());
    this.registerProvider(new ClaudeProvider());

    // Initial active provider is Fal AI as required
    this.activeProviderId = 'fal';
    this.providerModelOverrides = {};
  }

  /**
   * Helper to get server environment variable name for a provider
   */
  getEnvKeyName(providerId) {
    switch (providerId) {
      case 'fal': return 'FAL_KEY';
      case 'gemini': return 'GEMINI_API_KEY';
      case 'openai': return 'OPENAI_API_KEY';
      case 'claude': return 'ANTHROPIC_API_KEY';
      default: return `${providerId.toUpperCase()}_API_KEY`;
    }
  }

  /**
   * Mask an API key to protect server secrets (only last 4 characters visible)
   */
  maskKey(key) {
    if (!key || typeof key !== 'string') return null;
    const trimmed = key.trim();
    if (trimmed.length < 8) return '••••••••';
    return '••••••••' + trimmed.slice(-4);
  }

  /**
   * Register a new provider adapter
   */
  registerProvider(provider) {
    this.providers.set(provider.id, provider);
  }

  /**
   * Retrieve a provider by ID
   */
  getProvider(providerId) {
    return this.providers.get(providerId);
  }

  /**
   * Retrieve active provider
   */
  getActiveProvider() {
    const provider = this.providers.get(this.activeProviderId);
    if (!provider) {
      throw new Error(`Active AI provider "${this.activeProviderId}" is not registered.`);
    }
    return provider;
  }

  /**
   * Set active provider (for Super Admin switching)
   */
  setActiveProvider(providerId) {
    if (!this.providers.has(providerId)) {
      throw new Error(`Cannot activate unknown AI provider "${providerId}".`);
    }
    this.activeProviderId = providerId;
  }

  /**
   * Get safe public status of all providers (zero sensitive keys exposed)
   */
  getStatus() {
    const active = this.getActiveProvider();
    const activeValidation = active.validateConfiguration();
    const effectiveDefaultModel = this.providerModelOverrides[this.activeProviderId] || active.defaultModel;

    const providerList = [];
    for (const [id, prov] of this.providers.entries()) {
      const v = prov.validateConfiguration();
      providerList.push({
        id: prov.id,
        name: prov.name,
        defaultModel: this.providerModelOverrides[id] || prov.defaultModel,
        configured: v.valid,
        statusError: v.valid ? null : v.error,
        models: prov.getAvailableModels()
      });
    }

    return {
      activeProvider: active.id,
      activeProviderName: active.name,
      activeModel: effectiveDefaultModel,
      configured: activeValidation.valid,
      configError: activeValidation.valid ? null : activeValidation.error,
      models: active.getAvailableModels(),
      availableProviders: providerList
    };
  }

  /**
   * Super Admin: Get full provider configurations with masked keys
   */
  getAdminConfig() {
    const active = this.getActiveProvider();
    const providerList = [];

    for (const [id, prov] of this.providers.entries()) {
      const envKeyName = this.getEnvKeyName(id);
      const rawKey = process.env[envKeyName];
      const validation = prov.validateConfiguration();
      const defaultModel = this.providerModelOverrides[id] || prov.defaultModel;

      providerList.push({
        id: prov.id,
        name: prov.name,
        envKeyName,
        isConfigured: validation.valid,
        maskedKey: validation.valid ? this.maskKey(rawKey) : null,
        statusError: validation.valid ? null : validation.error,
        defaultModel,
        models: prov.getAvailableModels(),
        isActive: id === this.activeProviderId
      });
    }

    return {
      activeProvider: this.activeProviderId,
      activeProviderName: active.name,
      activeModel: this.providerModelOverrides[this.activeProviderId] || active.defaultModel,
      providers: providerList,
      serverEnv: {
        isProduction: process.env.NODE_ENV === 'production' || !!process.env.VERCEL,
        hasAdminProtection: !!(process.env.ADMIN_SECRET_KEY || process.env.ADMIN_EMAILS)
      }
    };
  }

  /**
   * Super Admin: Update active provider, model selections and defaults
   */
  updateAdminConfig({ activeProvider, selectedModel, providerModelDefaults } = {}) {
    if (activeProvider) {
      if (!this.providers.has(activeProvider)) {
        const err = new Error(`Cannot set active provider to unknown ID: "${activeProvider}"`);
        err.statusCode = 400;
        throw err;
      }
      this.activeProviderId = activeProvider;
    }

    if (selectedModel && (activeProvider || this.activeProviderId)) {
      const targetProviderId = activeProvider || this.activeProviderId;
      const prov = this.getProvider(targetProviderId);
      const validModel = prov.getAvailableModels().some(m => m.id === selectedModel);
      if (!validModel) {
        const err = new Error(`Model "${selectedModel}" is not supported by provider "${targetProviderId}"`);
        err.statusCode = 400;
        throw err;
      }
      this.providerModelOverrides[targetProviderId] = selectedModel;
    }

    if (providerModelDefaults && typeof providerModelDefaults === 'object') {
      for (const [pId, mId] of Object.entries(providerModelDefaults)) {
        if (this.providers.has(pId)) {
          this.providerModelOverrides[pId] = mId;
        }
      }
    }

    return this.getAdminConfig();
  }

  /**
   * Super Admin: Test provider configuration safely without running live billable inference
   */
  testProviderConnection(providerId) {
    const provider = this.getProvider(providerId);
    if (!provider) {
      const err = new Error(`Provider "${providerId}" not found.`);
      err.statusCode = 404;
      throw err;
    }

    const envKeyName = this.getEnvKeyName(providerId);
    const rawKey = process.env[envKeyName];
    const validation = provider.validateConfiguration();

    if (!validation.valid) {
      return {
        success: false,
        providerId: provider.id,
        providerName: provider.name,
        envKeyName,
        isConfigured: false,
        message: validation.error || `Missing environment variable ${envKeyName} on server.`,
        code: 'KEY_MISSING'
      };
    }

    return {
      success: true,
      providerId: provider.id,
      providerName: provider.name,
      envKeyName,
      isConfigured: true,
      maskedKey: this.maskKey(rawKey),
      message: `Connection test passed: ${envKeyName} is configured and correctly formatted on server.`,
      costNotice: 'Live inference billing bypassed during test connection to prevent accidental API charges.'
    };
  }

  /**
   * Generate Mind Map from prompt
   */
  async generateMindMap({ prompt, title, detailLevel, providerId, modelId }, configOverrides = {}) {
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      const err = new Error('A topic or prompt is required to generate a mind map.');
      err.statusCode = 400;
      throw err;
    }

    if (prompt.length > 800) {
      const err = new Error('Prompt is too long (maximum 800 characters).');
      err.statusCode = 400;
      throw err;
    }

    const provider = providerId ? this.getProvider(providerId) : this.getActiveProvider();
    if (!provider) {
      const err = new Error(`AI Provider "${providerId}" not found.`);
      err.statusCode = 404;
      throw err;
    }

    const validation = provider.validateConfiguration(configOverrides);
    if (!validation.valid) {
      const err = new Error(validation.error);
      err.statusCode = 503;
      err.code = 'CONFIG_MISSING';
      err.provider = provider.id;
      throw err;
    }

    const effectiveModel = modelId || this.providerModelOverrides[provider.id] || provider.defaultModel;

    const mindMapData = await provider.generateMindMap({
      prompt: prompt.trim(),
      title,
      detailLevel: detailLevel || 'standard',
      model: effectiveModel
    }, configOverrides);

    return {
      success: true,
      provider: provider.id,
      providerName: provider.name,
      model: effectiveModel,
      data: mindMapData
    };
  }

  /**
   * Expand a specific node with child topics
   */
  async expandNode({ nodeText, nodeId, mindMapTopic, count, providerId, modelId, existingNodes }, configOverrides = {}) {
    if (!nodeText || typeof nodeText !== 'string' || !nodeText.trim()) {
      const err = new Error('Node text is required to expand.');
      err.statusCode = 400;
      throw err;
    }

    const provider = providerId ? this.getProvider(providerId) : this.getActiveProvider();
    if (!provider) {
      const err = new Error(`AI Provider "${providerId}" not found.`);
      err.statusCode = 404;
      throw err;
    }

    const validation = provider.validateConfiguration(configOverrides);
    if (!validation.valid) {
      const err = new Error(validation.error);
      err.statusCode = 503;
      err.code = 'CONFIG_MISSING';
      err.provider = provider.id;
      throw err;
    }

    const effectiveModel = modelId || this.providerModelOverrides[provider.id] || provider.defaultModel;

    // Call provider to get expansion items
    const rawExpansion = await provider.expandNode({
      nodeText: nodeText.trim(),
      mindMapTopic,
      count: count || 4,
      model: effectiveModel
    }, configOverrides);

    // Normalize into valid MindMap Studio node objects
    const parentNode = (existingNodes && nodeId && existingNodes[nodeId]) ? existingNodes[nodeId] : {
      id: nodeId || 'root',
      x: 0,
      y: 0,
      color: '#4F46E5'
    };

    const newNodes = normalizeExpandedNodes(rawExpansion, parentNode, existingNodes || {});

    return {
      success: true,
      provider: provider.id,
      providerName: provider.name,
      model: effectiveModel,
      parentNodeId: parentNode.id,
      newNodes
    };
  }
}

// Singleton instance
const defaultService = new AIService();

module.exports = {
  AIService,
  aiService: defaultService
};
