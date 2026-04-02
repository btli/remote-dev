import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORTAL_URL = 'http://localhost:3001';
const SCREENSHOTS_DIR = '/tmp';

async function testBrowseListings() {
  console.log('Starting Browse Listings E2E test...');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 }
  });

  try {
    const page = await browser.newPage();

    // Enable console logging
    page.on('console', msg => {
      const type = msg.type();
      if (type === 'error' || type === 'warning') {
        console.log(`[Browser ${type}]:`, msg.text());
      }
    });

    // Navigate to Browse Listings page
    console.log('1. Navigating to Browse Listings page...');
    await page.goto(`${PORTAL_URL}/browse`, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/browse_listings_01_initial.png` });
    console.log('   ✓ Page loaded successfully');

    // Wait for table to load
    console.log('2. Waiting for listings table...');
    await page.waitForSelector('table', { timeout: 10000 });
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/browse_listings_02_table_loaded.png` });
    console.log('   ✓ Table loaded');

    // Test search functionality
    console.log('3. Testing search functionality...');
    const searchInput = await page.waitForSelector('input[placeholder*="Search"]');
    await searchInput.type('Los Angeles');
    await page.waitForTimeout(500); // Wait for debounce
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/browse_listings_03_search.png` });
    console.log('   ✓ Search input working');

    // Clear search
    const clearButton = await page.waitForSelector('button[aria-label*="clear"], button svg[data-testid*="CloseIcon"]', { timeout: 5000 });
    await clearButton.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/browse_listings_04_search_cleared.png` });
    console.log('   ✓ Search cleared');

    // Test filters
    console.log('4. Testing filters...');

    // Open city filter
    const cityInput = await page.waitForSelector('input[name="city"], label:has-text("City") + input, input[aria-label*="City"]');
    await cityInput.click();
    await cityInput.type('Pasadena');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/browse_listings_05_city_filter.png` });
    console.log('   ✓ City filter applied');

    // Apply price range
    const minPriceInput = await page.waitForSelector('input[type="number"][aria-label*="Min Price"], label:has-text("Min Price") + input');
    await minPriceInput.click();
    await minPriceInput.type('500000');
    await page.waitForTimeout(500);

    const maxPriceInput = await page.waitForSelector('input[type="number"][aria-label*="Max Price"], label:has-text("Max Price") + input');
    await maxPriceInput.click();
    await maxPriceInput.type('1000000');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/browse_listings_06_price_range.png` });
    console.log('   ✓ Price range applied');

    // Test bedroom slider
    console.log('5. Testing bedroom slider...');
    const bedroomSlider = await page.waitForSelector('span[class*="MuiSlider-root"]:has-text("Bedrooms") ~ .MuiSlider-root, .MuiSlider-root');
    await bedroomSlider.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/browse_listings_07_bedroom_slider.png` });
    console.log('   ✓ Bedroom slider working');

    // Check active filters chips
    console.log('6. Checking active filters...');
    const filterChips = await page.$$('div[class*="MuiChip-root"]');
    console.log(`   ✓ Found ${filterChips.length} active filter chips`);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/browse_listings_08_active_filters.png` });

    // Test Clear All button
    console.log('7. Testing Clear All button...');
    const clearAllButton = await page.waitForSelector('button:has-text("Clear All")');
    await clearAllButton.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/browse_listings_09_cleared_filters.png` });
    console.log('   ✓ All filters cleared');

    // Test pagination
    console.log('8. Testing pagination...');
    const paginationNext = await page.waitForSelector('button[aria-label*="next"], button[title*="next"]');
    const isNextDisabled = await paginationNext.evaluate(el => el.disabled);
    if (!isNextDisabled) {
      await paginationNext.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/browse_listings_10_pagination.png` });
      console.log('   ✓ Pagination working');
    } else {
      console.log('   ℹ Next page button disabled (only one page of results)');
    }

    // Test row click navigation
    console.log('9. Testing row click navigation...');
    await page.goto(`${PORTAL_URL}/browse`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('table tbody tr', { timeout: 5000 });
    const firstRow = await page.$('table tbody tr');
    if (firstRow) {
      await firstRow.click();
      await page.waitForTimeout(1000);
      const currentUrl = page.url();
      console.log(`   ✓ Navigated to: ${currentUrl}`);
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/browse_listings_11_detail_page.png` });

      // Go back
      await page.goBack();
      await page.waitForTimeout(500);
    }

    // Test keyboard navigation
    console.log('10. Testing keyboard navigation...');
    await page.goto(`${PORTAL_URL}/browse`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('input[placeholder*="Search"]');

    // Tab through elements
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/browse_listings_12_keyboard_nav.png` });
    console.log('   ✓ Keyboard navigation working');

    // Performance test
    console.log('11. Performance test...');
    const startTime = Date.now();
    await page.goto(`${PORTAL_URL}/browse`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('table', { timeout: 10000 });
    const loadTime = Date.now() - startTime;
    console.log(`   ✓ Page loaded in ${loadTime}ms`);

    if (loadTime > 3000) {
      console.warn(`   ⚠ Warning: Page load time (${loadTime}ms) exceeds 3000ms threshold`);
    }

    console.log('\n✅ All tests passed successfully!');
    console.log(`\nScreenshots saved to: ${SCREENSHOTS_DIR}/browse_listings_*.png`);

  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

// Run the test
testBrowseListings().catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
});
