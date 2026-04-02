import puppeteer from 'puppeteer';

async function debugSSE() {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Enable console logging
  page.on('console', msg => {
    console.log('BROWSER LOG:', msg.type(), msg.text());
  });

  // Monitor network requests
  page.on('request', request => {
    const url = request.url();
    if (url.includes('/api/jobs') || url.includes('/events')) {
      console.log('REQUEST:', request.method(), url);
    }
  });

  page.on('response', async response => {
    const url = response.url();
    if (url.includes('/api/jobs') || url.includes('/events')) {
      console.log('RESPONSE:', response.status(), url);
      if (response.status() >= 400) {
        try {
          const text = await response.text();
          console.log('ERROR BODY:', text);
        } catch (e) {
          console.log('Could not read error body');
        }
      }
    }
  });

  // Monitor errors
  page.on('pageerror', error => {
    console.log('PAGE ERROR:', error.message);
  });

  page.on('requestfailed', request => {
    console.log('REQUEST FAILED:', request.url(), request.failure().errorText);
  });

  try {
    console.log('Navigating to job detail page...');
    await page.goto('http://localhost:3002/ingestion/jobs/cmhf4xrzg09t0sbi6nzz92cvn', {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    console.log('Page loaded. Taking screenshot...');
    await page.screenshot({ path: '/tmp/job-detail.png', fullPage: true });

    // Wait for SSE connection to be established or fail
    console.log('Waiting 10 seconds to observe SSE connection...');
    await page.waitForTimeout(10000);

    // Check for stage executions in the DOM
    const stageExecutions = await page.evaluate(() => {
      const stageElements = document.querySelectorAll('[data-testid="stage-execution"]');
      return {
        count: stageElements.length,
        html: document.body.innerHTML.substring(0, 1000)
      };
    });

    console.log('Stage executions found:', stageExecutions.count);
    console.log('Page HTML preview:', stageExecutions.html);

    console.log('\nTest complete. Browser will stay open for 30 more seconds...');
    await page.waitForTimeout(30000);

  } catch (error) {
    console.error('Test failed:', error.message);
    await page.screenshot({ path: '/tmp/job-detail-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

debugSSE().catch(console.error);
