/**
 * MindMap Studio — Vercel Serverless Function Handler for AI Endpoints
 * 
 * Routes incoming Vercel requests to the multi-provider AIService:
 * - GET  /api/ai/status            -> aiService.getStatus()
 * - POST /api/ai/generate          -> aiService.generateMindMap()
 * - POST /api/ai/expand            -> aiService.expandNode()
 * - GET  /api/ai/admin/config      -> aiService.getAdminConfig() (Guarded)
 * - POST /api/ai/admin/config      -> aiService.updateAdminConfig() (Guarded)
 * - POST /api/ai/admin/test-connection -> aiService.testProviderConnection() (Guarded)
 */

const { aiService } = require('../server/ai/service');
const { verifySuperAdmin } = require('../server/ai/admin');

module.exports = async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-key');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  let action = url.searchParams.get('action');

  if (!action) {
    if (pathname.includes('/admin/test-connection')) action = 'admin-test';
    else if (pathname.includes('/admin/config')) action = 'admin-config';
    else if (pathname.includes('/status')) action = 'status';
    else if (pathname.includes('/expand')) action = 'expand';
    else if (pathname.includes('/generate')) action = 'generate';
    else if (req.method === 'GET') action = 'status';
  }

  try {
    // 1. Super Admin: Config endpoint (GET/POST)
    if (action === 'admin-config') {
      const auth = verifySuperAdmin(req);
      if (!auth.authorized) {
        return res.status(auth.statusCode || 401).json({
          success: false,
          error: auth.error || 'Unauthorized: Super Admin access required.',
          code: 'AUTH_REQUIRED'
        });
      }

      if (req.method === 'GET') {
        const config = aiService.getAdminConfig();
        return res.status(200).json({ success: true, ...config, authUser: auth.user });
      }

      if (req.method === 'POST') {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        const updated = aiService.updateAdminConfig(body);
        return res.status(200).json({ success: true, ...updated });
      }

      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // 2. Super Admin: Test provider connection
    if (action === 'admin-test') {
      const auth = verifySuperAdmin(req);
      if (!auth.authorized) {
        return res.status(auth.statusCode || 401).json({
          success: false,
          error: auth.error || 'Unauthorized: Super Admin access required.',
          code: 'AUTH_REQUIRED'
        });
      }

      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
      }

      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const providerId = body.providerId || aiService.activeProviderId;
      const result = aiService.testProviderConnection(providerId);
      return res.status(200).json(result);
    }

    // 3. Public AI Status (zero sensitive secrets exposed)
    if (action === 'status') {
      const status = aiService.getStatus();
      return res.status(200).json({ success: true, ...status });
    }

    // 4. Generate Mind Map
    if (action === 'generate') {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
      }
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const result = await aiService.generateMindMap(body);
      return res.status(200).json(result);
    }

    // 5. Expand Node
    if (action === 'expand') {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
      }
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const result = await aiService.expandNode(body);
      return res.status(200).json(result);
    }

    return res.status(404).json({ error: `Unknown AI action: ${action}` });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      error: err.message || 'AI request failed',
      code: err.code || 'AI_ERROR',
      provider: err.provider || undefined
    });
  }
};
