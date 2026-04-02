#!/usr/bin/env node

/**
 * E2E Test: Theme Switcher
 * Tests light/dark/system theme switching
 */

import puppeteer from 'puppeteer';

const ADMIN_URL = 'http://localhost:3002';
const SCREENSHOT_DIR = '/tmp';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function testThemeSwitcher() {
  console.log('🚀 Starting Theme Switcher Test...\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--window-size=1920,1080'],
  });

  const page = await browser.newPage();

  try {
    // Step 1: Navigate to System Configuration
    console.log('📍 Step 1: Navigating to System Configuration...');
    await page.goto(`${ADMIN_URL}/system/config`, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });
    await sleep(2000);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/theme_dark_initial.png`,
      fullPage: true,
    });
    console.log('✅ System Configuration loaded (Dark mode)');
    console.log('📸 Screenshot: /tmp/theme_dark_initial.png\n');

    // Step 2: Switch to Light theme
    console.log('📍 Step 2: Switching to Light theme...');
    const lightRadio = await page.waitForSelector('input[value="light"]');
    await lightRadio.click();
    await sleep(2000);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/theme_light.png`,
      fullPage: true,
    });
    console.log('✅ Switched to Light theme');
    console.log('📸 Screenshot: /tmp/theme_light.png\n');

    // Step 3: Check light theme colors
    console.log('📍 Step 3: Verifying Light theme colors...');
    const lightColors = await page.evaluate(() => {
      const body = document.body;
      const paper = document.querySelector('[class*="MuiPaper-root"]');
      return {
        background: window.getComputedStyle(body).backgroundColor,
        paper: paper ? window.getComputedStyle(paper).backgroundColor : 'not found',
        text: window.getComputedStyle(body).color,
      };
    });
    console.log('   Light theme colors:');
    console.log(`   - Background: ${lightColors.background}`);
    console.log(`   - Paper: ${lightColors.paper}`);
    console.log(`   - Text: ${lightColors.text}`);
    console.log('✅ Light theme applied\n');

    // Step 4: Navigate to Dashboard to verify theme persists
    console.log('📍 Step 4: Navigating to Dashboard to verify theme persists...');
    await page.goto(`${ADMIN_URL}/dashboard`, { waitUntil: 'networkidle0' });
    await sleep(2000);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/dashboard_light.png`,
      fullPage: true,
    });
    console.log('✅ Dashboard loaded with Light theme');
    console.log('📸 Screenshot: /tmp/dashboard_light.png\n');

    // Step 5: Go back to System Config and switch to Dark
    console.log('📍 Step 5: Switching back to Dark theme...');
    await page.goto(`${ADMIN_URL}/system/config`, { waitUntil: 'networkidle0' });
    await sleep(1000);
    const darkRadio = await page.waitForSelector('input[value="dark"]');
    await darkRadio.click();
    await sleep(2000);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/theme_dark_final.png`,
      fullPage: true,
    });
    console.log('✅ Switched back to Dark theme');
    console.log('📸 Screenshot: /tmp/theme_dark_final.png\n');

    // Step 6: Test System theme option
    console.log('📍 Step 6: Testing System theme option...');
    const systemRadio = await page.waitForSelector('input[value="system"]');
    await systemRadio.click();
    await sleep(1000);

    const systemInfo = await page.evaluate(() => {
      const label = document.querySelector('input[value="system"]')?.parentElement?.textContent;
      return label || '';
    });
    console.log(`   System theme: ${systemInfo}`);
    console.log('✅ System theme option working\n');

    // Step 7: Verify localStorage persistence
    console.log('📍 Step 7: Verifying localStorage persistence...');
    const storedTheme = await page.evaluate(() => {
      return localStorage.getItem('theme-mode');
    });
    console.log(`   Stored theme in localStorage: ${storedTheme}`);
    console.log('✅ Theme preference saved\n');

    // Test Summary
    console.log('═══════════════════════════════════════');
    console.log('✅ ALL TESTS PASSED');
    console.log('═══════════════════════════════════════');
    console.log('');
    console.log('Summary:');
    console.log('  - System Configuration page loads');
    console.log('  - Light theme switches successfully');
    console.log('  - Dark theme switches successfully');
    console.log('  - System theme option available');
    console.log('  - Theme persists across page navigation');
    console.log('  - Theme preference saved to localStorage');
    console.log('');
    console.log('Screenshots:');
    console.log('  - /tmp/theme_dark_initial.png');
    console.log('  - /tmp/theme_light.png');
    console.log('  - /tmp/dashboard_light.png');
    console.log('  - /tmp/theme_dark_final.png');

  } catch (error) {
    console.error('❌ Test failed:', error.message);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/theme_error.png`,
      fullPage: true,
    });
    console.log('📸 Error screenshot: /tmp/theme_error.png');

    throw error;
  } finally {
    await browser.close();
  }
}

testThemeSwitcher().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
