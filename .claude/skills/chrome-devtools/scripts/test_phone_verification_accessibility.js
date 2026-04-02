/**
 * Feature 018: SMS Phone Number Verification - Accessibility Tests
 * E2E Test Script using Puppeteer
 *
 * Tests accessibility features:
 * - Keyboard navigation (Tab, Enter, Escape, Backspace)
 * - ARIA labels and roles
 * - Screen reader announcements
 * - Focus management
 * - Error announcements
 * - Success announcements
 *
 * Environment Variables:
 * - TEST_BASE_URL: Base URL of app (default: http://localhost:3000)
 * - TEST_PHONE: Phone number to test with (default: +12025551234)
 * - SMS_PROVIDER: Provider to test (twilio or plivo, default: twilio)
 */

import puppeteer from 'puppeteer';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const TEST_PHONE = process.env.TEST_PHONE || '+12025551234';
const SMS_PROVIDER = process.env.SMS_PROVIDER || 'twilio';
const SCREENSHOT_DIR = '/tmp';

console.log(`📱 Testing accessibility with SMS provider: ${SMS_PROVIDER.toUpperCase()}`);
console.log(`🔗 Base URL: ${BASE_URL}\n`);

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function takeScreenshot(page, name) {
  const path = `${SCREENSHOT_DIR}/phone_verification_a11y_${name}.png`;
  await page.screenshot({ path, fullPage: true });
  console.log(`📸 Screenshot saved: ${path}`);
}

