import puppeteer from 'puppeteer';

async function testAdminPortal() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  // Track all responses
  page.on('response', response => {
    if (response.status() >= 400) {
      console.log(`[${response.status()}] ${response.url()}`);
    }
  });

  // Listen for console messages
  page.on('console', msg => {
    console.log(`[CONSOLE]:`, msg.text());
  });

  // Listen for page errors
  page.on('pageerror', error => {
    console.log('[PAGE ERROR]:', error.message);
  });

  try {
    console.log('\n🔍 Testing /data/jobs page...\n');
    await page.goto('http://localhost:3002/data/jobs', { waitUntil: 'networkidle2', timeout: 10000 });
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('\n🔍 Testing /data/gold-metrics page...\n');
    await page.goto('http://localhost:3002/data/gold-metrics', { waitUntil: 'networkidle2', timeout: 10000 });
    await new Promise(resolve => setTimeout(resolve, 2000));

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

testAdminPortal().catch(console.error);
