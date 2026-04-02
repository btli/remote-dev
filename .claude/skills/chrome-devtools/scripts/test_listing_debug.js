import puppeteer from 'puppeteer';

async function debugListingPage() {
  const browser = await puppeteer.launch({
    headless: false,
    devtools: true,
    defaultViewport: { width: 1280, height: 1024 }
  });

  const page = await browser.newPage();

  // Enable console logging
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    console.log(`[${type.toUpperCase()}]`, text);
  });

  // Enable error logging
  page.on('pageerror', error => {
    console.error('[PAGE ERROR]', error.message);
    console.error(error.stack);
  });

  // Enable request failure logging
  page.on('requestfailed', request => {
    console.log('[REQUEST FAILED]', request.url(), request.failure().errorText);
  });

  try {
    console.log('Navigating to listing details page...\n');
    await page.goto('http://localhost:3002/data/listings/cmhda5riq002wsb6w0adpmpd7', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait a bit for any async errors
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Take screenshot
    await page.screenshot({
      path: '/tmp/listing_debug.png',
      fullPage: true
    });
    console.log('\n✅ Screenshot saved to /tmp/listing_debug.png');

    // Keep browser open for manual inspection
    console.log('\n🔍 Browser will remain open for 30 seconds for manual inspection...');
    await new Promise(resolve => setTimeout(resolve, 30000));

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

debugListingPage().catch(console.error);
