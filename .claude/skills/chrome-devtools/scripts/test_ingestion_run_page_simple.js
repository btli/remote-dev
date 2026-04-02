import puppeteer from 'puppeteer';

// Helper function to wait
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function testIngestionRunPage() {
  const browser = await puppeteer.launch({
    headless: false,
    devtools: false
  });
  const page = await browser.newPage();

  try {
    console.log('Testing Ingestion Run Page (Simple Test)...');

    // Collect all console messages
    const consoleMessages = [];
    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      consoleMessages.push({ type, text });

      if (type === 'error') {
        console.log(`[Browser ERROR] ${text}`);
      }
    });

    // Listen for page errors
    const pageErrors = [];
    page.on('pageerror', error => {
      pageErrors.push(error.message);
      console.error('[Page Error]', error.message);
    });

    // Navigate to the ingestion run details page
    console.log('Navigating to http://localhost:3002/ingestion/runs/cmhm5dwqn0000sbkdhgazb5fm');
    await page.goto('http://localhost:3002/ingestion/runs/cmhm5dwqn0000sbkdhgazb5fm', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    console.log('Page loaded, waiting for content...');
    await wait(2000);

    // Take screenshot of main page
    await page.screenshot({ path: '/tmp/ingestion_run_page_simple.png', fullPage: true });
    console.log('Screenshot saved to /tmp/ingestion_run_page_simple.png');

    // Click on "Archived HTML" tab
    console.log('Looking for "Archived HTML" tab...');
    const tabs = await page.$$('[role="tab"]');
    console.log(`Found ${tabs.length} tabs`);

    for (let i = 0; i < tabs.length; i++) {
      const tabText = await page.evaluate(el => el.textContent, tabs[i]);

      if (tabText && tabText.includes('Archived HTML')) {
        console.log('Clicking "Archived HTML" tab...');
        await tabs[i].click();
        await wait(3000);
        break;
      }
    }

    // Take screenshot after clicking tab
    await page.screenshot({ path: '/tmp/archived_html_tab_simple.png', fullPage: true });
    console.log('Screenshot saved to /tmp/archived_html_tab_simple.png');

    // Check for hydration errors
    const hydrationErrors = consoleMessages.filter(msg =>
      msg.text.includes('hydration') ||
      msg.text.includes('descendant') ||
      msg.text.includes('cannot contain')
    );

    console.log('\n=== Test Results ===');
    console.log(`Total console messages: ${consoleMessages.length}`);
    console.log(`Page errors: ${pageErrors.length}`);
    console.log(`Hydration errors: ${hydrationErrors.length}`);

    if (hydrationErrors.length > 0) {
      console.log('\n❌ Hydration errors found:');
      hydrationErrors.forEach(err => console.log(`  - ${err.text.substring(0, 100)}`));
    } else {
      console.log('\n✅ No hydration errors found!');
    }

    if (pageErrors.length > 0) {
      console.log('\n❌ Page errors found:');
      pageErrors.forEach(err => console.log(`  - ${err.substring(0, 100)}`));
    }

    // Try to find View buttons using XPath
    console.log('\nLooking for View buttons...');
    const viewButtons = await page.$x("//button[contains(text(), 'View')]");
    console.log(`Found ${viewButtons.length} "View" buttons`);

    if (viewButtons.length > 0 && hydrationErrors.length === 0) {
      console.log('\n✅ Test passed - Page renders correctly without hydration errors and has View buttons');
    } else if (hydrationErrors.length > 0) {
      console.log('\n❌ Test failed - Hydration errors still present');
    } else {
      console.log('\n⚠️  Test partial - No hydration errors but no View buttons found');
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: '/tmp/test_error_simple.png', fullPage: true });
    console.log('Error screenshot saved to /tmp/test_error_simple.png');
  } finally {
    await wait(2000);
    await browser.close();
  }
}

testIngestionRunPage().catch(console.error);
