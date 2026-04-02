import puppeteer from 'puppeteer';

// Helper function to wait
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function testListingDetailNestedAnchorFix() {
  console.log('🧪 Testing listing detail page nested anchor fix...\n');

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Track console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  try {
    // Navigate to listings page
    console.log('📍 Navigating to listings page...');
    await page.goto('http://localhost:3002/data/listings', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait for listings table to load
    console.log('⏳ Waiting for listings table to load...');
    await page.waitForSelector('table', { timeout: 10000 });
    await wait(2000);
    await page.screenshot({ path: '/tmp/listing_page.png' });
    console.log('✅ Listings page loaded');

    // Find and click on a listing row
    console.log('\n📍 Looking for listing row to click...');
    const listingRows = await page.$$('table tbody tr[data-testid], table tbody tr');

    if (listingRows.length === 0) {
      console.log('⚠️  No listing rows found to test. This might be expected if database is empty.');
      await browser.close();
      return;
    }

    console.log(`Found ${listingRows.length} listing rows`);

    // Click the first listing row
    await listingRows[0].click();
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
    await wait(2000);
    await page.screenshot({ path: '/tmp/listing_detail_page.png' });
    console.log('✅ Navigated to listing detail page');

    // Check for nested anchor errors
    console.log('\n🔍 Checking for nested anchor errors...');
    const nestedAnchorErrors = consoleErrors.filter(error =>
      error.includes('cannot be a descendant of') ||
      error.includes('cannot contain a nested')
    );

    if (nestedAnchorErrors.length > 0) {
      console.error('❌ NESTED ANCHOR ERRORS FOUND:');
      nestedAnchorErrors.forEach(error => console.error(`  - ${error}`));
      throw new Error('Nested anchor errors still present');
    } else {
      console.log('✅ No nested anchor errors detected');
    }

    // Test the back button
    console.log('\n📍 Testing back button...');
    const backButton = await page.waitForSelector('button:has(svg)', {
      timeout: 5000
    });

    if (!backButton) {
      throw new Error('Back button not found');
    }

    // Verify button text contains "Back to Listings"
    const buttonText = await page.evaluate(el => el.textContent, backButton);
    if (!buttonText.includes('Back to Listings')) {
      throw new Error(`Expected "Back to Listings" but found "${buttonText}"`);
    }

    console.log('✅ Back button found with correct text');

    // Click back button
    await backButton.click();
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
    await wait(1000);
    await page.screenshot({ path: '/tmp/back_to_listings.png' });
    console.log('✅ Back button works correctly');

    // Verify we're back on listings page
    const currentUrl = page.url();
    if (!currentUrl.includes('/data/listings') || currentUrl.includes('/data/listings/cm')) {
      throw new Error(`Expected to be on /data/listings, but on ${currentUrl}`);
    }
    console.log('✅ Successfully returned to listings page');

    // Final console error check
    console.log('\n📊 Final Results:');
    console.log(`   Total console errors: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) {
      console.log('   Console errors (non-nested anchor):');
      consoleErrors.forEach(error => {
        if (!error.includes('cannot be a descendant of') &&
            !error.includes('cannot contain a nested')) {
          console.log(`   - ${error.substring(0, 100)}...`);
        }
      });
    }

    console.log('\n✅ All tests passed! The nested anchor fix is working correctly.');
    console.log('\n📸 Screenshots saved to:');
    console.log('   - /tmp/listing_page.png');
    console.log('   - /tmp/listing_detail_page.png');
    console.log('   - /tmp/back_to_listings.png');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await page.screenshot({ path: '/tmp/test_error.png' });
    console.log('📸 Error screenshot saved to /tmp/test_error.png');
    throw error;
  } finally {
    await browser.close();
  }
}

testListingDetailNestedAnchorFix().catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
});
