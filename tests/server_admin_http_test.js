/**
 * MindMap Studio — HTTP Server AI & Admin Integration Test
 */

const http = require('http');
const assert = require('assert');

// Spin up a test server instance by importing server logic
// We can test against localhost
const { aiService } = require('../server/ai/service');
const { verifySuperAdmin } = require('../server/ai/admin');

// We'll create a dedicated lightweight test HTTP server using the exact same handlers as server.js
function createTestServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1:4000');
    const pathname = url.pathname;

    function sendJson(code, data) {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    }

    if (pathname.startsWith('/api/ai/admin/')) {
      const auth = verifySuperAdmin(req);
      if (!auth.authorized) {
        return sendJson(auth.statusCode || 401, { success: false, error: auth.error });
      }

      if (pathname === '/api/ai/admin/config' && req.method === 'GET') {
        return sendJson(200, { success: true, ...aiService.getAdminConfig() });
      }

      if (pathname === '/api/ai/admin/config' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          const parsed = JSON.parse(body || '{}');
          const updated = aiService.updateAdminConfig(parsed);
          return sendJson(200, { success: true, ...updated });
        });
        return;
      }

      if (pathname === '/api/ai/admin/test-connection' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          const parsed = JSON.parse(body || '{}');
          const result = aiService.testProviderConnection(parsed.providerId || aiService.activeProviderId);
          return sendJson(200, result);
        });
        return;
      }
    }

    if (pathname === '/api/ai/status' && req.method === 'GET') {
      return sendJson(200, { success: true, ...aiService.getStatus() });
    }

    if (pathname === '/api/ai/generate' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const result = await aiService.generateMindMap(parsed);
          return sendJson(200, result);
        } catch (err) {
          return sendJson(err.statusCode || 500, { success: false, error: err.message, code: err.code });
        }
      });
      return;
    }

    sendJson(404, { error: 'Not Found' });
  });
}

function makeRequest({ port, path, method = 'GET', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  const server = createTestServer();
  const PORT = 4055;

  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  console.log(`Test HTTP server listening on port ${PORT}`);

  try {
    // 1. Test public GET /api/ai/status
    console.log('Testing GET /api/ai/status...');
    const statusRes = await makeRequest({ port: PORT, path: '/api/ai/status' });
    assert.strictEqual(statusRes.status, 200);
    assert.strictEqual(statusRes.body.success, true);
    assert.strictEqual(statusRes.body.activeProvider, 'fal');
    assert.strictEqual(statusRes.body.availableProviders.length, 4);
    // Ensure no raw secret key values leaked in public status
    process.env.FAL_KEY = 'secret_raw_key_never_leak_xyz';
    const statusWithKey = await makeRequest({ port: PORT, path: '/api/ai/status' });
    const statusStr = JSON.stringify(statusWithKey.body);
    assert(!statusStr.includes('secret_raw_key_never_leak_xyz'), 'Raw secret key must never be in public status');
    delete process.env.FAL_KEY;
    console.log('  ✓ Public AI status verified (no secrets exposed)');

    // 2. Test unauthorized GET /api/ai/admin/config in production
    console.log('Testing production rejection for unauthenticated admin request...');
    process.env.NODE_ENV = 'production';
    process.env.ADMIN_SECRET_KEY = 'test_secret_admin_key_999';

    const unauthRes = await makeRequest({ port: PORT, path: '/api/ai/admin/config' });
    assert.strictEqual(unauthRes.status, 401);
    assert.strictEqual(unauthRes.body.success, false);
    console.log('  ✓ Unauthenticated admin request correctly rejected with 401');

    // 3. Test authorized GET /api/ai/admin/config with x-admin-key
    console.log('Testing authorized GET /api/ai/admin/config with x-admin-key...');
    const authRes = await makeRequest({
      port: PORT,
      path: '/api/ai/admin/config',
      headers: { 'x-admin-key': 'test_secret_admin_key_999' }
    });
    assert.strictEqual(authRes.status, 200);
    assert.strictEqual(authRes.body.success, true);
    assert.strictEqual(authRes.body.providers.length, 4);
    console.log('  ✓ Authorized admin request returned all 4 providers');

    // 4. Test POST /api/ai/admin/config (switch provider to Gemini)
    console.log('Testing provider switching via POST /api/ai/admin/config...');
    const switchRes = await makeRequest({
      port: PORT,
      path: '/api/ai/admin/config',
      method: 'POST',
      headers: { 'x-admin-key': 'test_secret_admin_key_999' },
      body: { activeProvider: 'gemini', selectedModel: 'gemini-1.5-flash' }
    });
    assert.strictEqual(switchRes.status, 200);
    assert.strictEqual(switchRes.body.activeProvider, 'gemini');
    assert.strictEqual(switchRes.body.activeModel, 'gemini-1.5-flash');
    console.log('  ✓ Successfully switched active provider to Google Gemini');

    // Switch back to Fal AI as default
    await makeRequest({
      port: PORT,
      path: '/api/ai/admin/config',
      method: 'POST',
      headers: { 'x-admin-key': 'test_secret_admin_key_999' },
      body: { activeProvider: 'fal' }
    });

    // 5. Test POST /api/ai/admin/test-connection
    console.log('Testing connection test endpoint...');
    const testRes = await makeRequest({
      port: PORT,
      path: '/api/ai/admin/test-connection',
      method: 'POST',
      headers: { 'x-admin-key': 'test_secret_admin_key_999' },
      body: { providerId: 'fal' }
    });
    assert.strictEqual(testRes.status, 200);
    assert.strictEqual(testRes.body.providerId, 'fal');
    console.log('  ✓ Safe connection test returned cleanly');

    // 6. Test POST /api/ai/generate with missing key -> returns 503 CONFIG_MISSING
    console.log('Testing generate error handling when key is missing...');
    delete process.env.FAL_KEY;
    const genRes = await makeRequest({
      port: PORT,
      path: '/api/ai/generate',
      method: 'POST',
      body: { prompt: 'Blockchain in Agriculture' }
    });
    assert.strictEqual(genRes.status, 503);
    assert.strictEqual(genRes.body.code, 'CONFIG_MISSING');
    console.log('  ✓ Missing key returned 503 CONFIG_MISSING gracefully');

    console.log('\nAll HTTP integration tests passed successfully!\n');
  } finally {
    delete process.env.ADMIN_SECRET_KEY;
    process.env.NODE_ENV = 'test';
    server.close();
  }
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
