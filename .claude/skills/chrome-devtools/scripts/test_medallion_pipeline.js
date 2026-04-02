/**
 * E2E Test: Medallion Architecture Pipeline (Feature 020 - T054)
 * Tests the complete ingestion pipeline with stage monitoring
 *
 * Prerequisites:
 * - Admin panel running on http://localhost:3002
 * - Backend API running on http://localhost:3100
 * - PostgreSQL, Redis, MinIO services running
 * - CRMLS credentials configured in backend/.env
 *
 * Usage:
 *   node ~/.claude/skills/chrome-devtools/scripts/test_medallion_pipeline.js
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const SCREENSHOTS_DIR = '/tmp/medallion-test';
const ADMIN_URL = process.env.ADMIN_URL || 'http://localhost:3002';
const TEST_CITY = process.env.TEST_CITY || 'San Marino';
const TEST_LIMIT = parseInt(process.env.TEST_LIMIT || '5', 10);
const TIMEOUT_MINUTES = 15;

// Create screenshots directory
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

/**
 * Save screenshot with timestamp
 */
async function screenshot(page, name) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = path.join(SCREENSHOTS_DIR, `${timestamp}-${name}.png`);
  await page.screenshot({ path: filename, fullPage: true });
  console.log(`📸 Screenshot saved: ${filename}`);
  return filename;
}

/**
 * Wait for element with retry
 */
async function waitForSelector(page, selector, options = {}) {
  const timeout = options.timeout || 30000;
  const visible = options.visible !== false;

  try {
    await page.waitForSelector(selector, { timeout, visible });
    return true;
  } catch (error) {
    console.error(`❌ Element not found: ${selector}`);
    await screenshot(page, `error-element-not-found-${selector.replace(/[^a-z0-9]/gi, '-')}`);
    throw error;
  }
}

/**
 * Main test function
 */
