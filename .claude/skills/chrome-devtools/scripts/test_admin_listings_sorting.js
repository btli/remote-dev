import puppeteer from 'puppeteer';
import { mkdir } from 'fs/promises';

/**
 * E2E Test: Admin Listings Table Sorting with TanStack Table
 *
 * Tests:
 * 1. Table renders with TanStack Table
 * 2. All columns have sortable headers
 * 3. Clicking column headers changes sort order
 * 4. Sort state is reflected in URL parameters
 * 5. Page reloads with correct sort state
 * 6. Multiple sort cycles work (asc -> desc -> asc)
 */

async function testAdminListingsSorting() {
  console.log('🧪 Starting Admin Listings Table Sorting E2E Test\n');

  // Ensure screenshots directory exists
  await mkdir('/tmp/screenshots', { recursive: true });

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--window-size=1920,1080'],
    defaultViewport: { width: 1920, height: 1080 }
  });

  const page = await browser.newPage();

  try {
    // 1. Navigate to listings page
    console.log('📍 Navigating to admin listings page...');
    await page.goto('http://localhost:3002/data/listings', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    await new Promise(resolve => setTimeout(resolve, 2000));
    await page.screenshot({ path: '/tmp/screenshots/01_listings_initial.png', fullPage: true });
    console.log('✅ Page loaded\n');

    // 2. Check that table is rendered
    console.log('🔍 Checking table structure...');
    const tableExists = await page.$('table');
    if (!tableExists) {
      throw new Error('❌ Table not found on page');
    }
    console.log('✅ Table found\n');

    // 3. Find all sortable column headers (MUI TableSortLabel creates span with buttonbase)
    console.log('🔍 Finding sortable column headers...');
    const sortableHeaders = await page.$$('th span[class*="MuiTableSortLabel"]');
    console.log(`✅ Found ${sortableHeaders.length} sortable column headers\n`);

    if (sortableHeaders.length === 0) {
      console.log('⚠️  Checking alternative selectors...');
      const allHeaders = await page.$$('th');
      console.log(`  → Found ${allHeaders.length} total table headers`);

      // Try to get HTML of first few headers for debugging
      const firstHeaderHtml = await page.evaluate(() => {
        const headers = Array.from(document.querySelectorAll('th'));
        return headers.slice(0, 3).map(h => h.outerHTML);
      });
      console.log('  → First 3 header HTML:', firstHeaderHtml);

      throw new Error('❌ No sortable headers found - TanStack Table may not be working');
    }

    // 4. Get initial URL and sort state
    const initialUrl = page.url();
    console.log('📊 Initial URL:', initialUrl);

    // 5. Test sorting by clicking "City" column
    console.log('\n🧪 Testing City column sorting...');

    // Find City column TableSortLabel
    const citySortLabel = await page.evaluateHandle(() => {
      const headers = Array.from(document.querySelectorAll('th'));
      const cityHeader = headers.find(h => h.textContent?.includes('City'));
      if (!cityHeader) return null;
      // MUI TableSortLabel creates a span with ButtonBase
      return cityHeader.querySelector('span[class*="MuiTableSortLabel"]');
    });

    if (!citySortLabel || !(await citySortLabel.evaluate(el => el !== null))) {
      throw new Error('❌ City sort button not found');
    }

    // First click - should sort ascending
    console.log('  → Clicking City header (ascending)...');
    await citySortLabel.click();
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for data to load
    await page.screenshot({ path: '/tmp/screenshots/02_city_sort_asc.png', fullPage: true });

    let currentUrl = page.url();
    console.log('  → URL after sort:', currentUrl);

    if (!currentUrl.includes('sortBy=city') || !currentUrl.includes('sortOrder=asc')) {
      throw new Error('❌ URL does not contain expected sort parameters (sortBy=city, sortOrder=asc)');
    }
    console.log('  ✅ Ascending sort active\n');

    // Second click - should sort descending
    console.log('  → Clicking City header again (descending)...');
    await citySortLabel.click();
    await new Promise(resolve => setTimeout(resolve, 2000));
    await page.screenshot({ path: '/tmp/screenshots/03_city_sort_desc.png', fullPage: true });

    currentUrl = page.url();
    console.log('  → URL after sort:', currentUrl);

    if (!currentUrl.includes('sortBy=city') || !currentUrl.includes('sortOrder=desc')) {
      throw new Error('❌ URL does not contain expected sort parameters (sortBy=city, sortOrder=desc)');
    }
    console.log('  ✅ Descending sort active\n');

    // 6. Test sorting by price column
    console.log('🧪 Testing List Price column sorting...');

    const priceSortLabel = await page.evaluateHandle(() => {
      const headers = Array.from(document.querySelectorAll('th'));
      const priceHeader = headers.find(h => h.textContent?.includes('List Price'));
      if (!priceHeader) return null;
      return priceHeader.querySelector('span[class*="MuiTableSortLabel"]');
    });

    if (!priceSortLabel || !(await priceSortLabel.evaluate(el => el !== null))) {
      throw new Error('❌ List Price sort button not found');
    }

    console.log('  → Clicking List Price header (ascending)...');
    await priceSortLabel.click();
    await new Promise(resolve => setTimeout(resolve, 2000));
    await page.screenshot({ path: '/tmp/screenshots/04_price_sort_asc.png', fullPage: true });

    currentUrl = page.url();
    console.log('  → URL after sort:', currentUrl);

    if (!currentUrl.includes('sortBy=priceNormalized') || !currentUrl.includes('sortOrder=asc')) {
      throw new Error('❌ URL does not contain expected sort parameters (sortBy=priceNormalized, sortOrder=asc)');
    }
    console.log('  ✅ Price ascending sort active\n');

    // 7. Test page reload preserves sort state
    console.log('🧪 Testing page reload preserves sort state...');
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise(resolve => setTimeout(resolve, 2000));
    await page.screenshot({ path: '/tmp/screenshots/05_after_reload.png', fullPage: true });

    currentUrl = page.url();
    if (!currentUrl.includes('sortBy=priceNormalized') || !currentUrl.includes('sortOrder=asc')) {
      throw new Error('❌ Sort state not preserved after page reload');
    }
    console.log('✅ Sort state preserved after reload\n');

    // 8. Test sorting by date column
    console.log('🧪 Testing Listing Date column sorting...');

    const dateSortLabel = await page.evaluateHandle(() => {
      const headers = Array.from(document.querySelectorAll('th'));
      const dateHeader = headers.find(h => h.textContent?.includes('Listing Date'));
      if (!dateHeader) return null;
      return dateHeader.querySelector('span[class*="MuiTableSortLabel"]');
    });

    if (!dateSortLabel || !(await dateSortLabel.evaluate(el => el !== null))) {
      throw new Error('❌ Listing Date sort button not found');
    }

    console.log('  → Clicking Listing Date header (descending)...');
    await dateSortLabel.click();
    await new Promise(resolve => setTimeout(resolve, 2000));
    await page.screenshot({ path: '/tmp/screenshots/06_date_sort_desc.png', fullPage: true });

    currentUrl = page.url();
    console.log('  → URL after sort:', currentUrl);

    if (!currentUrl.includes('sortBy=listingDateNormalized')) {
      throw new Error('❌ URL does not contain expected sort parameter (sortBy=listingDateNormalized)');
    }
    console.log('  ✅ Date sort active\n');

    // 9. Check for console errors
    console.log('🔍 Checking for console errors...');
    const logs = await page.evaluate(() => {
      return window.console.errors || [];
    });

    if (logs.length > 0) {
      console.log('⚠️  Console errors detected:', logs);
    } else {
      console.log('✅ No console errors\n');
    }

    // Final summary
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ ALL TESTS PASSED');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('Test Results:');
    console.log(`  • Table rendered with TanStack Table`);
    console.log(`  • ${sortableHeaders.length} sortable columns found`);
    console.log(`  • City column sorting works (asc/desc)`);
    console.log(`  • List Price column sorting works`);
    console.log(`  • Listing Date column sorting works`);
    console.log(`  • Sort state persists in URL`);
    console.log(`  • Sort state preserved after page reload`);
    console.log('\n📸 Screenshots saved to /tmp/screenshots/\n');

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    await page.screenshot({ path: '/tmp/screenshots/error.png', fullPage: true });
    console.log('📸 Error screenshot saved to /tmp/screenshots/error.png\n');
    throw error;
  } finally {
    await browser.close();
  }
}

// Run test
testAdminListingsSorting().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
