#!/usr/bin/env node

/**
 * Debug Admin Dashboard
 * Check console errors, network failures, and page state
 */

import puppeteer from 'puppeteer';

const ADMIN_URL = 'http://localhost:3002';
const SCREENSHOT_DIR = '/tmp';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function debugDashboard() {
  console.log('🔍 Starting Admin Dashboard Debug...\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--window-size=1920,1080'],
  });

  const page = await browser.newPage();

  // Collect console messages
  const consoleMessages = [];
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    consoleMessages.push({ type, text });
    console.log(`[CONSOLE ${type.toUpperCase()}] ${text}`);
  });

  // Collect network errors
  const networkErrors = [];
  page.on('requestfailed', request => {
    const error = {
      url: request.url(),
      failure: request.failure()?.errorText || 'Unknown error',
    };
    networkErrors.push(error);
    console.log(`[NETWORK ERROR] ${error.url} - ${error.failure}`);
  });

  // Collect page errors
  const pageErrors = [];
  page.on('pageerror', error => {
    pageErrors.push(error.message);
    console.log(`[PAGE ERROR] ${error.message}`);
  });

  try {
    console.log('📍 Navigating to /dashboard...\n');

    await page.goto(`${ADMIN_URL}/dashboard`, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });

    await sleep(3000);

    // Take screenshot
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/dashboard_debug.png`,
      fullPage: true,
    });
    console.log('\n📸 Screenshot saved: /tmp/dashboard_debug.png\n');

    // Check page content
    const pageInfo = await page.evaluate(() => {
      return {
        title: document.title,
        bodyText: document.body.innerText.substring(0, 500),
        hasError: document.body.innerText.includes('Error'),
        hasLoading: document.body.innerText.includes('Loading'),
        elementCount: document.querySelectorAll('*').length,
      };
    });

    console.log('═══════════════════════════════════════');
    console.log('PAGE INFO');
    console.log('═══════════════════════════════════════');
    console.log(`Title: ${pageInfo.title}`);
    console.log(`Elements: ${pageInfo.elementCount}`);
    console.log(`Has Error: ${pageInfo.hasError}`);
    console.log(`Has Loading: ${pageInfo.hasLoading}`);
    console.log('\nBody Text (first 500 chars):');
    console.log(pageInfo.bodyText);
    console.log('');

    // Check for specific elements
    const elements = await page.evaluate(() => {
      return {
        h4: !!document.querySelector('h4'),
        dashboard: document.body.innerText.includes('Dashboard'),
        stats: document.querySelectorAll('[class*="MuiPaper-root"]').length,
        error: !!document.querySelector('[color="error"]'),
        loading: !!document.querySelector('[class*="CircularProgress"]'),
      };
    });

    console.log('═══════════════════════════════════════');
    console.log('ELEMENT CHECK');
    console.log('═══════════════════════════════════════');
    console.log(`H4 heading: ${elements.h4}`);
    console.log(`"Dashboard" text: ${elements.dashboard}`);
    console.log(`Paper elements (stat cards): ${elements.stats}`);
    console.log(`Error element: ${elements.error}`);
    console.log(`Loading indicator: ${elements.loading}`);
    console.log('');

    // Check API responses
    console.log('═══════════════════════════════════════');
    console.log('CHECKING API ENDPOINT');
    console.log('═══════════════════════════════════════');

    const apiResponse = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/dashboard/stats');
        const data = await response.json();
        return {
          status: response.status,
          ok: response.ok,
          data: data,
        };
      } catch (error) {
        return {
          error: error.message,
        };
      }
    });

    if (apiResponse.error) {
      console.log(`API Error: ${apiResponse.error}`);
    } else {
      console.log(`API Status: ${apiResponse.status} (${apiResponse.ok ? 'OK' : 'FAILED'})`);
      console.log('API Response:', JSON.stringify(apiResponse.data, null, 2));
    }
    console.log('');

    // Summary
    console.log('═══════════════════════════════════════');
    console.log('SUMMARY');
    console.log('═══════════════════════════════════════');
    console.log(`Console Messages: ${consoleMessages.length}`);
    console.log(`Network Errors: ${networkErrors.length}`);
    console.log(`Page Errors: ${pageErrors.length}`);
    console.log('');

    if (networkErrors.length > 0) {
      console.log('Network Errors:');
      networkErrors.forEach((err, idx) => {
        console.log(`  ${idx + 1}. ${err.url}`);
        console.log(`     ${err.failure}`);
      });
      console.log('');
    }

    if (pageErrors.length > 0) {
      console.log('Page Errors:');
      pageErrors.forEach((err, idx) => {
        console.log(`  ${idx + 1}. ${err}`);
      });
      console.log('');
    }

    // Keep browser open for manual inspection
    console.log('Browser kept open for manual inspection...');
    console.log('Press Ctrl+C to close');

    await sleep(60000); // Keep open for 60 seconds

  } catch (error) {
    console.error('❌ Debug failed:', error.message);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/dashboard_debug_error.png`,
      fullPage: true,
    });
    console.log('📸 Error screenshot saved: /tmp/dashboard_debug_error.png');

    throw error;
  } finally {
    await browser.close();
  }
}

debugDashboard().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
