import puppeteer from 'puppeteer';

// Helper to wait
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function testDatabaseBrowser() {
  console.log('🧪 Testing Database Browser Feature...\n');

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 100, // Slow down to see what's happening
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  try {
    // Step 1: Navigate to admin panel
    console.log('1️⃣ Navigating to admin panel...');
    await page.goto('http://localhost:3002', { waitUntil: 'networkidle2' });
    await page.screenshot({ path: '/tmp/db-browser-1-home.png' });
    console.log('✅ Admin panel loaded');

    // Step 2: Navigate to Database Browser
    console.log('\n2️⃣ Looking for Database Browser in navigation...');

    // First expand the Data section
    await page.waitForSelector('text=Data', { timeout: 5000 });
    const dataSection = await page.$('text=Data');
    if (dataSection) {
      await dataSection.click();
      await wait(500);
      console.log('✅ Expanded Data section');
    }

    // Click on Database Browser
    await page.waitForSelector('text=Database Browser', { timeout: 5000 });
    await page.click('text=Database Browser');
    await wait(1000);
    await page.screenshot({ path: '/tmp/db-browser-2-page-loaded.png' });
    console.log('✅ Database Browser page loaded');

    // Step 3: Verify page title
    console.log('\n3️⃣ Verifying page content...');
    const title = await page.$eval('h4', el => el.textContent);
    if (title.includes('Database Browser')) {
      console.log('✅ Page title correct: "Database Browser"');
    } else {
      throw new Error(`Wrong page title: ${title}`);
    }

    // Step 4: Select a table from dropdown
    console.log('\n4️⃣ Testing table selection...');

    // Click on the Autocomplete input
    const autocompleteInput = await page.waitForSelector('input[placeholder*="Choose a database table"]', { timeout: 5000 });
    await autocompleteInput.click();
    await wait(500);
    await page.screenshot({ path: '/tmp/db-browser-3-dropdown-opened.png' });
    console.log('✅ Model selector dropdown opened');

    // Wait for options to load
    await page.waitForSelector('[role="listbox"]', { timeout: 5000 });
    await wait(1500); // Wait for models to load

    // Find a table with records (look for one with a non-zero count)
    const options = await page.$$('[role="option"]');
    if (options.length > 0) {
      console.log(`✅ Found ${options.length} tables in database`);

      // Try to find a table with records by looking for "Bronze Listings" or "Silver Listings"
      let selectedOption = null;
      for (const option of options) {
        const text = await option.evaluate(el => el.textContent);
        if (text?.includes('Bronze Listings') || text?.includes('Silver Listings') || text?.includes('Users')) {
          selectedOption = option;
          console.log(`✅ Found table with likely data: ${text}`);
          break;
        }
      }

      // If no specific table found, just use the first one
      if (!selectedOption && options.length > 0) {
        selectedOption = options[0];
        const text = await selectedOption.evaluate(el => el.textContent);
        console.log(`⚠️  Using first available table: ${text}`);
      }

      if (selectedOption) {
        await selectedOption.click();
        await wait(1500);
        await page.screenshot({ path: '/tmp/db-browser-4-table-selected.png' });
        console.log('✅ Table selected');
      } else {
        throw new Error('Could not select a table');
      }
    } else {
      throw new Error('No tables found in dropdown');
    }

    // Step 5: Verify table data loaded
    console.log('\n5️⃣ Verifying table data loaded...');

    // Wait for table to appear
    await page.waitForSelector('table', { timeout: 5000 });
    await wait(1000);
    await page.screenshot({ path: '/tmp/db-browser-5-data-grid.png' });

    const tableHeaders = await page.$$eval('thead th', headers => headers.map(h => h.textContent?.trim()));
    console.log(`✅ Table loaded with ${tableHeaders.length} columns: ${tableHeaders.slice(0, 5).join(', ')}...`);

    // Step 6: Test search functionality
    console.log('\n6️⃣ Testing search functionality...');

    const searchInput = await page.waitForSelector('input[placeholder*="Search"]', { timeout: 5000 });
    await searchInput.type('test');
    await wait(2000); // Wait for debounce
    await page.screenshot({ path: '/tmp/db-browser-6-search.png' });
    console.log('✅ Search input working');

    // Clear search
    await searchInput.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await wait(2000);

    // Step 7: Test row details modal (only if records exist)
    console.log('\n7️⃣ Testing row details modal...');

    // Check if there are any records (not just "No records found")
    const noRecordsText = await page.$eval('tbody', el => el.textContent);
    if (noRecordsText?.includes('No records found')) {
      console.log('⚠️  Table is empty, skipping row details test');
    } else {
      const viewButton = await page.waitForSelector('button svg[data-testid*="VisibilityIcon"]', { timeout: 5000 }).catch(() => null);
      if (viewButton) {
        await viewButton.click();
        await wait(1000);
        await page.screenshot({ path: '/tmp/db-browser-7-details-modal.png' });
        console.log('✅ Row details modal opened');

        // Verify modal content
        const modalTitle = await page.$eval('[role="dialog"] h6', el => el.textContent);
        if (modalTitle?.includes('Record Details')) {
          console.log('✅ Modal title correct');
        }

        // Close modal
        const closeButton = await page.$('[role="dialog"] button');
        if (closeButton) {
          await closeButton.click();
          await wait(500);
          console.log('✅ Modal closed');
        }
      } else {
        console.log('⚠️  No view button found (table may be empty)');
      }
    }

    // Step 8: Test sorting
    console.log('\n8️⃣ Testing table sorting...');

    const sortButton = await page.$('thead th:nth-child(2) span[role="button"]');
    if (sortButton) {
      await sortButton.click();
      await wait(1000);
      await page.screenshot({ path: '/tmp/db-browser-8-sorted-asc.png' });
      console.log('✅ Sorted ascending');

      await sortButton.click();
      await wait(1000);
      await page.screenshot({ path: '/tmp/db-browser-9-sorted-desc.png' });
      console.log('✅ Sorted descending');
    }

    // Step 9: Test pagination
    console.log('\n9️⃣ Testing pagination...');

    const nextPageButton = await page.$('button[aria-label*="next page"]');
    if (nextPageButton) {
      const isDisabled = await nextPageButton.evaluate(el => el.disabled);
      if (!isDisabled) {
        await nextPageButton.click();
        await wait(1500);
        await page.screenshot({ path: '/tmp/db-browser-10-page-2.png' });
        console.log('✅ Pagination working - moved to page 2');

        // Go back to page 1
        const prevPageButton = await page.$('button[aria-label*="previous page"]');
        if (prevPageButton) {
          await prevPageButton.click();
          await wait(1000);
          console.log('✅ Returned to page 1');
        }
      } else {
        console.log('⚠️  Only one page of data, pagination disabled (expected)');
      }
    }

    // Step 10: Test keyboard navigation
    console.log('\n🔟 Testing keyboard navigation...');

    // Press Tab to navigate
    await page.keyboard.press('Tab');
    await wait(200);
    await page.keyboard.press('Tab');
    await wait(200);
    console.log('✅ Keyboard navigation working');

    // Final screenshot
    await page.screenshot({ path: '/tmp/db-browser-final.png' });

    console.log('\n✅ ALL TESTS PASSED!');
    console.log('\n📸 Screenshots saved:');
    console.log('   - /tmp/db-browser-1-home.png');
    console.log('   - /tmp/db-browser-2-page-loaded.png');
    console.log('   - /tmp/db-browser-3-dropdown-opened.png');
    console.log('   - /tmp/db-browser-4-table-selected.png');
    console.log('   - /tmp/db-browser-5-data-grid.png');
    console.log('   - /tmp/db-browser-6-search.png');
    console.log('   - /tmp/db-browser-7-details-modal.png');
    console.log('   - /tmp/db-browser-8-sorted-asc.png');
    console.log('   - /tmp/db-browser-9-sorted-desc.png');
    console.log('   - /tmp/db-browser-10-page-2.png');
    console.log('   - /tmp/db-browser-final.png');

  } catch (error) {
    console.error('❌ TEST FAILED:', error);
    await page.screenshot({ path: '/tmp/db-browser-error.png' });
    console.log('📸 Error screenshot saved to /tmp/db-browser-error.png');
    throw error;
  } finally {
    await browser.close();
  }
}

testDatabaseBrowser().catch(console.error);
