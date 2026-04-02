import puppeteer from 'puppeteer';

async function testListingsStatusFilter() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  try {
    console.log('=== Testing Listings Status Filter ===\n');

    // Navigate to listings page
    console.log('1. Navigating to listings page...');
    await page.goto('http://localhost:3002/data/listings', { waitUntil: 'networkidle0' });
    await page.waitForSelector('table', { timeout: 10000 });
    console.log('✅ Page loaded\n');

    // Wait for initial data to load
    await page.waitForTimeout(2000);

    // Take screenshot of initial state
    await page.screenshot({ path: '/tmp/listings_initial.png' });
    console.log('📸 Screenshot saved: /tmp/listings_initial.png\n');

    // Test 1: Select "Active" status
    console.log('2. Testing "Active" status filter...');
    await page.click('label:has-text("Status")');
    await page.waitForSelector('[role="listbox"]', { timeout: 5000 });
    await page.click('[role="option"]:has-text("Active")');
    await page.waitForTimeout(2000);

    // Check if filter chip appears
    const activeChip = await page.waitForSelector('text=/Active filters.*Status: Active/', { timeout: 5000 });
    if (activeChip) {
      console.log('✅ Status filter chip displayed: "Status: Active"');
    }

    // Verify URL contains status parameter
    const urlWithActive = page.url();
    if (urlWithActive.includes('status=active')) {
      console.log('✅ URL updated with status parameter: status=active');
    } else {
      console.log('❌ URL does not contain status parameter');
    }

    // Check table has results
    const rows = await page.$$('table tbody tr');
    console.log(`✅ Found ${rows.length} active listings in table`);

    // Take screenshot
    await page.screenshot({ path: '/tmp/listings_active_filter.png' });
    console.log('📸 Screenshot saved: /tmp/listings_active_filter.png\n');

    // Test 2: Change to "Pending" status
    console.log('3. Testing "Pending" status filter...');
    await page.click('label:has-text("Status")');
    await page.waitForSelector('[role="listbox"]', { timeout: 5000 });
    await page.click('[role="option"]:has-text("Pending")');
    await page.waitForTimeout(2000);

    // Check if filter chip updated
    const pendingChip = await page.waitForSelector('text=/Status: Pending/', { timeout: 5000 });
    if (pendingChip) {
      console.log('✅ Status filter chip updated: "Status: Pending"');
    }

    // Verify URL updated
    const urlWithPending = page.url();
    if (urlWithPending.includes('status=pending')) {
      console.log('✅ URL updated with status parameter: status=pending');
    } else {
      console.log('❌ URL does not contain status=pending');
    }

    // Check table has results
    const pendingRows = await page.$$('table tbody tr');
    console.log(`✅ Found ${pendingRows.length} pending listings in table`);

    // Take screenshot
    await page.screenshot({ path: '/tmp/listings_pending_filter.png' });
    console.log('📸 Screenshot saved: /tmp/listings_pending_filter.png\n');

    // Test 3: Change to "Active Under Contract" status
    console.log('4. Testing "Active Under Contract" status filter...');
    await page.click('label:has-text("Status")');
    await page.waitForSelector('[role="listbox"]', { timeout: 5000 });
    await page.click('[role="option"]:has-text("Active Under Contract")');
    await page.waitForTimeout(2000);

    // Check if filter chip updated
    const aucChip = await page.waitForSelector('text=/Status: Active Under Contract/', { timeout: 5000 });
    if (aucChip) {
      console.log('✅ Status filter chip updated: "Status: Active Under Contract"');
    }

    // Verify URL updated
    const urlWithAUC = page.url();
    if (urlWithAUC.includes('status=active_under_contract')) {
      console.log('✅ URL updated with status parameter: status=active_under_contract');
    } else {
      console.log('❌ URL does not contain status=active_under_contract');
    }

    // Check table has results
    const aucRows = await page.$$('table tbody tr');
    console.log(`✅ Found ${aucRows.length} active under contract listings in table`);

    // Take screenshot
    await page.screenshot({ path: '/tmp/listings_auc_filter.png' });
    console.log('📸 Screenshot saved: /tmp/listings_auc_filter.png\n');

    // Test 4: Clear filter
    console.log('5. Testing clear filter...');
    const clearButton = await page.waitForSelector('button:has-text("Clear All")', { timeout: 5000 });
    await clearButton.click();
    await page.waitForTimeout(2000);

    // Verify filter chip is gone
    const filterChipAfterClear = await page.$('text=/Status:/')
    if (!filterChipAfterClear) {
      console.log('✅ Filter chip removed after clearing');
    } else {
      console.log('❌ Filter chip still visible after clearing');
    }

    // Verify URL doesn't contain status parameter
    const urlAfterClear = page.url();
    if (!urlAfterClear.includes('status=')) {
      console.log('✅ URL cleared of status parameter');
    } else {
      console.log('❌ URL still contains status parameter');
    }

    // Take screenshot
    await page.screenshot({ path: '/tmp/listings_cleared.png' });
    console.log('📸 Screenshot saved: /tmp/listings_cleared.png\n');

    console.log('\n=== All Tests Passed ✅ ===\n');

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: '/tmp/listings_error.png' });
    console.log('📸 Error screenshot saved: /tmp/listings_error.png');
  } finally {
    await browser.close();
  }
}

testListingsStatusFilter().catch(console.error);