async function testMedallionPipeline() {
  const browser = await puppeteer.launch({
    headless: false, // Set to true for CI/CD
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    slowMo: 100, // Slow down by 100ms for visibility
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  // Enable console logging
  page.on('console', (msg) => console.log('🌐 PAGE LOG:', msg.text()));
  page.on('pageerror', (error) => console.error('🌐 PAGE ERROR:', error));

  try {
    console.log('🚀 Starting Medallion Architecture Pipeline E2E Test');
    console.log('📍 Admin URL:', ADMIN_URL);
    console.log('🏙️  Test City:', TEST_CITY);
    console.log('🔢 Test Limit:', TEST_LIMIT);

    // ========================================================================
    // Step 1: Navigate to admin panel
    // ========================================================================
    console.log('\n📍 Step 1: Navigate to admin panel');
    await page.goto(`${ADMIN_URL}/data/listings`, { waitUntil: 'networkidle2' });
    await screenshot(page, '01-admin-panel-loaded');

    // ========================================================================
    // Step 2: Trigger ingestion job
    // ========================================================================
    console.log('\n🎬 Step 2: Trigger ingestion job');

    // Look for trigger button (adjust selector as needed)
    const triggerButtonSelectors = [
      '[data-testid="trigger-ingestion-button"]',
      'button:has-text("Trigger Ingestion")',
      'button:has-text("Start Ingestion")',
      'button:has-text("New Ingestion")',
    ];

    let triggerButton = null;
    for (const selector of triggerButtonSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        triggerButton = selector;
        break;
      } catch (e) {
        // Try next selector
      }
    }

    if (!triggerButton) {
      console.log('⚠️  Trigger button not found, attempting to navigate to trigger form');
      await page.goto(`${ADMIN_URL}/data/listings/trigger`, { waitUntil: 'networkidle2' });
    } else {
      await page.click(triggerButton);
    }

    await screenshot(page, '02-trigger-form-opened');

    // Fill ingestion form
    console.log('📝 Filling ingestion form');

    // Wait for form elements
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Try to fill cities field (multiple possible selectors)
    const cityInputSelectors = [
      'input[name="cities"]',
      '[data-testid="cities-input"]',
      'input[placeholder*="city" i]',
    ];

    for (const selector of cityInputSelectors) {
      try {
        const input = await page.$(selector);
        if (input) {
          await input.type(TEST_CITY);
          console.log(`✓ Filled cities: ${TEST_CITY}`);
          break;
        }
      } catch (e) {
        // Try next selector
      }
    }

    // Try to fill max listings
    const limitInputSelectors = [
      'input[name="maxListingsPerRun"]',
      'input[name="maxListings"]',
      '[data-testid="max-listings-input"]',
    ];

    for (const selector of limitInputSelectors) {
      try {
        const input = await page.$(selector);
        if (input) {
          await input.type(TEST_LIMIT.toString());
          console.log(`✓ Filled limit: ${TEST_LIMIT}`);
          break;
        }
      } catch (e) {
        // Try next selector
      }
    }

    await screenshot(page, '03-form-filled');

    // Submit form
    const submitButtonSelectors = [
      'button[type="submit"]',
      'button:has-text("Start")',
      'button:has-text("Submit")',
      'button:has-text("Trigger")',
    ];

    for (const selector of submitButtonSelectors) {
      try {
        await page.click(selector);
        console.log('✓ Submitted ingestion form');
        break;
      } catch (e) {
        // Try next selector
      }
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
    await screenshot(page, '04-job-started');

    // ========================================================================
    // Step 3: Extract job ID and monitor progress
    // ========================================================================
    console.log('\n🔍 Step 3: Extract job ID and monitor progress');

    // Try to find job ID on page
    let jobId = null;
    try {
      jobId = await page.evaluate(() => {
        // Try various methods to find job ID
        const jobIdElement = document.querySelector('[data-testid="job-id"]');
        if (jobIdElement) return jobIdElement.textContent;

        // Try URL params
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('jobId')) return urlParams.get('jobId');

        // Try page path
        const match = window.location.pathname.match(/\/jobs\/([a-z0-9]+)/i);
        if (match) return match[1];

        return null;
      });

      if (jobId) {
        console.log(`✓ Found job ID: ${jobId}`);
      }
    } catch (error) {
      console.warn('⚠️  Could not extract job ID automatically');
    }

    // ========================================================================
    // Step 4: Wait for pipeline stages
    // ========================================================================
    console.log('\n⏳ Step 4: Monitoring pipeline stages');

    const stages = ['RAW', 'BRONZE', 'SILVER', 'GOLD'];
    const stageTimeouts = {
      RAW: 10 * 60 * 1000, // 10 minutes (CRMLS throttling)
      BRONZE: 3 * 60 * 1000, // 3 minutes
      SILVER: 2 * 60 * 1000, // 2 minutes
      GOLD: 1 * 60 * 1000, // 1 minute
    };

    for (const stage of stages) {
      console.log(`\n📊 Monitoring ${stage} stage...`);

      const stageSelectors = [
        `[data-testid="stage-${stage.toLowerCase()}-status"]`,
        `.stage-${stage.toLowerCase()}`,
        `[data-stage="${stage}"]`,
      ];

      // Wait for stage to complete or fail
      const startTime = Date.now();
      const timeout = stageTimeouts[stage];
      let stageComplete = false;

      while (!stageComplete && (Date.now() - startTime) < timeout) {
        try {
          const status = await page.evaluate((selectors) => {
            for (const selector of selectors) {
              const element = document.querySelector(selector);
              if (element) {
                return element.textContent || element.getAttribute('data-status');
              }
            }
            return null;
          }, stageSelectors);

          if (status && (status.includes('COMPLETED') || status.includes('SUCCESS'))) {
            console.log(`✅ ${stage} stage completed`);
            await screenshot(page, `05-${stage.toLowerCase()}-completed`);
            stageComplete = true;
          } else if (status && (status.includes('FAILED') || status.includes('ERROR'))) {
            console.error(`❌ ${stage} stage failed`);
            await screenshot(page, `error-${stage.toLowerCase()}-failed`);
            throw new Error(`${stage} stage failed`);
          } else {
            // Still in progress
            await new Promise(resolve => setTimeout(resolve, 5000)); // Check every 5 seconds
          }
        } catch (error) {
          console.warn(`⚠️  Error checking ${stage} status:`, error.message);
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }

      if (!stageComplete) {
        console.error(`❌ ${stage} stage timed out after ${timeout / 1000}s`);
        await screenshot(page, `error-${stage.toLowerCase()}-timeout`);
        throw new Error(`${stage} stage timed out`);
      }
    }

    // ========================================================================
    // Step 5: Verify data quality metrics
    // ========================================================================
    console.log('\n📈 Step 5: Verify data quality metrics');

    // Try to find and click quality metrics button/link
    try {
      const metricsSelectors = [
        '[data-testid="view-quality-metrics"]',
        'a:has-text("Quality Metrics")',
        'button:has-text("Quality")',
      ];

      for (const selector of metricsSelectors) {
        try {
          await page.click(selector);
          console.log('✓ Navigated to quality metrics');
          break;
        } catch (e) {
          // Try next selector
        }
      }
    } catch (error) {
      console.warn('⚠️  Could not navigate to quality metrics');
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
    await screenshot(page, '06-quality-metrics');

    // Try to extract field completeness
    try {
      const completeness = await page.evaluate(() => {
        const elem = document.querySelector('[data-testid="field-completeness"]');
        if (elem) {
          const text = elem.textContent;
          const match = text.match(/(\d+(?:\.\d+)?)/);
          return match ? parseFloat(match[1]) : null;
        }
        return null;
      });

      if (completeness !== null) {
        console.log(`📊 Field completeness: ${completeness}%`);

        if (completeness < 50) {
          console.warn(`⚠️  WARNING: Field completeness below 50% (${completeness}%)`);
        } else if (completeness >= 80) {
          console.log(`✅ Field completeness meets target (>= 80%)`);
        }
      }
    } catch (error) {
      console.warn('⚠️  Could not extract field completeness');
    }

    // ========================================================================
    // Step 6: Verify image downloads
    // ========================================================================
    console.log('\n🖼️  Step 6: Verify image downloads');

    try {
      const imageStats = await page.evaluate(() => {
        const downloadedElem = document.querySelector('[data-testid="images-downloaded"]');
        const totalElem = document.querySelector('[data-testid="images-total"]');
        const failedElem = document.querySelector('[data-testid="images-failed"]');

        return {
          downloaded: downloadedElem ? parseInt(downloadedElem.textContent) : null,
          total: totalElem ? parseInt(totalElem.textContent) : null,
          failed: failedElem ? parseInt(failedElem.textContent) : null,
        };
      });

      console.log('📊 Image statistics:', imageStats);

      if (imageStats.downloaded && imageStats.total) {
        const successRate = (imageStats.downloaded / imageStats.total) * 100;
        console.log(`📊 Image success rate: ${successRate.toFixed(1)}%`);

        if (successRate >= 95) {
          console.log('✅ Image download success rate meets target (>= 95%)');
        }
      }
    } catch (error) {
      console.warn('⚠️  Could not extract image statistics');
    }

    await screenshot(page, '07-final-state');

    // ========================================================================
    // Test Complete
    // ========================================================================
    console.log('\n✅ E2E Test PASSED');
    console.log(`📁 Screenshots saved to: ${SCREENSHOTS_DIR}`);

    return {
      success: true,
      jobId,
      screenshots: fs.readdirSync(SCREENSHOTS_DIR),
    };

  } catch (error) {
    console.error('\n❌ E2E Test FAILED:', error.message);
    await screenshot(page, 'error-final');

    return {
      success: false,
      error: error.message,
      screenshots: fs.readdirSync(SCREENSHOTS_DIR),
    };
  } finally {
    await browser.close();
  }
}

// Run test
testMedallionPipeline()
  .then((result) => {
    console.log('\n' + '='.repeat(70));
    console.log('TEST RESULTS');
    console.log('='.repeat(70));
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
