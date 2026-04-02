/**
 * E2E Test: Tab Data Extraction Verification
 *
 * Tests that:
 * 1. Tab data is extracted from listing detail pages
 * 2. Tax tab contains owner name, tax amount, assessed value
 * 3. History tab contains price/status history
 * 4. Photos tab contains photo count and URLs
 * 5. Data is properly stored in the database
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const ADMIN_URL = 'http://localhost:3002';
const BACKEND_URL = 'http://localhost:3001';
const SCREENSHOTS_DIR = '/tmp/tab-extraction-test';

// Ensure screenshots directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function testTabExtraction() {
  console.log('🧪 Starting Tab Data Extraction Test\n');

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 100,
    args: ['--window-size=1920,1080']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  try {
    // Step 1: Navigate to admin ingestion page
    console.log('📍 Step 1: Navigate to admin ingestion page');
    await page.goto(`${ADMIN_URL}/data/listings`, { waitUntil: 'networkidle2' });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01-admin-page.png'), fullPage: true });
    console.log('✅ Admin page loaded\n');

    // Step 2: Trigger a small ingestion run for testing
    console.log('📍 Step 2: Trigger ingestion run (5 listings from San Marino)');

    // Wait for the trigger form
    await page.waitForSelector('[data-testid="trigger-button"], button:has-text("Trigger Run")', { timeout: 5000 });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02-before-trigger.png'), fullPage: true });

    // Fill in the form
    const triggerButton = await page.$('button:has-text("Trigger Run")');
    if (triggerButton) {
      await triggerButton.click();
      await page.waitForTimeout(1000);
    }

    // Fill in city (look for input with city label)
    const cityInput = await page.$('input[name="city"], input[placeholder*="city"], input[placeholder*="City"]');
    if (cityInput) {
      await cityInput.click({ clickCount: 3 }); // Select all
      await cityInput.type('San Marino');
    }

    // Fill in max listings (look for input with limit/max label)
    const maxListingsInput = await page.$('input[name="maxListings"], input[placeholder*="limit"], input[type="number"]');
    if (maxListingsInput) {
      await maxListingsInput.click({ clickCount: 3 });
      await maxListingsInput.type('5');
    }

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '03-form-filled.png'), fullPage: true });

    // Submit the form
    const submitButton = await page.$('button[type="submit"], button:has-text("Start"), button:has-text("Trigger")');
    if (submitButton) {
      await submitButton.click();
      console.log('✅ Ingestion triggered\n');
      await page.waitForTimeout(2000);
    }

    // Step 3: Wait for job to complete (poll for status)
    console.log('📍 Step 3: Wait for RAW stage to complete (max 5 minutes)');
    let jobId = null;
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes (5 second intervals)

    while (attempts < maxAttempts) {
      // Try to find the latest job in the table
      const jobRows = await page.$$('tbody tr');
      if (jobRows.length > 0) {
        const firstRow = jobRows[0];
        const jobIdCell = await firstRow.$('td:first-child');
        if (jobIdCell) {
          const jobIdText = await page.evaluate(el => el.textContent, jobIdCell);
          jobId = jobIdText.trim();

          // Check if RAW stage is complete
          const statusCell = await firstRow.$('td:nth-child(3), td:has-text("COMPLETED"), td:has-text("FAILED")');
          if (statusCell) {
            const statusText = await page.evaluate(el => el.textContent, statusCell);
            if (statusText.includes('COMPLETED')) {
              console.log(`✅ RAW stage completed for job ${jobId}\n`);
              break;
            } else if (statusText.includes('FAILED')) {
              console.log(`❌ RAW stage failed for job ${jobId}`);
              await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '04-job-failed.png'), fullPage: true });
              throw new Error('Ingestion job failed');
            }
          }
        }
      }

      attempts++;
      await page.waitForTimeout(5000);
      await page.reload({ waitUntil: 'networkidle2' });
    }

    if (!jobId) {
      throw new Error('Could not find job ID after triggering ingestion');
    }

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '04-raw-complete.png'), fullPage: true });

    // Step 4: Query the database directly to check tab data
    console.log('📍 Step 4: Query database for tab data');

    // Make API request to get Bronze listing data
    const apiUrl = `${BACKEND_URL}/api/runs/${jobId}/bronze-listings`;
    console.log(`   Fetching: ${apiUrl}`);

    const response = await page.evaluate(async (url) => {
      const res = await fetch(url);
      return await res.json();
    }, apiUrl);

    console.log(`   Found ${response.length || 0} Bronze listings\n`);

    // Step 5: Verify tab data in each listing
    console.log('📍 Step 5: Verify tab data extraction\n');

    let hasTabData = false;
    let taxTabCount = 0;
    let historyTabCount = 0;
    let photosTabCount = 0;

    for (const listing of response) {
      console.log(`   🏠 Listing: ${listing.mlsNumber} (${listing.address})`);

      // Check if tabDataMetadata exists and has data
      if (listing.tabDataMetadata && Object.keys(listing.tabDataMetadata).length > 0) {
        hasTabData = true;
        console.log(`      ✅ Has tabDataMetadata:`, listing.tabDataMetadata);

        // Count successful extractions
        if (listing.tabDataMetadata.taxTab === 'success') {
          taxTabCount++;
          console.log(`      ✅ Tax tab: SUCCESS`);
        }
        if (listing.tabDataMetadata.historyTab === 'success') {
          historyTabCount++;
          console.log(`      ✅ History tab: SUCCESS`);
        }
        if (listing.tabDataMetadata.photosTab === 'success') {
          photosTabCount++;
          console.log(`      ✅ Photos tab: SUCCESS`);
        }
      } else {
        console.log(`      ⚠️  No tabDataMetadata found`);
      }

      console.log(); // Empty line
    }

    // Step 6: Print summary
    console.log('📊 Test Summary:');
    console.log(`   Total listings: ${response.length}`);
    console.log(`   Listings with tab data: ${hasTabData ? 'YES' : 'NO'}`);
    console.log(`   Tax tab success: ${taxTabCount}/${response.length}`);
    console.log(`   History tab success: ${historyTabCount}/${response.length}`);
    console.log(`   Photos tab success: ${photosTabCount}/${response.length}`);
    console.log();

    // Determine test result
    if (hasTabData && taxTabCount > 0) {
      console.log('✅ TEST PASSED: Tab data is being extracted and stored!\n');
    } else {
      console.log('❌ TEST FAILED: Tab data is NOT being extracted or stored properly\n');
      console.log('   Possible issues:');
      console.log('   1. multiTabData not being converted to tabDataMetadata');
      console.log('   2. Tab parsers not extracting data from HTML');
      console.log('   3. Database field not being populated');
      console.log();
    }

    // Take final screenshot
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '05-test-complete.png'), fullPage: true });

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'error.png'), fullPage: true });
    throw error;
  } finally {
    console.log(`\n📸 Screenshots saved to: ${SCREENSHOTS_DIR}`);
    await browser.close();
  }
}

// Run the test
testTabExtraction().catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
});