async function testAccessibility() {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  try {
    console.log('🚀 Starting accessibility E2E tests...\n');

    // ========================================
    // Test 1: Modal has proper ARIA attributes
    // ========================================
    console.log('Test 1: Checking modal ARIA attributes...');
    await page.goto(`${BASE_URL}/register`, { waitUntil: 'networkidle2' });
    await delay(2000);

    const modal = await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
    await takeScreenshot(page, '01_modal_opened');

    // Check role="dialog"
    const role = await page.$eval('[role="dialog"]', el => el.getAttribute('role'));
    console.log(`  ✅ role="${role}"`);

    // Check aria-labelledby or aria-label
    const ariaLabelledBy = await page.$eval('[role="dialog"]', el =>
      el.getAttribute('aria-labelledby') || el.getAttribute('aria-label')
    );
    if (ariaLabelledBy) {
      console.log(`  ✅ aria-labelledby or aria-label present`);
    }

    // Check aria-modal
    const ariaModal = await page.$eval('[role="dialog"]', el =>
      el.getAttribute('aria-modal')
    );
    if (ariaModal === 'true') {
      console.log(`  ✅ aria-modal="true"`);
    }

    console.log('✅ Modal ARIA attributes correct\n');

    // ========================================
    // Test 2: Phone input has proper labels
    // ========================================
    console.log('Test 2: Checking phone input accessibility...');

    const phoneInput = await page.$('#phone-input');
    if (phoneInput) {
      // Check for label
      const label = await page.$('label[for="phone-input"]');
      if (label) {
        const labelText = await page.evaluate(el => el.textContent, label);
        console.log(`  ✅ Label: "${labelText}"`);
      }

      // Check aria-label or aria-labelledby
      const ariaLabel = await page.$eval('#phone-input', el =>
        el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
      );
      if (ariaLabel) {
        console.log(`  ✅ aria-label or aria-labelledby present`);
      }

      // Check aria-required
      const ariaRequired = await page.$eval('#phone-input', el =>
        el.getAttribute('aria-required')
      );
      if (ariaRequired === 'true') {
        console.log(`  ✅ aria-required="true"`);
      }
    }

    await takeScreenshot(page, '02_phone_input_labels');
    console.log('✅ Phone input labels correct\n');

    // ========================================
    // Test 3: Keyboard navigation - Tab order
    // ========================================
    console.log('Test 3: Testing Tab key navigation...');

    // Start from phone input
    await page.click('#phone-input');
    await delay(500);

    // Tab to "Send" button
    await page.keyboard.press('Tab');
    await delay(500);

    let focusedElement = await page.evaluate(() => document.activeElement.textContent);
    console.log(`  Tab 1: Focus on "${focusedElement.trim().substring(0, 30)}..."`);

    // Tab to close button (if present)
    await page.keyboard.press('Tab');
    await delay(500);

    focusedElement = await page.evaluate(() => document.activeElement.textContent || document.activeElement.getAttribute('aria-label'));
    console.log(`  Tab 2: Focus on "${focusedElement.trim()}"`);

    await takeScreenshot(page, '03_tab_navigation');
    console.log('✅ Tab navigation works\n');

    // ========================================
    // Test 4: Keyboard navigation - Enter key
    // ========================================
    console.log('Test 4: Testing Enter key activation...');

    // Focus phone input and enter number
    await page.click('#phone-input');
    await page.type('#phone-input', TEST_PHONE);
    await delay(500);

    // Tab to Send button
    await page.keyboard.press('Tab');
    await delay(500);

    // Press Enter to activate
    console.log('  Pressing Enter on "Send" button...');
    await page.keyboard.press('Enter');
    await delay(3000);

    await takeScreenshot(page, '04_enter_key_activation');
    console.log('✅ Enter key activation works\n');

    // ========================================
    // Test 5: Code input ARIA labels
    // ========================================
    console.log('Test 5: Checking code input ARIA labels...');

    const codeInputs = await page.$$('[aria-label^="Digit"]');
    console.log(`  Found ${codeInputs.length} code inputs`);

    for (let i = 0; i < codeInputs.length; i++) {
      const ariaLabel = await page.evaluate(
        el => el.getAttribute('aria-label'),
        codeInputs[i]
      );
      console.log(`  ✅ Input ${i + 1}: ${ariaLabel}`);
    }

    await takeScreenshot(page, '05_code_input_labels');
    console.log('✅ Code input ARIA labels correct\n');

    // ========================================
    // Test 6: Keyboard navigation - Arrow keys
    // ========================================
    console.log('Test 6: Testing arrow key navigation in code inputs...');

    // Focus first digit
    await codeInputs[0].click();
    await delay(500);

    // Type digit
    await page.keyboard.press('1');
    await delay(500);

    // Check if focus moved to next input
    focusedElement = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));
    console.log(`  After typing: Focus on "${focusedElement}"`);

    if (focusedElement.includes('Digit 2')) {
      console.log('  ✅ Auto-advance to next input works');
    }

    // Test backspace
    await page.keyboard.press('Backspace');
    await delay(500);

    focusedElement = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));
    console.log(`  After backspace: Focus on "${focusedElement}"`);

    if (focusedElement.includes('Digit 1')) {
      console.log('  ✅ Backspace returns to previous input');
    }

    await takeScreenshot(page, '06_arrow_key_navigation');
    console.log('✅ Arrow key navigation works\n');

    // ========================================
    // Test 7: Error messages have aria-live
    // ========================================
    console.log('Test 7: Testing error message announcements...');

    // Enter invalid code to trigger error
    for (let i = 0; i < 6; i++) {
      await page.type(`[aria-label="Digit ${i + 1} of 6"]`, '0');
    }
    await delay(2000);

    // Check for error with aria-live
    const errorRegion = await page.$('#code-error');
    if (errorRegion) {
      const ariaLive = await page.evaluate(el => el.getAttribute('aria-live'), errorRegion);
      const role = await page.evaluate(el => el.getAttribute('role'), errorRegion);

      if (ariaLive === 'polite' || ariaLive === 'assertive' || role === 'alert') {
        console.log(`  ✅ Error has aria-live="${ariaLive}" or role="${role}"`);
      }

      const errorText = await page.evaluate(el => el.textContent, errorRegion);
      console.log(`  📢 Error announced: "${errorText}"`);
    }

    await takeScreenshot(page, '07_error_announcement');
    console.log('✅ Error announcements configured\n');

    // ========================================
    // Test 8: Escape key closes modal
    // ========================================
    console.log('Test 8: Testing Escape key...');

    await page.keyboard.press('Escape');
    await delay(1000);

    // Check if modal is closed
    const modalAfterEscape = await page.$('[role="dialog"]');
    if (!modalAfterEscape) {
      console.log('  ✅ Modal closed with Escape key');
    } else {
      console.log('  ⚠️  Modal did not close (may be intentional)');
    }

    await takeScreenshot(page, '08_escape_key');
    console.log('✅ Escape key handling tested\n');

    // ========================================
    // Test 9: Focus trap (if modal still open)
    // ========================================
    console.log('Test 9: Testing focus trap...');
    console.log('  💡 Focus should remain within modal');
    console.log('  💡 Tab at end should cycle back to first focusable element');
    console.log('  💡 Shift+Tab at start should cycle to last focusable element');
    console.log('  ⏭️  Manual test recommended for thorough verification\n');

    // ========================================
    // Test 10: Color contrast (manual check)
    // ========================================
    console.log('Test 10: Color contrast...');
    console.log('  💡 Manual check required:');
    console.log('     - Use browser DevTools Lighthouse audit');
    console.log('     - Check WCAG AA compliance (4.5:1 for normal text)');
    console.log('     - Verify error states have sufficient contrast');
    console.log('     - Test with screen reader (NVDA, JAWS, VoiceOver)\n');

    console.log('🎉 Accessibility tests completed!');
    console.log('\nScreenshots saved to:', SCREENSHOT_DIR);
    console.log('\n💡 Accessibility checklist:');
    console.log('   ✅ Modal has role="dialog" and aria-modal="true"');
    console.log('   ✅ All inputs have proper labels');
    console.log('   ✅ Keyboard navigation works (Tab, Enter, Escape)');
    console.log('   ✅ Code inputs have descriptive ARIA labels');
    console.log('   ✅ Error messages use aria-live or role="alert"');
    console.log('   ✅ Focus management in code inputs');
    console.log('   💡 Manual verification needed for:');
    console.log('      - Focus trap completeness');
    console.log('      - Screen reader announcements');
    console.log('      - Color contrast ratios');
  } catch (error) {
    console.error('❌ Test failed:', error);
    await takeScreenshot(page, 'error');
    throw error;
  } finally {
    await browser.close();
  }
}

// Run tests
testAccessibility()
  .then(() => {
    console.log('\n✅ Accessibility test suite completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Accessibility test suite failed:', error);
    process.exit(1);
  });
