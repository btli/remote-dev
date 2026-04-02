import puppeteer from 'puppeteer';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function testPaginationFunctionality() {
  console.log('🚀 Testing pagination functionality...\n');

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 200
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  try {
    // Test 1: Navigate to page 2 directly
    console.log('═══ TEST 1: Direct navigation to page 2 ═══');
    await page.goto('http://localhost:3002/data/listings?page=2', { waitUntil: 'networkidle0' });
    await delay(2000);

    const url1 = page.url();
    console.log(`✓ URL: ${url1}`);
    console.log(url1.includes('page=2') ? '✅ Page 2 loads correctly' : '❌ Page 2 NOT loaded');
    await page.screenshot({ path: '/tmp/pagination_page2.png', fullPage: true });

    // Test 2: Click next button from page 1
    console.log('\n═══ TEST 2: Click next button ═══');
    await page.goto('http://localhost:3002/data/listings?page=1', { waitUntil: 'networkidle0' });
    await delay(1000);

    // Get initial pagination display
    const beforeClick = await page.evaluate(() => {
      const display = document.querySelector('[class*="MuiTablePagination-displayedRows"]');
      return display ? display.textContent : null;
    });
    console.log(`Before click: ${beforeClick}`);

    // Click next button
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('[class*="MuiTablePagination-actions"] button'));
      buttons[1]?.click(); // Second button is "next"
    });

    await delay(1500);

    const url2 = page.url();
    const afterClick = await page.evaluate(() => {
      const display = document.querySelector('[class*="MuiTablePagination-displayedRows"]');
      return display ? display.textContent : null;
    });

    console.log(`After click: ${afterClick}`);
    console.log(`✓ URL: ${url2}`);
    console.log(url2.includes('page=2') ? '✅ Next button works' : '❌ Next button FAILED');
    await page.screenshot({ path: '/tmp/pagination_next_click.png', fullPage: true });

    // Test 3: Click previous button
    console.log('\n═══ TEST 3: Click previous button ═══');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('[class*="MuiTablePagination-actions"] button'));
      buttons[0]?.click(); // First button is "previous"
    });

    await delay(1500);

    const url3 = page.url();
    const afterPrev = await page.evaluate(() => {
      const display = document.querySelector('[class*="MuiTablePagination-displayedRows"]');
      return display ? display.textContent : null;
    });

    console.log(`After previous: ${afterPrev}`);
    console.log(`✓ URL: ${url3}`);
    console.log(url3.includes('page=1') ? '✅ Previous button works' : '❌ Previous button FAILED');
    await page.screenshot({ path: '/tmp/pagination_prev_click.png', fullPage: true });

    // Test 4: Change page size
    console.log('\n═══ TEST 4: Change page size ═══');
    await page.click('[class*="MuiTablePagination-select"]');
    await delay(500);

    // Click 100 option
    const options = await page.$$('[role="option"]');
    if (options.length >= 3) {
      await options[2].click(); // Third option should be 100
      await delay(1500);

      const url4 = page.url();
      console.log(`✓ URL: ${url4}`);
      console.log(url4.includes('pageSize=100') ? '✅ Page size change works' : '❌ Page size change FAILED');
      console.log(url4.includes('page=1') ? '✅ Reset to page 1' : '⚠️ Did not reset to page 1');
      await page.screenshot({ path: '/tmp/pagination_pagesize_change.png', fullPage: true });
    }

    // Test 5: Stay on page 2 for 5 seconds
    console.log('\n═══ TEST 5: Stability test - stay on page 2 for 5 seconds ═══');
    await page.goto('http://localhost:3002/data/listings?page=2', { waitUntil: 'networkidle0' });
    const startUrl = page.url();
    console.log(`Start URL: ${startUrl}`);

    for (let i = 1; i <= 5; i++) {
      await delay(1000);
      const currentUrl = page.url();
      if (currentUrl !== startUrl) {
        console.log(`❌ URL changed at ${i}s: ${currentUrl}`);
        break;
      }
      if (i === 5) {
        console.log(`✅ Page 2 remained stable for 5 seconds`);
      }
    }

    console.log('\n═══ ALL TESTS COMPLETE ═══');
    console.log('📸 Screenshots saved to /tmp/');

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: '/tmp/pagination_test_error.png', fullPage: true });
  } finally {
    await delay(3000);
    await browser.close();
  }
}

testPaginationFunctionality().catch(console.error);
