/**
 * MindMap Studio — Batch 2 (Phase 3) SaaS Entitlements & Schema Test Suite
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  TIERS,
  getTier,
  canCreateCloudProject,
  canUseAiDetailLevel,
  getEffectiveExpandCount,
  getPlansCatalog
} = require('../server/ai/entitlements');

let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failedTests++;
  }
}

console.log('\n--- 1. Testing SaaS Pricing & Tier Limits ---');

// Test 1: Tier Catalog Pricing & Limits
runTest('SaaS Tier definitions match pricing and capability specifications', () => {
  const free = getTier('free');
  assert.strictEqual(free.price, 0);
  assert.strictEqual(free.maxCloudProjects, 3);
  assert.deepStrictEqual(free.allowedDetailLevels, ['standard']);
  assert.strictEqual(free.maxExpandChildren, 4);

  const monthly = getTier('pro_monthly');
  assert.strictEqual(monthly.price, 3.99);
  assert.strictEqual(monthly.maxCloudProjects, Infinity);
  assert(monthly.allowedDetailLevels.includes('deep'));
  assert.strictEqual(monthly.maxExpandChildren, 6);

  const yearly = getTier('pro_yearly');
  assert.strictEqual(yearly.price, 17.88);
  assert.strictEqual(yearly.maxCloudProjects, Infinity);
  assert(yearly.allowedDetailLevels.includes('deep'));
  assert.strictEqual(yearly.maxExpandChildren, 6);
  assert(yearly.savingsBadge.includes('62%'));
});

// Test 2: Cloud Project Creation Entitlements
runTest('Cloud project limits: Free allows <= 3, Pro allows unlimited', () => {
  assert.strictEqual(canCreateCloudProject('free', 0).allowed, true);
  assert.strictEqual(canCreateCloudProject('free', 2).allowed, true);
  
  const freeFull = canCreateCloudProject('free', 3);
  assert.strictEqual(freeFull.allowed, false);
  assert(freeFull.reason.includes('Free Starter plan'));

  // Pro tiers have no limits
  assert.strictEqual(canCreateCloudProject('pro_monthly', 3).allowed, true);
  assert.strictEqual(canCreateCloudProject('pro_monthly', 500).allowed, true);
  assert.strictEqual(canCreateCloudProject('pro_yearly', 1000).allowed, true);
});

// Test 3: AI Detail Level Entitlements
runTest('AI detail level: Free gets standard only, Pro gets deep generation', () => {
  const freeStd = canUseAiDetailLevel('free', 'standard');
  assert.strictEqual(freeStd.allowed, true);
  assert.strictEqual(freeStd.effectiveDetailLevel, 'standard');

  const freeDeep = canUseAiDetailLevel('free', 'deep');
  assert.strictEqual(freeDeep.allowed, false);
  assert.strictEqual(freeDeep.effectiveDetailLevel, 'standard');
  assert(freeDeep.reason.includes('Pro feature'));

  const proDeep = canUseAiDetailLevel('pro_monthly', 'deep');
  assert.strictEqual(proDeep.allowed, true);
  assert.strictEqual(proDeep.effectiveDetailLevel, 'deep');

  const proYearlyDeep = canUseAiDetailLevel('pro_yearly', 'deep');
  assert.strictEqual(proYearlyDeep.allowed, true);
  assert.strictEqual(proYearlyDeep.effectiveDetailLevel, 'deep');
});

// Test 4: Node Expansion Count Capping
runTest('Node expansion: Free capped at 4 subtopics, Pro expands up to 6', () => {
  const freeNormal = getEffectiveExpandCount('free', 3);
  assert.strictEqual(freeNormal.count, 3);
  assert.strictEqual(freeNormal.capped, false);

  const freeOver = getEffectiveExpandCount('free', 6);
  assert.strictEqual(freeOver.count, 4);
  assert.strictEqual(freeOver.capped, true);

  const proExp = getEffectiveExpandCount('pro_monthly', 6);
  assert.strictEqual(proExp.count, 6);
  assert.strictEqual(proExp.capped, false);
});

// Test 5: Plans Catalog format
runTest('getPlansCatalog returns structured array for UI rendering', () => {
  const catalog = getPlansCatalog();
  assert.strictEqual(catalog.length, 3);
  assert.strictEqual(catalog[0].id, 'free');
  assert.strictEqual(catalog[1].id, 'pro_monthly');
  assert.strictEqual(catalog[2].id, 'pro_yearly');
});

console.log('\n--- 2. Testing Supabase PostgreSQL Schema & Security Policies ---');

// Test 6: Verify schema file existence and RLS definitions
runTest('supabase_schema.sql contains tables, triggers, and strict RLS policies', () => {
  const schemaPath = path.resolve(__dirname, '../supabase_schema.sql');
  assert(fs.existsSync(schemaPath), 'supabase_schema.sql must exist');
  
  const sql = fs.readFileSync(schemaPath, 'utf8');

  // Verify tables
  assert(sql.includes('CREATE TABLE IF NOT EXISTS public.profiles'), 'Must create profiles table');
  assert(sql.includes('CREATE TABLE IF NOT EXISTS public.projects'), 'Must create projects table');

  // Verify RLS activation
  assert(sql.includes('ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;'), 'Must enable RLS on profiles');
  assert(sql.includes('ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;'), 'Must enable RLS on projects');

  // Verify tenant isolation policies
  assert(sql.includes('auth.uid() = id'), 'Profiles policy must isolate by auth.uid()');
  assert(sql.includes('auth.uid() = user_id'), 'Projects policy must isolate by auth.uid()');

  // Verify triggers
  assert(sql.includes('handle_new_user()'), 'Must contain auto-profile creation trigger');
  assert(sql.includes('handle_updated_at()'), 'Must contain timestamp update trigger');
});

console.log(`\n========================================`);
console.log(`Test Results: ${passedTests} passed, ${failedTests} failed`);
console.log(`========================================\n`);

if (failedTests > 0) process.exit(1);
