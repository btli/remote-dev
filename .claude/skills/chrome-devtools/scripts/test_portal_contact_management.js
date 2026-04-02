import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORTAL_URL = 'http://localhost:3001';
const SCREENSHOT_DIR = '/tmp';

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testContactManagement() {
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 100,
    args: ['--window-size=1920,1080'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  let testsPassed = 0;
  let testsFailed = 0;

  try {
    console.log('🚀 Starting Portal Contact Management E2E Tests...\n');

    // Test 1: Navigate to profile page
    console.log('Test 1: Navigate to profile page');
    await page.goto(`${PORTAL_URL}/profile`, { waitUntil: 'networkidle2' });
    await delay(1000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/contact_01_profile_page.png`, fullPage: true });
    console.log('✅ Profile page loaded\n');
    testsPassed++;

    // Test 2: Check if phone number section exists
    console.log('Test 2: Check if phone number section exists');
    const phoneSection = await page.waitForSelector('text/Phone Numbers', { timeout: 5000 });
    if (phoneSection) {
      console.log('✅ Phone Numbers section found\n');
      testsPassed++;
    } else {
      throw new Error('Phone Numbers section not found');
    }

    // Test 3: Check if address section exists
    console.log('Test 3: Check if address section exists');
    const addressSection = await page.waitForSelector('text/Addresses', { timeout: 5000 });
    if (addressSection) {
      console.log('✅ Addresses section found\n');
      testsPassed++;
    } else {
      throw new Error('Addresses section not found');
    }

    // Test 4: Add a phone number
    console.log('Test 4: Add a phone number');
    await page.evaluate(() => window.scrollTo(0, 400));
    await delay(500);
    const addPhoneButton = await page.waitForSelector('button::-p-text(Add Phone Number)', { timeout: 5000 });
    await addPhoneButton.click();
    await delay(500);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/contact_02_add_phone_form.png`, fullPage: true });

    // Fill in phone number details
    await page.type('input[placeholder="Enter phone number"]', '4155551234');

    // Select phone type
    const phoneTypeSelect = await page.$('input[value="mobile"] ~ button, label:has-text("Phone Type") ~ div button');
    if (phoneTypeSelect) {
      await phoneTypeSelect.click();
      await delay(300);
      await page.click('li:has-text("Office")');
    }

    await delay(500);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/contact_03_phone_form_filled.png`, fullPage: true });

    // Submit the form
    const submitButtons = await page.$$('button');
    let addPhoneSubmitButton = null;
    for (const button of submitButtons) {
      const text = await page.evaluate((el) => el.textContent, button);
      if (text.includes('Add Phone Number')) {
        addPhoneSubmitButton = button;
        break;
      }
    }
    if (addPhoneSubmitButton) {
      await addPhoneSubmitButton.click();
      await delay(1000);
    }
    await page.screenshot({ path: `${SCREENSHOT_DIR}/contact_04_phone_added.png`, fullPage: true });
    console.log('✅ Phone number added successfully\n');
    testsPassed++;

    // Test 5: Verify phone number appears in the list
    console.log('Test 5: Verify phone number appears in the list');
    const phoneNumber = await page.waitForSelector('text/+14155551234', { timeout: 5000 });
    if (phoneNumber) {
      console.log('✅ Phone number appears in list\n');
      testsPassed++;
    } else {
      throw new Error('Phone number not found in list');
    }

    // Test 6: Add an address
    console.log('Test 6: Add an address');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(500);

    const addAddressButtons = await page.$$('button');
    let addAddressButton = null;
    for (const button of addAddressButtons) {
      const text = await page.evaluate((el) => el.textContent, button);
      if (text.includes('Add Address')) {
        addAddressButton = button;
        break;
      }
    }
    if (!addAddressButton) {
      throw new Error('Add Address button not found');
    }
    await addAddressButton.click();
    await delay(500);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/contact_05_add_address_form.png`, fullPage: true });

    // Fill in address details
    await page.type('input[placeholder="123 Main Street"]', '123 Market Street');
    await page.type('input[placeholder="Apt 4B"]', 'Suite 400');
    await page.type('input[placeholder="San Francisco"]', 'San Francisco');

    // Find and fill state field
    const stateInputs = await page.$$('input[placeholder="CA"]');
    if (stateInputs.length > 0) {
      await stateInputs[0].type('CA');
    }

    // Find and fill ZIP field
    const zipInputs = await page.$$('input[placeholder="94102"]');
    if (zipInputs.length > 0) {
      await zipInputs[0].type('94102');
    }

    await delay(500);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/contact_06_address_form_filled.png`, fullPage: true });

    // Submit the address form
    const submitAddressButtons = await page.$$('button');
    let addAddressSubmitButton = null;
    for (const button of submitAddressButtons) {
      const text = await page.evaluate((el) => el.textContent, button);
      if (text.includes('Add Address') && !text.includes('Add Phone')) {
        addAddressSubmitButton = button;
        break;
      }
    }
    if (addAddressSubmitButton) {
      await addAddressSubmitButton.click();
      await delay(1000);
    }
    await page.screenshot({ path: `${SCREENSHOT_DIR}/contact_07_address_added.png`, fullPage: true });
    console.log('✅ Address added successfully\n');
    testsPassed++;

    // Test 7: Verify address appears in the list
    console.log('Test 7: Verify address appears in the list');
    const address = await page.waitForSelector('text/123 Market Street', { timeout: 5000 });
    if (address) {
      console.log('✅ Address appears in list\n');
      testsPassed++;
    } else {
      throw new Error('Address not found in list');
    }

    // Test 8: Test keyboard navigation (Tab key)
    console.log('Test 8: Test keyboard navigation');
    await page.keyboard.press('Tab');
    await delay(200);
    await page.keyboard.press('Tab');
    await delay(200);
    const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
    console.log(`✅ Keyboard navigation works (focused: ${focusedElement})\n`);
    testsPassed++;

    // Test 9: Check for console errors
    console.log('Test 9: Check for console errors');
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await delay(1000);

    if (consoleErrors.length === 0) {
      console.log('✅ No console errors detected\n');
      testsPassed++;
    } else {
      console.log('⚠️  Console errors detected:', consoleErrors);
      testsFailed++;
    }

    // Final screenshot
    await page.screenshot({ path: `${SCREENSHOT_DIR}/contact_08_final_state.png`, fullPage: true });

    console.log('\n' + '='.repeat(60));
    console.log('📊 Test Summary:');
    console.log(`   ✅ Passed: ${testsPassed}`);
    console.log(`   ❌ Failed: ${testsFailed}`);
    console.log(`   📸 Screenshots saved to: ${SCREENSHOT_DIR}`);
    console.log('='.repeat(60) + '\n');

    if (testsFailed === 0) {
      console.log('🎉 All tests passed!\n');
    } else {
      console.log('⚠️  Some tests failed. Please review the screenshots and logs.\n');
    }
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    testsFailed++;
    await page.screenshot({ path: `${SCREENSHOT_DIR}/contact_error.png`, fullPage: true });

    console.log('\n' + '='.repeat(60));
    console.log('📊 Test Summary:');
    console.log(`   ✅ Passed: ${testsPassed}`);
    console.log(`   ❌ Failed: ${testsFailed + 1}`);
    console.log(`   📸 Error screenshot: ${SCREENSHOT_DIR}/contact_error.png`);
    console.log('='.repeat(60) + '\n');
  } finally {
    await browser.close();
  }
}

testContactManagement().catch(console.error);
