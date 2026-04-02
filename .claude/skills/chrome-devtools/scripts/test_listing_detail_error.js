import puppeteer from 'puppeteer';

async function testListingDetail() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 1024 }
  });
  const page = await browser.newPage();

  // Collect console logs and errors
  const logs = [];
  const errors = [];

  page.on('console', msg => {
    const text = msg.text();
    logs.push(text);
    console.log('CONSOLE:', text);
  });

  page.on('pageerror', error => {
    errors.push(error.message);
    console.error('PAGE ERROR:', error.message);
  });

  try {
    console.log('Navigating to listing details page...');
    await page.goto('http://localhost:3002/data/listings/cmhda5riq002wsb6w0adpmpd7', {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    // Wait for page to fully render
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Take screenshot
    await page.screenshot({
      path: '/tmp/listing_detail_page.png',
      fullPage: true
    });
    console.log('\n✅ Screenshot saved to /tmp/listing_detail_page.png');

    // Check for error messages in the page
    const pageText = await page.evaluate(() => document.body.textContent);

    if (pageText.includes('Error') || pageText.includes('error')) {
      console.log('\n⚠️ Error text found on page');

      // Try to find specific error message
      const errorElement = await page.$('[role="alert"]');
      if (errorElement) {
        const errorText = await page.evaluate(el => el.textContent, errorElement);
        console.log('Error message:', errorText);
      }
    }

    // Check if content is visible
    const hasContent = await page.evaluate(() => {
      const address = document.querySelector('h5');
      return address && address.textContent.includes('Sierra');
    });

    if (hasContent) {
      console.log('\n✅ Page content rendered successfully');
    } else {
      console.log('\n❌ Page content not visible');
    }

    // Print summary
    console.log('\n=== Summary ===');
    console.log(`Console logs: ${logs.length}`);
    console.log(`Errors: ${errors.length}`);

    if (errors.length > 0) {
      console.log('\n=== Errors ===');
      errors.forEach((err, i) => console.log(`${i + 1}. ${err}`));
    }

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

testListingDetail().catch(console.error);
