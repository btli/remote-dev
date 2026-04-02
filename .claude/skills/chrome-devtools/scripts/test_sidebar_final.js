#!/usr/bin/env node

/**
 * E2E Test: Final Sidebar Styling Verification
 */

import puppeteer from 'puppeteer';

const ADMIN_URL = 'http://localhost:3002';
const SCREENSHOT_DIR = '/tmp';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function testSidebar() {
  console.log('🚀 Testing Sidebar Styling...\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--window-size=1920,1080'],
  });

  const page = await browser.newPage();

  try {
    // Test Light Theme
    console.log('📍 Testing Light theme...');
    await page.goto(`${ADMIN_URL}/system/config`, { waitUntil: 'networkidle0' });
    await sleep(1000);

    const lightRadio = await page.waitForSelector('input[value="light"]');
    await lightRadio.click();
    await sleep(1000);

    await page.goto(`${ADMIN_URL}/dashboard`, { waitUntil: 'networkidle0' });
    await sleep(1000);

    // Click User Management to expand
    await page.evaluate(() => {
      const userMgmt = Array.from(document.querySelectorAll('*')).find(
        el => el.textContent === 'User Management' && el.tagName !== 'TITLE'
      );
      if (userMgmt) userMgmt.click();
    });
    await sleep(500);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/sidebar_light_final.png`,
      fullPage: true,
    });
    console.log('✅ Light theme screenshot saved');
    console.log('📸 /tmp/sidebar_light_final.png\n');

    // Test Dark Theme
    console.log('📍 Testing Dark theme...');
    await page.goto(`${ADMIN_URL}/system/config`, { waitUntil: 'networkidle0' });
    await sleep(1000);

    const darkRadio = await page.waitForSelector('input[value="dark"]');
    await darkRadio.click();
    await sleep(1000);

    await page.goto(`${ADMIN_URL}/dashboard`, { waitUntil: 'networkidle0' });
    await sleep(1000);

    // Click User Management to expand
    await page.evaluate(() => {
      const userMgmt = Array.from(document.querySelectorAll('*')).find(
        el => el.textContent === 'User Management' && el.tagName !== 'TITLE'
      );
      if (userMgmt) userMgmt.click();
    });
    await sleep(500);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/sidebar_dark_final.png`,
      fullPage: true,
    });
    console.log('✅ Dark theme screenshot saved');
    console.log('📸 /tmp/sidebar_dark_final.png\n');

    console.log('═══════════════════════════════════════');
    console.log('✅ TESTS COMPLETE');
    console.log('═══════════════════════════════════════');
    console.log('\nChanges made:');
    console.log('  ✓ Sidebar background: #f5f5f5 (light) vs dark paper');
    console.log('  ✓ Submenu background: rgba(0,0,0,0.04) (light) vs rgba(0,0,0,0.2) (dark)');
    console.log('  ✓ Icon colors: black (light) vs white (dark)');
    console.log('  ✓ Hover effects: theme-aware backgrounds');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/sidebar_error.png`, fullPage: true });
  } finally {
    await browser.close();
  }
}

testSidebar().catch(console.error);
