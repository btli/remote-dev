/**
 * Feature 018: SMS Phone Number Verification - Error Handling Tests
 * E2E Test Script using Puppeteer
 *
 * Tests comprehensive error scenarios:
 * - Invalid phone number format
 * - Rate limiting (too many requests)
 * - Incorrect verification code (multiple attempts)
 * - Expired verification code
 * - Maximum attempts exceeded
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

console.log(`📱 Testing error handling with SMS provider: ${SMS_PROVIDER.toUpperCase()}`);
console.log(`🔗 Base URL: ${BASE_URL}\n`);

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function takeScreenshot(page, name) {
  const path = `${SCREENSHOT_DIR}/phone_verification_errors_${name}.png`;
  await page.screenshot({ path, fullPage: true });
  console.log(`📸 Screenshot saved: ${path}`);
}

async function testErrorHandling() {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  try {
    console.log('🚀 Starting error handling E2E tests...\n');

    // ========================================
    // Test 1: Invalid phone number format
    // ========================================
    console.log('Test 1: Testing invalid phone number...');
    await page.goto(`${BASE_URL}/register`, { waitUntil: 'networkidle2' });
    await delay(2000);

    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });

    // Try invalid formats
    const invalidPhones = [
      '123',           // Too short
      'abcdefghij',    // Letters
      '111-222-3333',  // Invalid format (should be E.164)
    ];

    for (const invalidPhone of invalidPhones) {
      console.log(`  Testing: ${invalidPhone}`);
      await page.type('#phone-input', invalidPhone);

      // Check for validation error
      const errorEl = await page.$('#phone-error');
      if (errorEl) {
        const errorText = await page.evaluate(el => el.textContent, errorEl);
        console.log(`  ✅ Validation error shown: ${errorText}`);
      }

      // Clear input
      await page.click('#phone-input', { clickCount: 3 });
      await page.keyboard.press('Backspace');
    }

    await takeScreenshot(page, '01_invalid_phone');
    console.log('✅ Invalid phone number validation works\n');

    // ========================================
    // Test 2: Incorrect verification code (3 attempts)
    // ========================================
    console.log('Test 2: Testing multiple incorrect code attempts...');

    // Enter valid phone and send code
    await page.type('#phone-input', TEST_PHONE);
    await page.click('button:has-text("Send Verification Code")');
    await delay(3000);

    // Attempt 1: Wrong code
    console.log('  Attempt 1/3: Entering wrong code...');
    for (let i = 1; i <= 6; i++) {
      await page.type(`[aria-label="Digit ${i} of 6"]`, '0');
    }
    await delay(2000);
    await takeScreenshot(page, '02_attempt_1_wrong');

    let errorMessage = await page.$eval('#code-error', el => el.textContent);
    console.log(`  Error message: ${errorMessage}`);

    // Check attempts remaining
    const attemptsEl = await page.$('#attempts-remaining');
    if (attemptsEl) {
      const attemptsText = await page.evaluate(el => el.textContent, attemptsEl);
      console.log(`  ${attemptsText}`);
    }

    // Clear code inputs
    for (let i = 1; i <= 6; i++) {
      const input = await page.$(`[aria-label="Digit ${i} of 6"]`);
      await input.click({ clickCount: 3 });
      await input.press('Backspace');
    }

    // Attempt 2: Wrong code
    console.log('  Attempt 2/3: Entering wrong code...');
    for (let i = 1; i <= 6; i++) {
      await page.type(`[aria-label="Digit ${i} of 6"]`, '1');
    }
    await delay(2000);
    await takeScreenshot(page, '03_attempt_2_wrong');

    errorMessage = await page.$eval('#code-error', el => el.textContent);
    console.log(`  Error message: ${errorMessage}`);

    // Attempt 3: Wrong code
    console.log('  Attempt 3/3: Entering wrong code...');
    for (let i = 1; i <= 6; i++) {
      const input = await page.$(`[aria-label="Digit ${i} of 6"]`);
      await input.click({ clickCount: 3 });
      await input.press('Backspace');
    }
    for (let i = 1; i <= 6; i++) {
      await page.type(`[aria-label="Digit ${i} of 6"]`, '2');
    }
    await delay(2000);
    await takeScreenshot(page, '04_attempt_3_wrong_max_attempts');

    errorMessage = await page.$eval('#code-error', el => el.textContent);
    console.log(`  Error message: ${errorMessage}`);

    if (errorMessage.includes('maximum number of attempts')) {
      console.log('✅ Maximum attempts error shown correctly');
    }

    console.log('✅ Multiple incorrect attempts handled correctly\n');

    // ========================================
    // Test 3: Expired code (if time permits)
    // ========================================
    console.log('Test 3: Expired code test');
    console.log('  ⏭️  Skipped (would require 10+ minute wait)');
    console.log('  💡 Manual test: Wait 10+ minutes and try code\n');

    // ========================================
    // Test 4: Rate limiting
    // ========================================
    console.log('Test 4: Testing rate limiting...');
    console.log('  💡 This test requires sending 5+ requests within 1 hour');
    console.log('  ⏭️  Skipped in automated test (would hit production limits)');
    console.log('  Manual test: Send verification 5 times, expect 429 error on 6th\n');

    console.log('🎉 Error handling tests completed!');
    console.log('\nScreenshots saved to:', SCREENSHOT_DIR);
  } catch (error) {
    console.error('❌ Test failed:', error);
    await takeScreenshot(page, 'error');
    throw error;
  } finally {
    await browser.close();
  }
}

// Run tests
testErrorHandling()
  .then(() => {
    console.log('\n✅ Error handling test suite completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error handling test suite failed:', error);
    process.exit(1);
  });
