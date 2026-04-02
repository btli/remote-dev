import puppeteer from 'puppeteer';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * E2E Test: Admin Portal Ingestion Trigger for San Marino
 *
 * Tests the complete flow:
 * 1. Navigate to admin portal ingestion page
 * 2. Fill in the trigger form with San Marino
 * 3. Submit the form
 * 4. Verify run ID is created
 * 5. Monitor the backend ingestion process
 * 6. Verify completion in database
 */

const ADMIN_URL = 'http://localhost:3002';
const INGESTION_PAGE = `${ADMIN_URL}/ingestion`;

async function waitForRunCompletion(runId, maxWaitSeconds = 300) {
  console.log(`\n[Test] Waiting for run ${runId} to complete (max ${maxWaitSeconds}s)...`);

  const startTime = Date.now();
  const maxWaitMs = maxWaitSeconds * 1000;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      // Query database for run status
      const { stdout } = await execAsync(
        `cd /Users/bryanli/Projects/joyfulhouse/websites/kaelyn.ai/backend && ` +
        `node -e "` +
        `import('dotenv/config'); ` +
        `import { PrismaClient } from '@prisma/client'; ` +
        `const prisma = new PrismaClient(); ` +
        `const run = await prisma.ingestionRun.findUnique({ where: { id: '${runId}' } }); ` +
        `console.log(JSON.stringify(run)); ` +
        `await prisma.\\$disconnect();` +
        `"`,
        { shell: '/bin/bash' }
      );

      const run = JSON.parse(stdout.trim());

      if (!run) {
        console.log(`[Test] Run ${runId} not found in database`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }

      console.log(`[Test] Run status: ${run.status}, processed: ${run.listingsProcessed}, errors: ${run.errorCount}`);

      if (run.status === 'COMPLETED' || run.status === 'PARTIAL') {
        console.log(`\n[Test] ✅ Run ${runId} completed successfully!`);
        console.log(`[Test] Listings processed: ${run.listingsProcessed}`);
        console.log(`[Test] Listings added: ${run.listingsAdded}`);
        console.log(`[Test] Listings updated: ${run.listingsUpdated}`);
        console.log(`[Test] Images downloaded: ${run.imagesDownloaded}`);
        console.log(`[Test] Errors: ${run.errorCount}`);
        console.log(`[Test] Duration: ${Math.round(run.durationMs / 1000)}s`);
        return true;
      }

      if (run.status === 'FAILED') {
        console.log(`\n[Test] ❌ Run ${runId} failed`);
        return false;
      }

      // Still running, wait and check again
      await new Promise(resolve => setTimeout(resolve, 5000));

    } catch (error) {
      console.error(`[Test] Error checking run status:`, error.message);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log(`\n[Test] ⚠️ Run ${runId} did not complete within ${maxWaitSeconds}s`);
  return false;
}

async function testIngestionTrigger() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--start-maximized']
  });

  try {
    const page = await browser.newPage();

    // Enable request interception to log API calls
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.url().includes('/api/ingestion')) {
        console.log(`[Network] ${request.method()} ${request.url()}`);
        if (request.postData()) {
          console.log(`[Network] Request body:`, request.postData());
        }
      }
      request.continue();
    });

    page.on('response', async response => {
      if (response.url().includes('/api/ingestion')) {
        const status = response.status();
        console.log(`[Network] Response ${status} from ${response.url()}`);

        try {
          const body = await response.text();
          console.log(`[Network] Response body:`, body);
        } catch (e) {
          // Ignore errors reading response body
        }
      }
    });

    // Log console messages from the browser
    page.on('console', msg => {
      const type = msg.type();
      if (type === 'error' || type === 'warning') {
        console.log(`[Browser ${type}]`, msg.text());
      }
    });

    console.log(`[Test] Step 1: Navigate to admin portal ingestion page`);
    await page.goto(INGESTION_PAGE, { waitUntil: 'networkidle0' });

    // Take screenshot of initial page
    await page.screenshot({ path: '/tmp/ingestion_01_initial.png', fullPage: true });
    console.log(`[Test] Screenshot saved: /tmp/ingestion_01_initial.png`);

    console.log(`\n[Test] Step 2: Find and interact with trigger form`);

    // Wait for the form to be visible
    await page.waitForSelector('form', { timeout: 10000 });

    // Select San Marino from the cities dropdown
    console.log(`[Test] Opening cities dropdown...`);
    await page.click('[aria-labelledby="cities-label"]');
    await page.waitForSelector('[role="listbox"]');

    // Take screenshot of dropdown
    await page.screenshot({ path: '/tmp/ingestion_02_dropdown.png', fullPage: true });
    console.log(`[Test] Screenshot saved: /tmp/ingestion_02_dropdown.png`);

    // Click on "San Marino" option
    console.log(`[Test] Selecting San Marino...`);
    const options = await page.$$('[role="option"]');

    for (const option of options) {
      const text = await option.evaluate(el => el.textContent);
      if (text === 'San Marino') {
        await option.click();
        console.log(`[Test] ✅ Selected San Marino`);
        break;
      }
    }

    // Click outside to close dropdown
    await page.click('h1, h2, h3, h4, h5, h6');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Take screenshot after selection
    await page.screenshot({ path: '/tmp/ingestion_03_selected.png', fullPage: true });
    console.log(`[Test] Screenshot saved: /tmp/ingestion_03_selected.png`);

    // Select mode (keep INCREMENTAL as default)
    console.log(`[Test] Mode: INCREMENTAL (default)`);

    // Set lookback days to 7
    console.log(`[Test] Setting lookback days to 7...`);
    await page.evaluate(() => {
      const lookbackInput = document.querySelector('input[type="number"]');
      if (lookbackInput) {
        lookbackInput.value = '7';
        lookbackInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    console.log(`\n[Test] Step 3: Submit the form`);

    // Find and click submit button
    const submitButton = await page.$('button[type="submit"]');

    if (!submitButton) {
      throw new Error('Submit button not found');
    }

    const buttonText = await submitButton.evaluate(el => el.textContent);
    console.log(`[Test] Clicking button: "${buttonText}"`);

    // Click submit and wait for response
    await submitButton.click();

    // Wait for either success or error message
    console.log(`[Test] Waiting for response...`);

    try {
      // Wait for either Alert (error/warning) or success state
      await page.waitForFunction(
        () => {
          const alerts = document.querySelectorAll('[role="alert"]');
          return alerts.length > 0;
        },
        { timeout: 10000 }
      );

      // Check if there's an error or warning
      const alertText = await page.evaluate(() => {
        const alerts = document.querySelectorAll('[role="alert"]');
        return Array.from(alerts).map(alert => ({
          severity: alert.classList.contains('MuiAlert-standardError') ? 'error' :
                    alert.classList.contains('MuiAlert-standardWarning') ? 'warning' :
                    alert.classList.contains('MuiAlert-standardSuccess') ? 'success' : 'info',
          text: alert.textContent
        }));
      });

      console.log(`[Test] Alert messages:`, alertText);

      // Take screenshot
      await page.screenshot({ path: '/tmp/ingestion_04_response.png', fullPage: true });
      console.log(`[Test] Screenshot saved: /tmp/ingestion_04_response.png`);

      // Check if we got a duplicate run warning (409)
      const hasDuplicateWarning = alertText.some(alert =>
        alert.severity === 'warning' && alert.text.includes('already in progress')
      );

      if (hasDuplicateWarning) {
        console.log(`\n[Test] ⚠️ Duplicate run detected - another ingestion is already running`);
        console.log(`[Test] This is expected behavior. Waiting for current run to complete...`);

        // Extract run ID from warning if possible
        const runIdMatch = alertText[0].text.match(/Run ID:\s*([a-f0-9-]+)/i);
        if (runIdMatch) {
          const runId = runIdMatch[1];
          console.log(`[Test] Found existing run ID: ${runId}`);

          // Wait for existing run to complete
          const success = await waitForRunCompletion(runId, 300);

          if (success) {
            console.log(`\n[Test] ✅ E2E test passed - Existing run completed successfully`);
          } else {
            console.log(`\n[Test] ❌ E2E test failed - Existing run did not complete`);
          }

          return success;
        }
      }

      // Check for errors
      const hasError = alertText.some(alert => alert.severity === 'error');

      if (hasError) {
        console.log(`\n[Test] ❌ Error submitting form`);
        return false;
      }

    } catch (error) {
      console.log(`[Test] No alert found, checking for other success indicators...`);
    }

    // Look for run ID in network responses or page content
    console.log(`\n[Test] Step 4: Extract run ID from response`);

    // Wait a bit for any delayed UI updates
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Try to find run ID in page content
    const pageContent = await page.content();
    const runIdMatch = pageContent.match(/"runId"\s*:\s*"([a-f0-9-]+)"/i) ||
                       pageContent.match(/run\s+id[:\s]+([a-f0-9-]+)/i);

    if (runIdMatch) {
      const runId = runIdMatch[1];
      console.log(`[Test] ✅ Found run ID: ${runId}`);

      // Wait for ingestion to complete
      const success = await waitForRunCompletion(runId, 300);

      if (success) {
        console.log(`\n[Test] ✅ E2E test passed - Ingestion completed successfully`);
      } else {
        console.log(`\n[Test] ❌ E2E test failed - Ingestion did not complete`);
      }

      return success;
    }

    console.log(`\n[Test] ⚠️ Could not find run ID in response`);
    console.log(`[Test] This might mean the trigger failed or the response format changed`);

    return false;

  } catch (error) {
    console.error(`\n[Test] ❌ Test failed with error:`, error);

    // Take error screenshot
    try {
      const page = browser.pages()[0];
      if (page) {
        await page.screenshot({ path: '/tmp/ingestion_error.png', fullPage: true });
        console.log(`[Test] Error screenshot saved: /tmp/ingestion_error.png`);
      }
    } catch (e) {
      // Ignore screenshot errors
    }

    return false;

  } finally {
    console.log(`\n[Test] Closing browser...`);
    await browser.close();
  }
}

// Run the test
console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  E2E Test: Admin Portal Ingestion Trigger (San Marino)          ║
╚══════════════════════════════════════════════════════════════════╝
`);

testIngestionTrigger()
  .then(success => {
    console.log(`\n${'='.repeat(70)}`);
    if (success) {
      console.log(`✅ TEST PASSED - Ingestion completed successfully for San Marino`);
      process.exit(0);
    } else {
      console.log(`❌ TEST FAILED - Check screenshots in /tmp/ for details`);
      process.exit(1);
    }
  })
  .catch(error => {
    console.error(`\n❌ FATAL ERROR:`, error);
    process.exit(1);
  });
