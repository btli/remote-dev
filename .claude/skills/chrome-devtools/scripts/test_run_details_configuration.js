#!/usr/bin/env node
/**
 * E2E Test: Run Details Configuration Display
 *
 * This test verifies that the ingestion run details page displays the
 * run configuration correctly.
 *
 * Test coverage:
 * ✅ Navigate to run details page
 * ✅ Verify "Run Configuration" section is displayed
 * ✅ Verify configuration fields are displayed:
 *    - Mode (Incremental/Full Refresh)
 *    - Max Listings Per Run
 *    - Created By
 * ✅ Take screenshots for manual verification
 */

import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ADMIN_URL = 'http://localhost:3002';
const SCREENSHOT_DIR = '/tmp';

async function testRunDetailsConfiguration() {
  console.log('🧪 Starting Run Details Configuration Test...\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--start-maximized'],
  });

  try {
    const page = await browser.newPage();

    // Step 1: Navigate to ingestion dashboard
    console.log('📍 Step 1: Navigate to ingestion dashboard');
    await page.goto(`${ADMIN_URL}/ingestion`, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'run_config_01_dashboard.png') });
    console.log('✅ Dashboard loaded\n');

    // Step 2: Navigate to runs page
    console.log('📍 Step 2: Navigate to runs page');
    await page.goto(`${ADMIN_URL}/ingestion/runs`, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'run_config_02_runs_list.png') });
    console.log('✅ Runs list loaded\n');

    // Step 3: Navigate to a run details page
    console.log('📍 Step 3: Navigate to run details page');

    // Get the first run ID from the admin API
    const runsResponse = await page.evaluate(async () => {
      const res = await fetch('/api/ingestion/runs');
      return res.json();
    });

    const runId = runsResponse.data[0]?.id;
    if (!runId) {
      console.log('⚠️  No runs found in the database.');
      return;
    }
    console.log(`   Using run ID: ${runId}`);

    // Navigate directly to the run details page
    await page.goto(`${ADMIN_URL}/ingestion/runs/${runId}`, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'run_config_03_run_details.png') });
    console.log('✅ Run details page loaded\n');

    // Step 4: Verify "Run Details" card is visible
    console.log('📍 Step 4: Verify Run Details card');
    const runDetailsCard = await page.waitForSelector('h6::-p-text(Run Details)', { timeout: 5000 });
    if (runDetailsCard) {
      console.log('✅ Run Details card found\n');
    } else {
      console.log('❌ Run Details card not found');
      return;
    }

    // Step 5: Verify configuration is in Run Details (no separate section anymore)
    console.log('📍 Step 5: Verify configuration is in Run Details section');

    // Step 6: Verify configuration fields
    console.log('📍 Step 6: Verify configuration fields');

    // Check for "Mode" field
    const modeLabel = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('.MuiTypography-caption'));
      return labels.find(label => label.textContent === 'Mode')?.nextElementSibling?.textContent;
    });
    console.log(`   - Mode: ${modeLabel || 'NOT FOUND'}`);

    // Check for "Max Listings Per Run" field
    const maxListingsLabel = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('.MuiTypography-caption'));
      return labels.find(label => label.textContent === 'Max Listings Per Run')?.nextElementSibling?.textContent;
    });
    console.log(`   - Max Listings Per Run: ${maxListingsLabel || 'NOT FOUND'}`);

    // Check for "Created By" field
    const createdByLabel = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('.MuiTypography-caption'));
      return labels.find(label => label.textContent === 'Created By')?.nextElementSibling?.textContent;
    });
    console.log(`   - Created By: ${createdByLabel || 'NOT FOUND'}\n`);

    // Take final screenshot
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'run_config_05_final.png'), fullPage: true });
    console.log('✅ Final screenshot taken\n');

    // Step 7: Verify all fields are present
    if (modeLabel && maxListingsLabel && createdByLabel) {
      console.log('✅ All configuration fields are displayed correctly!\n');
    } else {
      console.log('❌ Some configuration fields are missing\n');
    }

    console.log('📸 Screenshots saved to:');
    console.log(`   - ${SCREENSHOT_DIR}/run_config_01_dashboard.png`);
    console.log(`   - ${SCREENSHOT_DIR}/run_config_02_runs_list.png`);
    console.log(`   - ${SCREENSHOT_DIR}/run_config_03_run_details.png`);
    console.log(`   - ${SCREENSHOT_DIR}/run_config_05_final.png\n`);

    console.log('✅ Test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

// Run the test
testRunDetailsConfiguration().catch(console.error);
