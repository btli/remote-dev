import puppeteer from 'puppeteer';

async function testGoldMetrics() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  // Capture all console messages with full details
  page.on('console', async msg => {
    const type = msg.type();
    const text = msg.text();

    // Try to get argument values for complex objects
    const args = await Promise.all(
      msg.args().map(arg => arg.jsonValue().catch(() => arg.toString()))
    );

    if (type === 'error' || text.includes('Error') || text.includes('boundary') || text.includes('Failed')) {
      console.log(`\n[${type.toUpperCase()}]:`);
      console.log('Text:', text);
      if (args.length > 0 && args[0] !== text) {
        console.log('Args:', JSON.stringify(args, null, 2));
      }
    }
  });

  // Capture page errors
  page.on('pageerror', error => {
    console.log('\n[PAGE ERROR]:', error.message);
    console.log('Stack:', error.stack);
  });

  try {
    console.log('\n🔍 Testing /data/gold-metrics page...\n');
    await page.goto('http://localhost:3002/data/gold-metrics', { waitUntil: 'networkidle2', timeout: 10000 });
    await new Promise(resolve => setTimeout(resolve, 2000));

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

testGoldMetrics().catch(console.error);
