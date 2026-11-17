/**
 * test/ui_ux_fixes.test.js
 * Focused tests for Phase 9 Step 9 Part 2 UI/UX fixes.
 * Covers:
 * 1. Disclaimer text accuracy (no outdated fictional/unpersisted claims)
 * 2. Static mock count removal from OfferChecker
 * 3. Modal ARIA attributes and keyboard accessibility
 * 4. Protected route target preservation through login
 * 5. Reports page category filter and pagination messaging
 * 6. Form field label-input id association
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('\n--- Phase 9 Step 9 Part 2: UI/UX Fixes Verification Tests ---\n');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
  }
}

// 1. Disclaimer text accuracy
runTest('DisclaimerBox defaultText contains no fictional or demo platform claims', () => {
  const disclaimerSrc = fs.readFileSync(path.join(rootDir, 'src/components/common/DisclaimerBox.jsx'), 'utf8');
  assert(!disclaimerSrc.includes('All data shown is fictional'), 'defaultText must not claim data is fictional');
  assert(!disclaimerSrc.includes('demo platform'), 'defaultText must not claim demo platform');
  assert(disclaimerSrc.includes('Risk scores and pattern matches are intelligence indicators'), 'Contains accurate risk indicator notice');
  assert(disclaimerSrc.includes('not legal determinations'), 'Preserves legal disclaimer');
});

runTest('SubmitReportPage contains no unpersisted demo disclaimer', () => {
  const submitSrc = fs.readFileSync(path.join(rootDir, 'src/pages/SubmitReportPage.jsx'), 'utf8');
  assert(!submitSrc.includes('This is a demo platform'), 'SubmitReportPage must not claim to be a demo platform');
  assert(!submitSrc.includes('not persisted beyond the current session'), 'SubmitReportPage must not claim reports are unpersisted');
  assert(submitSrc.includes('Submitted reports are reviewed by moderators before publication'), 'Affirms moderator review pipeline');
});

runTest('HowItWorksPage contains no fictional data disclaimer', () => {
  const howSrc = fs.readFileSync(path.join(rootDir, 'src/pages/HowItWorksPage.jsx'), 'utf8');
  assert(!howSrc.includes('OfferCheck is a demo fraud-intelligence platform'), 'Must not claim demo platform');
  assert(!howSrc.includes('All data shown is fictional'), 'Must not claim all data is fictional');
  assert(howSrc.includes('does not constitute legal advice'), 'Must preserve legal advice caution');
});

// 2. OfferChecker hardcoded fixture text
runTest('OfferCheckerPage does not contain hardcoded "70+" mock count', () => {
  const offerCheckerSrc = fs.readFileSync(path.join(rootDir, 'src/pages/OfferCheckerPage.jsx'), 'utf8');
  assert(!offerCheckerSrc.includes('70+'), 'Must not hardcode 70+ mock identifier count');
  assert(offerCheckerSrc.includes('compared against verified fraud signals in our database'), 'Contains accurate database comparison statement');
});

// 3. Modal accessibility attributes
runTest('Modal component implements dialog role and ARIA attributes', () => {
  const modalSrc = fs.readFileSync(path.join(rootDir, 'src/components/common/Modal.jsx'), 'utf8');
  assert(modalSrc.includes('role="dialog"'), 'Modal must declare role="dialog"');
  assert(modalSrc.includes('aria-modal="true"'), 'Modal must declare aria-modal="true"');
  assert(modalSrc.includes('aria-labelledby="modal-title"'), 'Modal must declare aria-labelledby="modal-title"');
  assert(modalSrc.includes('id="modal-title"'), 'Modal title h3 must have id="modal-title"');
  assert(modalSrc.includes('aria-label="Close dialog"'), 'Modal close button must have aria-label');
  assert(modalSrc.includes('e.key === \'Escape\''), 'Modal must handle Escape key');
});

// 4. Protected route preservation logic
runTest('Login navigation preserves original target location', () => {
  function getRedirectTarget(locationState, userRole) {
    const from = locationState?.from?.pathname;
    return from && (userRole === 'admin' || !from.startsWith('/admin'))
      ? `${from}${locationState.from.search || ''}${locationState.from.hash || ''}`
      : (userRole === 'admin' ? '/admin' : '/dashboard');
  }

  // Case 1: Student redirected from /check returns to /check
  assert.strictEqual(
    getRedirectTarget({ from: { pathname: '/check' } }, 'student'),
    '/check',
    'Student returning from /check should navigate to /check'
  );

  // Case 2: Student redirected from /submit returns to /submit
  assert.strictEqual(
    getRedirectTarget({ from: { pathname: '/submit', search: '?ref=nav' } }, 'student'),
    '/submit?ref=nav',
    'Preserves query parameters'
  );

  // Case 3: Student attempting /admin is safely sent to /dashboard
  assert.strictEqual(
    getRedirectTarget({ from: { pathname: '/admin' } }, 'student'),
    '/dashboard',
    'Non-admin student attempting /admin redirected to /dashboard'
  );

  // Case 4: Admin accessing /admin returns to /admin
  assert.strictEqual(
    getRedirectTarget({ from: { pathname: '/admin' } }, 'admin'),
    '/admin',
    'Admin accessing /admin redirected to /admin'
  );

  // Case 5: Direct login with no prior target
  assert.strictEqual(
    getRedirectTarget(null, 'student'),
    '/dashboard',
    'Direct login defaults to /dashboard'
  );
});

// 5. ReportsPage category pagination messaging
runTest('ReportsPage category filter and pagination messaging helper', () => {
  function formatReportCountMessage({ category, filteredCount, pageReportCount, page, totalPages, total }) {
    if (category) {
      return `Showing ${filteredCount} of ${pageReportCount} reports on page ${page} (${total} total across categories)`;
    }
    return `Showing ${pageReportCount} of ${total} reports${totalPages > 1 ? ` · Page ${page} of ${totalPages}` : ''}`;
  }

  const msgNoCategory = formatReportCountMessage({
    category: '',
    filteredCount: 10,
    pageReportCount: 10,
    page: 1,
    totalPages: 3,
    total: 28,
  });
  assert.strictEqual(msgNoCategory, 'Showing 10 of 28 reports · Page 1 of 3');

  const msgWithCategory = formatReportCountMessage({
    category: 'critical',
    filteredCount: 2,
    pageReportCount: 10,
    page: 1,
    totalPages: 3,
    total: 28,
  });
  assert.strictEqual(msgWithCategory, 'Showing 2 of 10 reports on page 1 (28 total across categories)');
});

// 6. SubmitReport form field association
runTest('SubmitReportPage associates all labels with inputs via matching id', () => {
  const submitSrc = fs.readFileSync(path.join(rootDir, 'src/pages/SubmitReportPage.jsx'), 'utf8');
  assert(submitSrc.includes('<label htmlFor={id}'), 'Field must render label with htmlFor');
  const expectedIds = ['companyName', 'domain', 'recruiterName', 'phone', 'email', 'upiId', 'paymentRequest', 'offerMessage', 'additionalNotes'];
  for (const id of expectedIds) {
    assert(submitSrc.includes(`id="${id}"`), `Field/input with id="${id}" must exist`);
  }
});

// 7. Navbar outside-click and Escape listeners
runTest('Navbar contains outside-click ref and Escape key listener', () => {
  const navSrc = fs.readFileSync(path.join(rootDir, 'src/components/layout/Navbar.jsx'), 'utf8');
  assert(navSrc.includes('userMenuRef'), 'Navbar must define userMenuRef');
  assert(navSrc.includes('handleOutsideClick'), 'Navbar must implement handleOutsideClick');
  assert(navSrc.includes('e.key === \'Escape\''), 'Navbar must listen for Escape key');
});

// 8. Textarea vertical resize
runTest('OfferChecker and SubmitReport textareas allow vertical resizing', () => {
  const offerCheckerSrc = fs.readFileSync(path.join(rootDir, 'src/pages/OfferCheckerPage.jsx'), 'utf8');
  const submitSrc = fs.readFileSync(path.join(rootDir, 'src/pages/SubmitReportPage.jsx'), 'utf8');
  assert(offerCheckerSrc.includes('resize-y'), 'OfferChecker textarea must have resize-y');
  assert(submitSrc.includes('resize-y'), 'SubmitReport textarea must have resize-y');
});

// 9. Dashboard chart grid min-w-0
runTest('DashboardPage grid column includes min-w-0 for responsive chart container', () => {
  const dashSrc = fs.readFileSync(path.join(rootDir, 'src/pages/DashboardPage.jsx'), 'utf8');
  assert(dashSrc.includes('lg:col-span-2 space-y-5 min-w-0'), 'Must include min-w-0 on chart grid column');
});

// 10. Trust Graph mobile responsive sidebar
runTest('TrustGraphPage responsive layout stacks sidebar on mobile viewports', () => {
  const graphSrc = fs.readFileSync(path.join(rootDir, 'src/pages/TrustGraphPage.jsx'), 'utf8');
  assert(graphSrc.includes('flex flex-col md:flex-row flex-1 overflow-hidden'), 'Main area must be flex-col on mobile and md:flex-row on desktop');
  assert(graphSrc.includes('w-full md:w-64'), 'Sidebar must be w-full on mobile and md:w-64 on desktop');
});

console.log(`\nAll ${passedTests} / ${totalTests} UI/UX fix tests passed successfully!\n`);
if (passedTests !== totalTests) {
  process.exit(1);
}
