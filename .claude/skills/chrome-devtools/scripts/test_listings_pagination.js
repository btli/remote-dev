import puppeteer from 'puppeteer';

// Helper function for delays
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function testListingsPagination() {
  console.log('🚀 Starting listings pagination test...');

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 100 // Slow down actions to make them visible
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  try {
    // 1. Navigate to listings page
    console.log('📄 Navigating to listings page...');
    await page.goto('http://localhost:3002/data/listings', { waitUntil: 'networkidle2' });
    await delay(2000);
    await page.screenshot({ path: '/tmp/listings_initial.png', fullPage: true });
    console.log('✅ Initial page loaded');

    // Get initial URL
    const initialUrl = page.url();
    console.log(`📍 Initial URL: ${initialUrl}`);

    // 2. Wait for table to load
    console.log('⏳ Waiting for listings table...');
    await page.waitForSelector('table', { timeout: 10000 });
    console.log('✅ Table loaded');

    // 3. Find and check current pagination state
    const paginationInfo = await page.evaluate(() => {
      const pagination = document.querySelector('[class*="MuiTablePagination"]');
      if (!pagination) return null;

      const text = pagination.textContent || '';
      return {
        text,
        buttons: document.querySelectorAll('[class*="MuiTablePagination"] button').length
      };
    });
    console.log('📊 Pagination info:', paginationInfo);

    // 4. Click "Next Page" button
    console.log('🖱️ Clicking next page button...');

    // Find and click the next page button
    const nextButtonClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('[class*="MuiTablePagination"] button'));
      const nextButton = buttons.find(btn => btn.getAttribute('aria-label')?.includes('next'));

      if (nextButton && !nextButton.disabled) {
        nextButton.click();
        return true;
      }
      return false;
    });

    if (!nextButtonClicked) {
      console.log('❌ Could not find or click next button');
      await page.screenshot({ path: '/tmp/listings_no_next_button.png', fullPage: true });
      return;
    }

    console.log('✅ Next button clicked');
    await delay(1000);
    await page.screenshot({ path: '/tmp/listings_after_next_click.png', fullPage: true });

    // 5. Check URL immediately after click
    const urlAfterClick = page.url();
    console.log(`📍 URL after click: ${urlAfterClick}`);

    // 6. Wait 5 seconds and monitor for any URL changes
    console.log('⏳ Monitoring URL for 5 seconds...');
    const urlChanges = [];

    for (let i = 0; i < 5; i++) {
      await delay(1000);
      const currentUrl = page.url();
      if (currentUrl !== urlAfterClick && !urlChanges.includes(currentUrl)) {
        urlChanges.push(currentUrl);
        console.log(`⚠️ URL changed at ${i + 1}s: ${currentUrl}`);
        await page.screenshot({ path: `/tmp/listings_url_change_${i + 1}s.png`, fullPage: true });
      }
    }

    // 7. Final state
    const finalUrl = page.url();
    console.log(`📍 Final URL: ${finalUrl}`);
    await page.screenshot({ path: '/tmp/listings_final.png', fullPage: true });

    // 8. Check for any console errors
    console.log('\n📋 Summary:');
    console.log(`  Initial URL: ${initialUrl}`);
    console.log(`  After Click: ${urlAfterClick}`);
    console.log(`  Final URL: ${finalUrl}`);
    console.log(`  URL Changes: ${urlChanges.length > 0 ? urlChanges.join(' → ') : 'None'}`);

    if (urlChanges.length > 0) {
      console.log('❌ BUG CONFIRMED: URL changed automatically after pagination click');
    } else if (finalUrl !== urlAfterClick) {
      console.log('⚠️ URL is different but no intermediate changes detected');
    } else {
      console.log('✅ No automatic redirect detected');
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: '/tmp/listings_error.png', fullPage: true });
  } finally {
    console.log('\n📸 Screenshots saved to /tmp/');
    console.log('🔍 Keeping browser open for inspection. Press Ctrl+C to close.');
    // Keep browser open for manual inspection
    await delay(60000);
    await browser.close();
  }
}

testListingsPagination().catch(console.error);
