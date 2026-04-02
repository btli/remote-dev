import puppeteer from 'puppeteer';

async function attachPageListeners(page, pageNum) {
  console.log(`📑 Monitoring Page ${pageNum}: ${page.url()}\n`);

  // Set up console logging
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    if (!text.includes('Permissions policy') && !text.includes('DevTools')) {
      console.log(`[Page ${pageNum} Console ${type.toUpperCase()}]:`, text);
    }
  });

  // Set up request interception
  await page.setRequestInterception(true);

  page.on('request', request => {
    const resourceType = request.resourceType();
    const url = request.url();

    // Log AJAX/Fetch requests AND document requests to Matrix
    if (resourceType === 'xhr' || resourceType === 'fetch' ||
        (resourceType === 'document' && url.includes('matrix.crmls.org'))) {
      console.log(`\n📡 [Page ${pageNum}] ${resourceType.toUpperCase()} Request: ${request.method()} ${url}`);

      const postData = request.postData();
      if (postData) {
        console.log(`   POST Data: ${postData.substring(0, 300)}${postData.length > 300 ? '...' : ''}`);
      }

      // Log headers for Matrix requests
      if (url.includes('matrix.crmls.org')) {
        const headers = request.headers();
        console.log(`   Headers:`, {
          'content-type': headers['content-type'],
          'referer': headers['referer'],
        });
      }
    }

    request.continue();
  });

  page.on('response', async response => {
    const resourceType = response.request().resourceType();
    const url = response.url();

    // Log AJAX/Fetch responses AND document responses from Matrix
    if (resourceType === 'xhr' || resourceType === 'fetch' ||
        (resourceType === 'document' && url.includes('matrix.crmls.org'))) {
      console.log(`✅ [Page ${pageNum}] ${resourceType.toUpperCase()} Response: ${response.status()} ${url}`);

      // Try to log response body for small XHR/Fetch responses
      if ((resourceType === 'xhr' || resourceType === 'fetch') &&
          url.includes('matrix.crmls.org')) {
        try {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('json') || contentType.includes('html')) {
            const text = await response.text();
            if (text.length < 1000) {
              console.log(`   Response Body: ${text}`);
            } else {
              console.log(`   Response Body: ${text.substring(0, 300)}... [${text.length} bytes total]`);
            }
          }
        } catch (err) {
          // Ignore errors reading response body
        }
      }
    }
  });
}

async function launchPersistentChrome() {
  console.log('🚀 Launching persistent Chrome browser (monitoring ALL tabs)...\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  // Monitor existing pages
  const pages = await browser.pages();
  for (let i = 0; i < pages.length; i++) {
    await attachPageListeners(pages[i], i + 1);
  }

  // Monitor NEW pages/tabs as they're created
  browser.on('targetcreated', async target => {
    if (target.type() === 'page') {
      const newPage = await target.page();
      if (newPage) {
        const allPages = await browser.pages();
        const pageNum = allPages.indexOf(newPage) + 1;
        console.log(`\n🆕 New tab/page created!\n`);
        await attachPageListeners(newPage, pageNum);
      }
    }
  });

  console.log('✅ Browser is ready! Monitoring ALL tabs.\n');
  console.log('Instructions:');
  console.log('  1. Navigate to CRMLS in any tab (or switch to existing CRMLS tab)');
  console.log('  2. Open a listing detail page');
  console.log('  3. Click on the tabs (Tax, Photos, History, etc.)');
  console.log('  4. Watch this console for AJAX requests from ANY tab');
  console.log('  5. Press Ctrl+C when done to close\n');
  console.log('📊 All AJAX requests from ALL tabs will be logged here.\n');
  console.log('⏸️  Browser will stay open. Press Ctrl+C to close.\n');

  // Keep the browser open indefinitely
  await new Promise(() => {});
}

launchPersistentChrome().catch(console.error);
