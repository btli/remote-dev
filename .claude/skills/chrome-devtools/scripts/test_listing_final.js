import puppeteer from 'puppeteer';

async function testListingDetailFixed() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 1024 }
  });

  const page = await browser.newPage();

  const errors = [];

  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('error') || text.includes('Error')) {
      errors.push(text);
    }
  });

  page.on('pageerror', error => {
    errors.push(error.message);
  });

  try {
    console.log('✨ Testing listing details page...\n');

    await page.goto('http://localhost:3002/data/listings/cmhda5riq002wsb6w0adpmpd7', {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    // Wait for content to render
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check for key elements
    const checks = {
      hasAddress: await page.evaluate(() => {
        const h5 = document.querySelector('h5');
        return h5 && h5.textContent.includes('Sierra');
      }),
      hasPrice: await page.evaluate(() => {
        const price = document.querySelector('h6');
        return price && price.textContent.includes('$1,650,000');
      }),
      hasBackButton: await page.evaluate(() => {
        const button = document.querySelector('button');
        return button && button.textContent.includes('Back to Listings');
      }),
      hasMetadata: await page.evaluate(() => {
        return document.body.textContent.includes('MLS Number');
      }),
      hasAdditionalFields: await page.evaluate(() => {
        return document.body.textContent.includes('Additional Fields');
      })
    };

    // Take screenshot
    await page.screenshot({
      path: '/tmp/listing_fixed.png',
      fullPage: true
    });

    // Print results
    console.log('📊 Test Results:');
    console.log('================');
    Object.entries(checks).forEach(([key, value]) => {
      const icon = value ? '✅' : '❌';
      console.log(`${icon} ${key}: ${value}`);
    });

    console.log('\n📷 Screenshot: /tmp/listing_fixed.png');

    if (errors.length > 0) {
      console.log('\n⚠️  Errors detected:');
      errors.forEach(err => console.log(`  - ${err}`));
    } else {
      console.log('\n✅ No errors detected!');
    }

    const allPassed = Object.values(checks).every(v => v);
    console.log(`\n${allPassed ? '🎉' : '❌'} Overall: ${allPassed ? 'PASSED' : 'FAILED'}\n`);

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

testListingDetailFixed().catch(console.error);
