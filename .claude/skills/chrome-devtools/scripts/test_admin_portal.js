import puppeteer from 'puppeteer';

async function testAdminPortal() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  // Listen for console messages
  page.on('console', msg => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      console.log(`[BROWSER ${type.toUpperCase()}]:`, msg.text());
    }
  });

  // Listen for page errors
  page.on('pageerror', error => {
    console.log('[PAGE ERROR]:', error.message);
  });

  // Listen for failed requests
  page.on('requestfailed', request => {
    console.log('[REQUEST FAILED]:', request.url(), request.failure().errorText);
  });

  try {
    console.log('🔍 Testing admin portal at http://localhost:3002');

    // Test dashboard
    await page.goto('http://localhost:3002/dashboard', { waitUntil: 'networkidle2', timeout: 10000 });
    console.log('✅ Dashboard loaded');
    await page.screenshot({ path: '/tmp/dashboard.png' });

    // Test jobs page
    await page.goto('http://localhost:3002/data/jobs', { waitUntil: 'networkidle2', timeout: 10000 });
    console.log('✅ Jobs page loaded');
    await page.screenshot({ path: '/tmp/jobs.png' });

    // Test gold metrics page
    await page.goto('http://localhost:3002/data/gold-metrics', { waitUntil: 'networkidle2', timeout: 10000 });
    console.log('✅ Gold metrics page loaded');
    await page.screenshot({ path: '/tmp/gold-metrics.png' });

    console.log('\n📸 Screenshots saved to /tmp/');
    console.log('\n✅ All pages loaded successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

testAdminPortal().catch(console.error);
