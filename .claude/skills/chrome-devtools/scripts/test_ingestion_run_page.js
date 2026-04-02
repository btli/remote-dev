import puppeteer from 'puppeteer';

// Helper function to wait
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function testIngestionRunPage() {
  const browser = await puppeteer.launch({
    headless: false,
    devtools: true // Open DevTools automatically
  });
  const page = await browser.newPage();

  try {
    console.log('Testing Ingestion Run Page...');

    // Listen for console messages
    page.on('console', msg => {
      const type = msg.type();
      if (type === 'error' || type === 'warning') {
        console.log(`[Browser ${type.toUpperCase()}]`, msg.text());
      }
    });

    // Listen for page errors
    page.on('pageerror', error => {
      console.error('[Page Error]', error.message);
    });

    // Listen for failed requests
    page.on('requestfailed', request => {
      console.error('[Request Failed]', request.url(), request.failure().errorText);
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
    await page.screenshot({ path: '/tmp/ingestion_run_page.png', fullPage: true });
    console.log('Screenshot saved to /tmp/ingestion_run_page.png');

    // Check for error messages on the page
    const errorElements = await page.$$('[role="alert"]');
    if (errorElements.length > 0) {
      console.log(`Found ${errorElements.length} alert(s) on the page`);
      for (const el of errorElements) {
        const text = await page.evaluate(e => e.textContent, el);
        console.log('Alert:', text);
      }
    }

    // Click on "Archived HTML" tab
    console.log('Looking for "Archived HTML" tab...');
    const tabs = await page.$$('[role="tab"]');
    console.log(`Found ${tabs.length} tabs`);

    for (let i = 0; i < tabs.length; i++) {
      const tabText = await page.evaluate(el => el.textContent, tabs[i]);
      console.log(`Tab ${i}: "${tabText}"`);

      if (tabText && tabText.includes('Archived HTML')) {
        console.log('Clicking "Archived HTML" tab...');
        await tabs[i].click();
        await wait(2000);
        break;
      }
    }

    // Take screenshot after clicking tab
    await page.screenshot({ path: '/tmp/archived_html_tab.png', fullPage: true });
    console.log('Screenshot saved to /tmp/archived_html_tab.png');

    // Check for archived HTML files
    const listItems = await page.$$('[role="button"]');
    console.log(`Found ${listItems.length} clickable items`);

    // Check if there's a "View" button
    const viewButtons = await page.$$('button:has-text("View")');
    console.log(`Found ${viewButtons.length} "View" buttons`);

    if (viewButtons.length > 0) {
      console.log('Clicking first "View" button...');

      // Set up listener for popup
      const newPagePromise = new Promise(resolve =>
        browser.once('targetcreated', target => resolve(target.page()))
      );

      await viewButtons[0].click();

      // Wait for new page to open
      const newPage = await newPagePromise;
      await newPage.waitForNavigation({ waitUntil: 'networkidle2' });

      console.log('New page URL:', newPage.url());

      // Check for errors in new page
      const newPageContent = await newPage.content();
      if (newPageContent.includes('Internal Server Error') || newPageContent.includes('500')) {
        console.error('❌ New page shows Internal Server Error!');
        console.log('Page content:', newPageContent.substring(0, 500));
      } else {
        console.log('✅ HTML page loaded successfully');
      }

      // Take screenshot of HTML viewer
      await newPage.screenshot({ path: '/tmp/html_viewer.png', fullPage: true });
      console.log('Screenshot saved to /tmp/html_viewer.png');

      await newPage.close();
    }

    console.log('✅ Test completed');
  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: '/tmp/test_error.png', fullPage: true });
    console.log('Error screenshot saved to /tmp/test_error.png');
  } finally {
    await browser.close();
  }
}

testIngestionRunPage().catch(console.error);
