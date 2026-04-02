import puppeteer from 'puppeteer';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function testConsoleLogging() {
  console.log('🚀 Starting console logging test...\n');

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 50
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  // Capture console messages
  const consoleLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push(text);
    console.log(`[BROWSER] ${text}`);
  });

  // Capture page errors
  page.on('pageerror', error => {
    console.error('[PAGE ERROR]', error.message);
  });

  try {
    console.log('═══ Navigating to page 2 ═══\n');

    await page.goto('http://localhost:3002/data/listings?page=2', {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    console.log('\n⏳ Waiting 5 seconds to capture logs...\n');
    await delay(5000);

    console.log('\n═══ CONSOLE LOG SUMMARY ═══\n');
    const renderLogs = consoleLogs.filter(log => log.includes('RENDER #'));
    const queryStringLogs = consoleLogs.filter(log => log.includes('queryString updated'));
    const navigationLogs = consoleLogs.filter(log => log.includes('navigating to'));

    console.log(`Total console messages: ${consoleLogs.length}`);
    console.log(`Render count: ${renderLogs.length}`);
    console.log(`Query string updates: ${queryStringLogs.length}`);
    console.log(`Navigation calls: ${navigationLogs.length}`);

    if (navigationLogs.length > 0) {
      console.log('\n📍 Navigation calls:');
      navigationLogs.forEach((log, idx) => {
        console.log(`  ${idx + 1}. ${log}`);
      });
    }

    await page.screenshot({ path: '/tmp/console_test.png', fullPage: true });

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: '/tmp/console_test_error.png', fullPage: true });
  } finally {
    console.log('\n🔍 Keeping browser open for inspection...');
    await delay(30000);
    await browser.close();
  }
}

testConsoleLogging().catch(console.error);
