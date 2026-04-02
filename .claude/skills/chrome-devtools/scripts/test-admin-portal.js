/**
 * E2E Test: Admin Portal Functionality
 *
 * Tests:
 * 1. Admin portal loads
 * 2. Job list page works
 * 3. Trigger new job
 * 4. Job detail page loads with SSE
 * 5. Verify stages display correctly
 * 6. Check for resume button on failed stages
 */

import puppeteer from 'puppeteer';

async function testAdminPortal() {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Enable console logging
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('BROWSER ERROR:', msg.text());
    }
  });

  // Monitor network errors
  page.on('requestfailed', request => {
    console.log('REQUEST FAILED:', request.url(), request.failure().errorText);
  });

  try {
    console.log('\n=== Test 1: Admin Portal Loads ===');
    await page.goto('http://localhost:3002', {
      waitUntil: 'networkidle0',
      timeout: 30000
    });
    await page.screenshot({ path: '/tmp/admin-home.png' });
    console.log('✅ Admin portal loaded');

    console.log('\n=== Test 2: Navigate to Jobs Page ===');
    await page.goto('http://localhost:3002/ingestion/jobs', {
      waitUntil: 'networkidle0',
      timeout: 30000
    });
    await page.screenshot({ path: '/tmp/jobs-list.png' });
    console.log('✅ Jobs list page loaded');

    console.log('\n=== Test 3: Trigger New Job ===');
    const jobResponse = await page.evaluate(async () => {
      const response = await fetch('http://localhost:3100/api/jobs/ingestion/trigger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cities: ['San Marino'],
          incremental: false,
          maxListingsPerRun: 2
        })
      });
      return await response.json();
    });

    console.log('Job triggered:', jobResponse.jobId);
    console.log('Status:', jobResponse.status);

    console.log('\n=== Test 4: Navigate to Job Detail Page ===');
    await page.goto(`http://localhost:3002/ingestion/jobs/${jobResponse.jobId}`, {
      waitUntil: 'networkidle0',
      timeout: 30000
    });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/job-detail.png', fullPage: true });
    console.log('✅ Job detail page loaded');

    console.log('\n=== Test 5: Verify Stages Display ===');
    const stagesInfo = await page.evaluate(() => {
      const stages = document.querySelectorAll('[data-testid="stage-execution"]');
      const stageSections = document.querySelectorAll('.MuiStep-root');

      return {
        stageCount: stageSections.length,
        pageHTML: document.body.innerHTML.substring(0, 500),
        title: document.title,
        hasTabsElement: !!document.querySelector('[role="tablist"]'),
        hasStepperElement: !!document.querySelector('.MuiStepper-root'),
      };
    });

    console.log('Stages found:', stagesInfo.stageCount);
    console.log('Has Tabs:', stagesInfo.hasTabsElement);
    console.log('Has Stepper:', stagesInfo.hasStepperElement);
    console.log('Page title:', stagesInfo.title);

    if (stagesInfo.stageCount === 0) {
      console.log('⚠️  No stages visible yet - job may still be initializing');
    } else {
      console.log('✅ Stages are displaying');
    }

    console.log('\n=== Test 6: Wait for Job Progress (30 seconds) ===');
    await page.waitForTimeout(30000);
    await page.screenshot({ path: '/tmp/job-detail-progress.png', fullPage: true });

    // Check for resume buttons
    const resumeButtons = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const resumeButtons = buttons.filter(btn =>
        btn.textContent.includes('Resume from')
      );
      return {
        count: resumeButtons.length,
        labels: resumeButtons.map(btn => btn.textContent)
      };
    });

    console.log('Resume buttons found:', resumeButtons.count);
    if (resumeButtons.count > 0) {
      console.log('Resume button labels:', resumeButtons.labels);
      console.log('✅ Resume buttons are present');
    } else {
      console.log('ℹ️  No resume buttons (normal for successful jobs)');
    }

    console.log('\n=== Test 7: Check SSE Connection ===');
    const sseConnections = await page.evaluate(() => {
      // Check if EventSource is being used
      return {
        eventSourceSupported: typeof EventSource !== 'undefined',
        performanceEntries: performance.getEntriesByType('resource')
          .filter(entry => entry.name.includes('/events'))
          .map(entry => ({
            url: entry.name,
            duration: entry.duration
          }))
      };
    });

    console.log('EventSource supported:', sseConnections.eventSourceSupported);
    console.log('SSE connections:', sseConnections.performanceEntries.length);
    if (sseConnections.performanceEntries.length > 0) {
      console.log('✅ SSE connection established');
    } else {
      console.log('⚠️  No SSE connections found');
    }

    console.log('\n=== All Tests Complete ===');
    console.log('Screenshots saved to /tmp/');
    console.log('- admin-home.png');
    console.log('- jobs-list.png');
    console.log('- job-detail.png');
    console.log('- job-detail-progress.png');

    console.log('\nBrowser will stay open for 10 more seconds...');
    await page.waitForTimeout(10000);

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await page.screenshot({ path: '/tmp/test-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

testAdminPortal().catch(console.error);
