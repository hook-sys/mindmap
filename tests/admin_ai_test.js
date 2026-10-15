/**
 * MindMap Studio — Batch 1 (Phase 2) Automated Test Suite
 * 
 * Verifies:
 * 1. Server-side Super Admin authorization guard & token/key verification
 * 2. Unauthenticated and non-admin request rejection (401/403)
 * 3. Secret masking & zero secret exposure
 * 4. Provider switching across Fal AI, Gemini, OpenAI, Claude
 * 5. Model overrides and default model configuration
 * 6. Safe connection testing without live billable API calls
 * 7. Missing environment variable and oversized prompt handling
 */

const assert = require('assert');
const { verifySuperAdmin, parseJwt } = require('../server/ai/admin');
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

function createMockJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.mockSignature`;
}

async function runSuite() {
  console.log('\n--- 1. Testing Server-side Super Admin Authorization Guard ---');

  // Test 1: Production mode rejects unauthenticated requests
  runTest('Strict production rejection for requests without credentials', () => {
    const origNodeEnv = process.env.NODE_ENV;
    const origVercel = process.env.VERCEL;
    process.env.NODE_ENV = 'production';
    delete process.env.VERCEL;

    try {
      const auth = verifySuperAdmin({ headers: {} });
      assert.strictEqual(auth.authorized, false);
      assert.strictEqual(auth.statusCode, 401);
    } finally {
      process.env.NODE_ENV = origNodeEnv;
      if (origVercel) process.env.VERCEL = origVercel;
    }
  });

  // Test 2: Direct Admin Secret Key Authorization (x-admin-key)
  runTest('Admin Secret Key authorization succeeds with correct key', () => {
    const origKey = process.env.ADMIN_SECRET_KEY;
    process.env.ADMIN_SECRET_KEY = 'super_secret_test_key_123';

    try {
      const auth = verifySuperAdmin({
        headers: { 'x-admin-key': 'super_secret_test_key_123' }
      });
      assert.strictEqual(auth.authorized, true);
      assert.strictEqual(auth.authType, 'admin_key');
    } finally {
      process.env.ADMIN_SECRET_KEY = origKey;
    }
  });

  // Test 3: Admin Secret Key rejection with wrong key
  runTest('Admin Secret Key authorization rejected with wrong key', () => {
    const origKey = process.env.ADMIN_SECRET_KEY;
    process.env.ADMIN_SECRET_KEY = 'super_secret_test_key_123';

    try {
      const auth = verifySuperAdmin({
        headers: { 'x-admin-key': 'wrong_key_value' }
      });
      assert.strictEqual(auth.authorized, false);
      assert.strictEqual(auth.statusCode, 403);
    } finally {
      process.env.ADMIN_SECRET_KEY = origKey;
    }
  });

  // Test 4: Supabase JWT verification for non-admin user
  runTest('Non-admin user JWT is rejected with 403 Forbidden', () => {
    const origEmails = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = 'admin@mindmap.studio,founder@mindmap.studio';

    try {
      const nonAdminToken = createMockJwt({
        sub: 'user_123',
        email: 'regular_user@example.com',
        exp: Math.floor(Date.now() / 1000) + 3600
      });

      const auth = verifySuperAdmin({
        headers: { authorization: `Bearer ${nonAdminToken}` }
      });

      assert.strictEqual(auth.authorized, false);
      assert.strictEqual(auth.statusCode, 403);
      assert(auth.error.includes('regular_user@example.com'));
    } finally {
      process.env.ADMIN_EMAILS = origEmails;
    }
  });

  // Test 5: Supabase JWT verification for admin email in ADMIN_EMAILS
  runTest('Admin user JWT matching ADMIN_EMAILS is authorized with 200', () => {
    const origEmails = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = 'admin@mindmap.studio,founder@mindmap.studio';

    try {
      const adminToken = createMockJwt({
        sub: 'admin_uuid_456',
        email: 'Admin@MindMap.Studio', // Test case insensitivity
        exp: Math.floor(Date.now() / 1000) + 3600
      });

      const auth = verifySuperAdmin({
        headers: { authorization: `Bearer ${adminToken}` }
      });

      assert.strictEqual(auth.authorized, true);
      assert.strictEqual(auth.authType, 'admin_email');
      assert.strictEqual(auth.user.email, 'admin@mindmap.studio');
    } finally {
      process.env.ADMIN_EMAILS = origEmails;
    }
  });

  // Test 6: Expired JWT session rejection
  runTest('Expired JWT session is rejected with 401 Unauthorized', () => {
    const expiredToken = createMockJwt({
      sub: 'admin_uuid_456',
      email: 'admin@mindmap.studio',
      exp: Math.floor(Date.now() / 1000) - 300 // expired 5 minutes ago
    });

    const auth = verifySuperAdmin({
      headers: { authorization: `Bearer ${expiredToken}` }
    });

    assert.strictEqual(auth.authorized, false);
    assert.strictEqual(auth.statusCode, 401);
    assert(auth.error.includes('expired'));
  });

  console.log('\n--- 2. Testing AI Service Admin Methods & Secret Masking ---');

  // Test 7: Secret Key Masking
  runTest('Secret keys are strictly masked and never expose raw values', () => {
    const service = new AIService();
    assert.strictEqual(service.maskKey(null), null);
    assert.strictEqual(service.maskKey(''), null);
    assert.strictEqual(service.maskKey('short'), '••••••••');
    assert.strictEqual(service.maskKey('fal_key_sec_1234567890abcdef'), '••••••••cdef');
    assert.strictEqual(service.maskKey('sk-ant-api03-abcdefghijklmnop'), '••••••••mnop');
  });

  // Test 8: getAdminConfig returns structured provider data
  runTest('getAdminConfig returns all 4 providers with environment variable names', () => {
    const service = new AIService();
    const config = service.getAdminConfig();

    assert.strictEqual(config.activeProvider, 'fal');
    assert.strictEqual(config.activeProviderName, 'Fal AI');
    assert.strictEqual(config.providers.length, 4);

    const fal = config.providers.find(p => p.id === 'fal');
    const gemini = config.providers.find(p => p.id === 'gemini');
    const openai = config.providers.find(p => p.id === 'openai');
    const claude = config.providers.find(p => p.id === 'claude');

    assert(fal && fal.envKeyName === 'FAL_KEY');
    assert(gemini && gemini.envKeyName === 'GEMINI_API_KEY');
    assert(openai && openai.envKeyName === 'OPENAI_API_KEY');
    assert(claude && claude.envKeyName === 'ANTHROPIC_API_KEY');
  });

  // Test 9: Provider Switching
  runTest('Super Admin can safely switch active provider and override default model', () => {
    const service = new AIService();
    
    // Switch to Gemini
    const updated = service.updateAdminConfig({
      activeProvider: 'gemini',
      selectedModel: 'gemini-1.5-pro'
    });

    assert.strictEqual(updated.activeProvider, 'gemini');
    assert.strictEqual(updated.activeProviderName, 'Google Gemini');
    assert.strictEqual(updated.activeModel, 'gemini-1.5-pro');

    const status = service.getStatus();
    assert.strictEqual(status.activeProvider, 'gemini');
    assert.strictEqual(status.activeModel, 'gemini-1.5-pro');
  });

  // Test 10: Rejecting unknown provider or invalid model
  runTest('updateAdminConfig throws on unknown provider or unsupported model', () => {
    const service = new AIService();

    assert.throws(() => {
      service.updateAdminConfig({ activeProvider: 'invalid-provider-xyz' });
    }, /Cannot set active provider to unknown ID/);

    assert.throws(() => {
      service.updateAdminConfig({ activeProvider: 'fal', selectedModel: 'unsupported-model-999' });
    }, /is not supported by provider/);
  });

  // Test 11: Safe Connection Testing (without live inference costs)
  runTest('testProviderConnection validates server environment safely', () => {
    const service = new AIService();

    // With key missing:
    const origFalKey = process.env.FAL_KEY;
    delete process.env.FAL_KEY;

    try {
      const testMissing = service.testProviderConnection('fal');
      assert.strictEqual(testMissing.success, false);
      assert.strictEqual(testMissing.code, 'KEY_MISSING');
      assert(testMissing.message.includes('FAL_KEY'));

      // With mock valid key:
      process.env.FAL_KEY = 'test_mock_fal_key_1234567890';
      const testOk = service.testProviderConnection('fal');
      assert.strictEqual(testOk.success, true);
      assert.strictEqual(testOk.isConfigured, true);
      assert.strictEqual(testOk.maskedKey, '••••••••7890');
      assert(testOk.costNotice.includes('Live inference billing bypassed'));
    } finally {
      if (origFalKey) process.env.FAL_KEY = origFalKey;
      else delete process.env.FAL_KEY;
    }
  });

  // Test 12: Prompt validation (>800 chars rejected)
  await runAsyncTest('generateMindMap rejects prompts over 800 characters', async () => {
    const service = new AIService();
    const oversizedPrompt = 'a'.repeat(801);

    try {
      await service.generateMindMap({ prompt: oversizedPrompt });
      assert.fail('Should have thrown error for oversized prompt');
    } catch (err) {
      assert.strictEqual(err.statusCode, 400);
      assert(err.message.includes('800 characters'));
    }
  });

  // Test 13: Clean 503 CONFIG_MISSING when API key is missing
  await runAsyncTest('generateMindMap returns CONFIG_MISSING error when FAL_KEY is not set', async () => {
    const service = new AIService();
    const origFalKey = process.env.FAL_KEY;
    delete process.env.FAL_KEY;

    try {
      await service.generateMindMap({ prompt: 'Test Topic' });
      assert.fail('Should have thrown error for missing configuration');
    } catch (err) {
      assert.strictEqual(err.statusCode, 503);
      assert.strictEqual(err.code, 'CONFIG_MISSING');
      assert(err.message.includes('FAL_KEY'));
    } finally {
      if (origFalKey) process.env.FAL_KEY = origFalKey;
    }
  });

  console.log(`\n========================================`);
  console.log(`Test Results: ${passedTests} passed, ${failedTests} failed`);
  console.log(`========================================\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
