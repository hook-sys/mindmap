/**
 * MindMap Studio — Unified Test Suite Runner
 * 
 * Runs all automated test suites:
 * 1. admin_ai_test.js (Super Admin security, provider switching, secret masking)
 * 2. entitlements_test.js (SaaS tiers, pricing limits, Supabase schema triggers)
 * 3. server_admin_http_test.js (HTTP API endpoints, auth rejection, status)
 * 4. editor_regression_test.js (Core editor hierarchy, undo/redo, standalone build, zero fake AI)
 */

const { fork } = require('child_process');
const path = require('path');

const suites = [
  { name: 'Admin AI & Security Test Suite', file: 'admin_ai_test.js' },
  { name: 'SaaS Entitlements & Schema Test Suite', file: 'entitlements_test.js' },
  { name: 'HTTP Server API & Integration Test Suite', file: 'server_admin_http_test.js' },
  { name: 'Core Editor & Regression Test Suite', file: 'editor_regression_test.js' },
  { name: 'Supabase Integration & Cloud CRUD Test Suite', file: 'supabase_integration_test.js' }
];

console.log('====================================================');
console.log(' MindMap Studio — Running Full Automated Test Suite');
console.log('====================================================');

let currentSuiteIndex = 0;
let passedSuites = 0;
let failedSuites = 0;

function runNextSuite() {
  if (currentSuiteIndex >= suites.length) {
    console.log('\n====================================================');
    console.log(` Summary: ${passedSuites}/${suites.length} Suites Passed`);
    if (failedSuites === 0) {
      console.log(' All automated regression and security tests PASSED! ✓');
      console.log('====================================================\n');
      process.exit(0);
    } else {
      console.log(` ${failedSuites} suite(s) FAILED! ✗`);
      console.log('====================================================\n');
      process.exit(1);
    }
    return;
  }

  const suite = suites[currentSuiteIndex];
  console.log(`\n▶ [${currentSuiteIndex + 1}/${suites.length}] Running ${suite.name} (${suite.file})...`);

  const child = fork(path.join(__dirname, suite.file), [], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' }
  });

  child.on('close', code => {
    if (code === 0) {
      passedSuites++;
      console.log(`[PASS] ${suite.name} completed successfully.`);
    } else {
      failedSuites++;
      console.error(`[FAIL] ${suite.name} exited with code ${code}.`);
    }
    currentSuiteIndex++;
    runNextSuite();
  });

  child.on('error', err => {
    console.error(`[ERROR] Failed to run ${suite.name}:`, err);
    failedSuites++;
    currentSuiteIndex++;
    runNextSuite();
  });
}

runNextSuite();
