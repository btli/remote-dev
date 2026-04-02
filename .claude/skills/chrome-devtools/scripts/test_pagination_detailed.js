import puppeteer from 'puppeteer';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function testPaginationDetailed() {
  console.log('🚀 Starting detailed pagination test...\n');

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 50
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  // Track all navigation events
  const navigationLog = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      navigationLog.push({
        time: new Date().toISOString(),
        url: frame.url()
      });
      console.log(`🔄 Navigation: ${frame.url()}`);
    }
  });

  try {
    console.log('═══ TEST 1: Navigate directly to page 2 ═══\n');

    await page.goto('http://localhost:3002/data/listings?page=2', { waitUntil: 'networkidle0' });
    console.log(`📍 Current URL: ${page.url()}`);
    await delay(1000);
    await page.screenshot({ path: '/tmp/pagination_test1_initial.png', fullPage: true });

    // Monitor for 5 seconds
    console.log('⏳ Monitoring for automatic redirects (5 seconds)...');
    const startUrl = page.url();
    for (let i = 0; i < 5; i++) {
      await delay(1000);
      const currentUrl = page.url();
      if (currentUrl !== startUrl) {
        console.log(`⚠️ URL CHANGED at ${i + 1}s: ${currentUrl}`);
        await page.screenshot({ path: `/tmp/pagination_test1_redirect_${i + 1}s.png`, fullPage: true });
        break;
      }
    }

    const finalUrl = page.url();
    console.log(`📍 Final URL: ${finalUrl}`);

    if (finalUrl !== startUrl) {
      console.log('❌ BUG CONFIRMED: Automatic redirect from page 2 to', finalUrl);
    } else {
      console.log('✅ No automatic redirect - page 2 is stable');
    }
    await page.screenshot({ path: '/tmp/pagination_test1_final.png', fullPage: true });

    console.log('\n═══ TEST 2: Click pagination buttons ═══\n');

    // Go back to page 1
    await page.goto('http://localhost:3002/data/listings?page=1', { waitUntil: 'networkidle0' });
    await delay(1000);

    // Get pagination info
    const paginationBefore = await page.evaluate(() => {
      const pagination = document.querySelector('[class*="MuiTablePagination-displayedRows"]');
      return pagination ? pagination.textContent : 'Not found';
    });
    console.log(`📊 Pagination display: ${paginationBefore}`);

    // Find all pagination buttons
    const buttons = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('[class*="MuiTablePagination"] button'));
      return btns.map((btn, idx) => ({
        index: idx,
        disabled: btn.disabled,
        ariaLabel: btn.getAttribute('aria-label'),
        title: btn.title,
        className: btn.className
      }));
    });
    console.log('🔘 Pagination buttons:', JSON.stringify(buttons, null, 2));

    console.log('\n🖱️ Clicking next page button...');
    const urlBeforeClick = page.url();
    console.log(`📍 URL before click: ${urlBeforeClick}`);

    // Click next button with better selector
    const clickSuccess = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('[class*="MuiTablePagination-actions"] button'));
      // Second button should be "next page"
      const nextButton = buttons[1];
      if (nextButton && !nextButton.disabled) {
        console.log('Found next button, clicking...');
        nextButton.click();
        return true;
      }
      return false;
    });

    if (!clickSuccess) {
      console.log('❌ Could not click next button');
      await page.screenshot({ path: '/tmp/pagination_test2_error.png', fullPage: true });
    } else {
      console.log('✅ Click executed');

      // Wait a bit for navigation
      await delay(500);

      const urlAfterClick = page.url();
      console.log(`📍 URL after click: ${urlAfterClick}`);
      await page.screenshot({ path: '/tmp/pagination_test2_after_click.png', fullPage: true });

      // Check pagination display
      const paginationAfter = await page.evaluate(() => {
        const pagination = document.querySelector('[class*="MuiTablePagination-displayedRows"]');
        return pagination ? pagination.textContent : 'Not found';
      });
      console.log(`📊 Pagination display after click: ${paginationAfter}`);

      // Monitor for additional changes
      console.log('⏳ Monitoring for 5 more seconds...');
      for (let i = 0; i < 5; i++) {
        await delay(1000);
        const currentUrl = page.url();
        if (currentUrl !== urlAfterClick) {
          console.log(`⚠️ URL CHANGED at ${i + 1}s: ${currentUrl}`);
          await page.screenshot({ path: `/tmp/pagination_test2_change_${i + 1}s.png`, fullPage: true });
        }
      }

      const finalUrl2 = page.url();
      console.log(`📍 Final URL: ${finalUrl2}`);

      if (urlAfterClick === urlBeforeClick) {
        console.log('❌ BUG: URL did not change after clicking next');
      } else if (finalUrl2 !== urlAfterClick) {
        console.log('❌ BUG: URL changed again after initial navigation');
      } else {
        console.log('✅ Pagination worked correctly');
      }
    }

    console.log('\n═══ TEST 3: Use page size selector ═══\n');

    await page.goto('http://localhost:3002/data/listings', { waitUntil: 'networkidle0' });
    await delay(1000);

    const urlBeforePageSize = page.url();
    console.log(`📍 URL before changing page size: ${urlBeforePageSize}`);

    // Click page size select
    console.log('🖱️ Opening page size selector...');
    await page.click('[class*="MuiTablePagination-select"]');
    await delay(500);
    await page.screenshot({ path: '/tmp/pagination_test3_menu_open.png', fullPage: true });

    // Click 100 option
    console.log('🖱️ Selecting page size 100...');
    const menuItems = await page.$$('[role="option"]');
    if (menuItems.length >= 3) {
      await menuItems[2].click(); // Should be 100
      await delay(500);

      const urlAfterPageSize = page.url();
      console.log(`📍 URL after changing page size: ${urlAfterPageSize}`);
      await page.screenshot({ path: '/tmp/pagination_test3_after_change.png', fullPage: true });

      // Check if pageSize param is in URL
      const hasPageSize = urlAfterPageSize.includes('pageSize=100');
      console.log(hasPageSize ? '✅ pageSize parameter updated' : '❌ pageSize parameter NOT in URL');
    }

    console.log('\n═══ NAVIGATION LOG ═══\n');
    navigationLog.forEach((entry, idx) => {
      console.log(`${idx + 1}. ${entry.time}: ${entry.url}`);
    });

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: '/tmp/pagination_error.png', fullPage: true });
  } finally {
    console.log('\n📸 All screenshots saved to /tmp/');
    console.log('🔍 Keeping browser open for 30 seconds...');
    await delay(30000);
    await browser.close();
  }
}

testPaginationDetailed().catch(console.error);
