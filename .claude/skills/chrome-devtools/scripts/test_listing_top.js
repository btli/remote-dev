import puppeteer from 'puppeteer';

async function captureTop() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 1024 }
  });

  const page = await browser.newPage();

  try {
    await page.goto('http://localhost:3002/data/listings/cmhda5riq002wsb6w0adpmpd7', {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Take screenshot of top portion
    await page.screenshot({
      path: '/tmp/listing_top.png',
      clip: { x: 0, y: 0, width: 1400, height: 1024 }
    });

    console.log('✅ Screenshot saved to /tmp/listing_top.png');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

captureTop().catch(console.error);
