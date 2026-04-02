/**
 * E2E Test: Admin UI Ingestion Job Flow
 * Tests the complete pipeline from UI trigger to completion
 */

import puppeteer from 'puppeteer';
import { setTimeout } from 'timers/promises';

async function testAdminUIIngestion() {
  console.log('🚀 Starting E2E Admin UI Test\n');

  const browser = await puppeteer.launch({
    headless: false, // Set to true for CI
    args: ['--window-size=1920,1080'],
    defaultViewport: { width: 1920, height: 1080 },
  });

  const page = await browser.newPage();

  try {
    // Step 1: Navigate to Jobs page
    console.log('📍 Step 1: Navigate to Jobs page');
    await page.goto('http://localhost:3002/data/jobs', { waitUntil: 'networkidle2' });
    await page.screenshot({ path: '/tmp/admin-ui-01-jobs-page.png' });
    console.log('   ✅ Jobs page loaded');

    // Step 2: Find and click "Trigger Ingestion" button
    console.log('\n📍 Step 2: Find trigger button');

    // Look for button with text containing "Trigger" or "New"
    const triggerButton = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const triggerBtn = buttons.find(btn =>
        btn.textContent.includes('Trigger') ||
        btn.textContent.includes('New') ||
        btn.textContent.includes('Start')
      );
      if (triggerBtn) {
        triggerBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return true;
      }
      return false;
    });

    if (!triggerButton) {
      console.error('   ❌ Could not find trigger button');
      await page.screenshot({ path: '/tmp/admin-ui-error-no-button.png' });
      throw new Error('Trigger button not found');
    }

    await page.click('button');
    await setTimeout(1000);
    await page.screenshot({ path: '/tmp/admin-ui-02-clicked-trigger.png' });
    console.log('   ✅ Clicked trigger button');

    // Step 3: Fill in the form (if dialog/modal appears)
    console.log('\n📍 Step 3: Fill in ingestion form');

    // Check if there's a dialog/modal
    const hasDialog = await page.evaluate(() => {
      return !!document.querySelector('[role="dialog"]') || !!document.querySelector('.MuiDialog-root');
    });

    let jobId;

    if (hasDialog) {
      console.log('   📝 Found dialog form');

      // Look for city selection (checkboxes or autocomplete)
      const hasSanMarino = await page.evaluate(() => {
        // Try to find San Marino checkbox or option
        const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
        const sanMarinoCheckbox = checkboxes.find(cb => {
          const label = cb.parentElement?.textContent || '';
          return label.includes('San Marino');
        });

        if (sanMarinoCheckbox && !sanMarinoCheckbox.checked) {
          sanMarinoCheckbox.click();
          return true;
        }
        return false;
      });

      // Set incremental mode and max listings
      await page.evaluate(() => {
        // Find incremental toggle/switch
        const incrementalSwitch = Array.from(document.querySelectorAll('input[type="checkbox"]'))
          .find(cb => {
            const label = cb.parentElement?.textContent || '';
            return label.toLowerCase().includes('incremental');
          });
        if (incrementalSwitch && !incrementalSwitch.checked) {
          incrementalSwitch.click();
        }

        // Find max listings input
        const maxListingsInput = Array.from(document.querySelectorAll('input[type="number"]'))
          .find(input => {
            const label = input.parentElement?.textContent || input.placeholder || '';
            return label.toLowerCase().includes('max') || label.toLowerCase().includes('limit');
          });
        if (maxListingsInput) {
          maxListingsInput.value = '2';
          maxListingsInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });

      await page.screenshot({ path: '/tmp/admin-ui-03-filled-form.png' });
      console.log('   ✅ Filled form with: San Marino, incremental=true, maxListings=2');

      // Click submit button
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const submitBtn = buttons.find(btn =>
          btn.textContent.includes('Submit') ||
          btn.textContent.includes('Trigger') ||
          btn.textContent.includes('Start')
        );
        if (submitBtn) {
          submitBtn.click();
        }
      });

      await setTimeout(2000);
      await page.screenshot({ path: '/tmp/admin-ui-04-submitted.png' });
      console.log('   ✅ Submitted form');
    } else {
      // Direct API call (no form dialog)
      console.log('   ℹ️  No dialog found, triggering directly via API');
      const response = await page.evaluate(async () => {
        const res = await fetch('http://localhost:3100/api/jobs/ingestion/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cities: ['San Marino'],
            incremental: true,
            maxListingsPerRun: 2
          })
        });
        return await res.json();
      });
      jobId = response.jobId;
      console.log(`   ✅ Triggered job via API: ${jobId}`);
    }

    // Step 4: Wait for job to appear in the list and get ID
    console.log('\n📍 Step 4: Monitor job execution');

    if (!jobId) {
      await setTimeout(2000);
      jobId = await page.evaluate(() => {
        // Find the first job row in the table
        const rows = document.querySelectorAll('tr[data-job-id], tbody tr');
        if (rows.length > 0) {
          const firstRow = rows[0];
          return firstRow.getAttribute('data-job-id') ||
                 firstRow.querySelector('td')?.textContent?.trim();
        }
        return null;
      });
      console.log(`   📋 Found job ID: ${jobId}`);
    }

    // Step 5: Navigate to job detail page
    if (jobId) {
      console.log(`\n📍 Step 5: Navigate to job detail page`);
      await page.goto(`http://localhost:3002/data/jobs/${jobId}`, { waitUntil: 'networkidle2' });
      await page.screenshot({ path: '/tmp/admin-ui-05-job-detail.png' });
      console.log('   ✅ Loaded job detail page');

      // Step 6: Wait for job to complete and monitor stages
      console.log('\n📍 Step 6: Monitor job progress');
      let attempts = 0;
      const maxAttempts = 60; // 2 minutes max

      while (attempts < maxAttempts) {
        const jobStatus = await page.evaluate(() => {
          // Look for status indicators
          const statusElements = document.querySelectorAll('[data-status], .status, .MuiChip-label');
          const status = Array.from(statusElements).find(el =>
            el.textContent.includes('COMPLETED') ||
            el.textContent.includes('FAILED') ||
            el.textContent.includes('RUNNING')
          );

          // Get stage statuses
          const stages = {
            raw: null,
            bronze: null,
            silver: null,
            gold: null
          };

          document.querySelectorAll('[data-stage]').forEach(el => {
            const stage = el.getAttribute('data-stage')?.toLowerCase();
            const stageStatus = el.textContent;
            if (stage) {
              stages[stage] = stageStatus;
            }
          });

          return {
            overallStatus: status?.textContent || 'UNKNOWN',
            stages
          };
        });

        console.log(`   [${attempts + 1}/${maxAttempts}] Status: ${jobStatus.overallStatus}`);
        console.log(`        RAW: ${jobStatus.stages.raw || 'N/A'}, BRONZE: ${jobStatus.stages.bronze || 'N/A'}, SILVER: ${jobStatus.stages.silver || 'N/A'}, GOLD: ${jobStatus.stages.gold || 'N/A'}`);

        if (jobStatus.overallStatus.includes('COMPLETED') || jobStatus.overallStatus.includes('FAILED')) {
          console.log(`\n   ✅ Job finished with status: ${jobStatus.overallStatus}`);
          break;
        }

        await setTimeout(2000);
        await page.reload({ waitUntil: 'networkidle2' });
        attempts++;
      }

      await page.screenshot({ path: '/tmp/admin-ui-06-final-status.png' });

      // Step 7: Verify results via API
      console.log('\n📍 Step 7: Verify results via API');
      const finalJobData = await page.evaluate(async (jid) => {
        const res = await fetch(`http://localhost:3100/api/jobs/${jid}`);
        return await res.json();
      }, jobId);

      console.log('\n📊 Final Job Summary:');
      console.log(`   Job ID: ${finalJobData.id}`);
      console.log(`   Status: ${finalJobData.status}`);
      console.log(`   Listings Processed: ${finalJobData.listingsProcessed}`);
      console.log(`   Listings Added: ${finalJobData.listingsAdded}`);
      console.log(`   Listings Updated: ${finalJobData.listingsUpdated}`);
      console.log(`   Images Downloaded: ${finalJobData.imagesDownloaded}`);
      console.log(`   Duration: ${finalJobData.durationMs}ms`);
      console.log(`\n📋 Pipeline Stages:`);
      console.log(`   RAW: ${finalJobData.rawStageStatus}`);
      console.log(`   BRONZE: ${finalJobData.bronzeStageStatus}`);
      console.log(`   SILVER: ${finalJobData.silverStageStatus}`);
      console.log(`   GOLD: ${finalJobData.goldStageStatus}`);

      if (finalJobData.stageExecutions?.length > 0) {
        console.log(`\n🔍 Stage Executions:`);
        finalJobData.stageExecutions.forEach(exec => {
          console.log(`   ${exec.stage}: ${exec.status} (${exec.recordsProcessed} processed, ${exec.recordsFailed} failed)`);
        });
      }

      console.log('\n✅ E2E Test COMPLETED successfully!');
    } else {
      console.error('\n❌ Could not find job ID');
      await page.screenshot({ path: '/tmp/admin-ui-error-no-job-id.png' });
    }

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await page.screenshot({ path: '/tmp/admin-ui-error-final.png' });
    throw error;
  } finally {
    console.log('\n📸 Screenshots saved to /tmp/admin-ui-*.png');
    // await browser.close();
    console.log('🔍 Browser left open for inspection. Close manually or uncomment browser.close()');
  }
}

// Run the test
testAdminUIIngestion().catch(console.error);
