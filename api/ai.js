/**
 * MindMap Studio — Vercel Serverless Function Handler for AI Endpoints
 * 
 * Routes incoming Vercel requests to the multi-provider AIService:
 * - GET  /api/ai/status   -> aiService.getStatus()
 * - POST /api/ai/generate -> aiService.generateMindMap()
 * - POST /api/ai/expand   -> aiService.expandNode()
 */

const { aiService } = require('../server/ai/service');

module.exports = async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  let action = url.searchParams.get('action');

  if (!action) {
    if (pathname.includes('/status')) action = 'status';
    else if (pathname.includes('/expand')) action = 'expand';
    else if (pathname.includes('/generate')) action = 'generate';
    else if (req.method === 'GET') action = 'status';
  }

  try {
    if (action === 'status') {
      const status = aiService.getStatus();
      return res.status(200).json({ success: true, ...status });
    }

    if (action === 'generate') {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
      }
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const result = await aiService.generateMindMap(body);
      return res.status(200).json(result);
    }

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
