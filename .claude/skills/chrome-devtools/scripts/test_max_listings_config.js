/**
 * E2E Test: Verify maxListingsPerRun Configuration
 *
 * This test verifies that the maxListingsPerRun configuration is properly
 * passed from the UI form to the backend API and used during ingestion.
 *
 * Test Steps:
 * 1. Navigate to the ingestion trigger page
 * 2. Fill in the form with:
 *    - City: San Marino
 *    - Mode: FULL
 *    - Max Listings Per Run: 1
 * 3. Submit the form
 * 4. Wait for ingestion to start
 * 5. Check the ingestion run details to verify maxListingsPerRun=1
 * 6. Wait for ingestion to complete
 * 7. Verify only 1 listing was processed
 */

import puppeteer from 'puppeteer';

async function testMaxListingsConfig() {
  console.log('🧪 Starting E2E test: maxListingsPerRun Configuration\n');

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 100 // Slow down actions for visibility
  });

  const page = await browser.newPage();

  try {
    // Step 1: Navigate to ingestion trigger page
    console.log('📍 Step 1: Navigating to ingestion page...');
    await page.goto('http://localhost:3002/ingestion', {
      waitUntil: 'networkidle0'
    });
    await page.screenshot({ path: '/tmp/test-max-listings-01-page-loaded.png' });
    console.log('   ✅ Page loaded\n');

    // Step 2: Fill in the form
    console.log('✏️  Step 2: Filling in the form...');

    // Select city: San Marino
    console.log('   → Selecting city: San Marino');
    await page.click('label:has-text("Target Cities")');
    await page.waitForSelector('[role="listbox"]', { visible: true });

    // Click on the dropdown to open it
    const cityDropdown = await page.$('[aria-labelledby="cities-label"]');
    await cityDropdown?.click();
    await page.waitForSelector('[role="listbox"]', { visible: true });

    // Find and click "San Marino" option
    const options = await page.$$('[role="option"]');
    for (const option of options) {
      const text = await option.evaluate(el => el.textContent);
      if (text?.includes('San Marino')) {
        await option.click();
        console.log('   ✅ Selected San Marino');
        break;
      }
    }

    // Close dropdown by clicking outside
    await page.click('h6'); // Click on card header to close dropdown

    // Select mode: FULL
    console.log('   → Selecting mode: FULL');
    const modeDropdown = await page.$('[aria-labelledby="mode-label"]');
    await modeDropdown?.click();
    await page.waitForSelector('[role="listbox"]', { visible: true });
    const fullOption = await page.evaluateHandle(() => {
      const options = Array.from(document.querySelectorAll('[role="option"]'));
      return options.find(opt => opt.textContent?.includes('Full Historical Backload'));
    });
    await fullOption.asElement()?.click();
    console.log('   ✅ Selected FULL mode');

    // Fill in Max Listings Per Run: 1
    console.log('   → Setting Max Listings Per Run: 1');
    const maxListingsInput = await page.$('input[type="number"][aria-label*="Max"]');
    if (!maxListingsInput) {
      // Try alternative selector
      const inputs = await page.$$('input[type="number"]');
      for (const input of inputs) {
        const label = await input.evaluate(el => {
          const parent = el.closest('.MuiFormControl-root');
          return parent?.querySelector('label')?.textContent || '';
        });
        if (label.includes('Max Listings')) {
          await input.click({ clickCount: 3 }); // Select all
          await input.type('1');
          console.log('   ✅ Set Max Listings Per Run to 1');
          break;
        }
      }
    } else {
      await maxListingsInput.click({ clickCount: 3 });
      await maxListingsInput.type('1');
      console.log('   ✅ Set Max Listings Per Run to 1');
    }

    await page.screenshot({ path: '/tmp/test-max-listings-02-form-filled.png' });
    console.log('   ✅ Form filled\n');

    // Step 3: Submit the form
    console.log('🚀 Step 3: Submitting the form...');
    const submitButton = await page.$('button[type="submit"]');
    await submitButton?.click();
    console.log('   ✅ Form submitted\n');

    // Step 4: Wait for success message or redirect
    console.log('⏳ Step 4: Waiting for ingestion to start...');
    await page.waitForNavigation({ timeout: 10000 }).catch(() => {
      console.log('   ℹ️  No navigation detected (form may show success message)');
    });

    // Check for success message
    const successMessage = await page.evaluate(() => {
      const alerts = Array.from(document.querySelectorAll('[role="alert"]'));
      return alerts.find(el => el.textContent?.includes('success') || el.textContent?.includes('started'))?.textContent;
    });

    if (successMessage) {
      console.log('   ✅ Success message:', successMessage);
    }

    await page.screenshot({ path: '/tmp/test-max-listings-03-submitted.png' });

    // Step 5: Navigate to recent runs and find the latest run
    console.log('\n📋 Step 5: Checking ingestion run details...');
    await page.goto('http://localhost:3002/data/jobs', {
      waitUntil: 'networkidle0'
    });

    // Find the latest run (first row in the table)
    await page.waitForSelector('table tbody tr', { timeout: 5000 });
    const latestRun = await page.$('table tbody tr:first-child a');
    const runLink = await latestRun?.evaluate(el => el.href);

    if (runLink) {
      console.log('   → Found latest run:', runLink);
      await page.goto(runLink, { waitUntil: 'networkidle0' });
      await page.screenshot({ path: '/tmp/test-max-listings-04-run-details.png' });

      // Extract run details
      const runDetails = await page.evaluate(() => {
        const text = document.body.innerText;
        const maxListingsMatch = text.match(/maxListingsPerRun[:\s]+(\d+)/i);
        const targetCitiesMatch = text.match(/Target Cities[:\s]+(.+)/);
        return {
          maxListingsPerRun: maxListingsMatch ? maxListingsMatch[1] : null,
          targetCities: targetCitiesMatch ? targetCitiesMatch[1].trim() : null,
          fullText: text
        };
      });

      console.log('   Run Details:');
      console.log('     - Max Listings Per Run:', runDetails.maxListingsPerRun || 'NOT FOUND');
      console.log('     - Target Cities:', runDetails.targetCities || 'NOT FOUND');

      if (runDetails.maxListingsPerRun === '1') {
        console.log('   ✅ maxListingsPerRun correctly set to 1\n');
      } else {
        console.log('   ❌ maxListingsPerRun NOT set correctly!\n');
        console.log('   Full page text:\n', runDetails.fullText.substring(0, 500));
      }

      // Wait for completion (max 2 minutes)
      console.log('⏳ Step 6: Waiting for ingestion to complete (max 2 minutes)...');
      let completed = false;
      let attempts = 0;
      const maxAttempts = 24; // 24 * 5 seconds = 2 minutes

      while (!completed && attempts < maxAttempts) {
        await page.waitForTimeout(5000);
        await page.reload({ waitUntil: 'networkidle0' });

        const status = await page.evaluate(() => {
          const statusEl = Array.from(document.querySelectorAll('*')).find(el =>
            el.textContent?.match(/status[:\s]+(completed|failed|running)/i)
          );
          return statusEl?.textContent?.match(/(COMPLETED|FAILED|RUNNING)/i)?.[0] || 'UNKNOWN';
        });

        console.log(`   [Attempt ${attempts + 1}/${maxAttempts}] Status: ${status}`);

        if (status === 'COMPLETED' || status === 'FAILED') {
          completed = true;
          console.log(`   ✅ Ingestion ${status.toLowerCase()}\n`);

          // Step 7: Verify listing count
          console.log('🔍 Step 7: Verifying listing count...');
          const listingsProcessed = await page.evaluate(() => {
            const text = document.body.innerText;
            const match = text.match(/Listings Processed[:\s]+(\d+)/i);
            return match ? match[1] : null;
          });

          console.log('   Listings Processed:', listingsProcessed || 'NOT FOUND');

          if (listingsProcessed === '1') {
            console.log('   ✅ TEST PASSED: Only 1 listing was processed!\n');
          } else {
            console.log(`   ❌ TEST FAILED: Expected 1 listing, but got ${listingsProcessed || 'unknown'}\n`);
          }

          await page.screenshot({ path: '/tmp/test-max-listings-05-completed.png' });
        }

        attempts++;
      }

      if (!completed) {
        console.log('   ⚠️  Timeout: Ingestion did not complete within 2 minutes\n');
      }
    } else {
      console.log('   ❌ Could not find latest run\n');
    }

    console.log('✅ Test completed! Check screenshots in /tmp/\n');

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    await page.screenshot({ path: '/tmp/test-max-listings-error.png' });
  } finally {
    await browser.close();
  }
}

// Run the test
testMaxListingsConfig().catch(console.error);
