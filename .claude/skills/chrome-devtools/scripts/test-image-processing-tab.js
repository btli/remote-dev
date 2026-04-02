/**
 * E2E Test: Verify Image Processing Tab Fallback UI
 *
 * Tests that the Image Processing tab shows graceful fallback
 * when no ImageDownloadExecution data is available.
 */

import puppeteer from 'puppeteer';

async function testImageProcessingTab() {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  try {
    // Use a known completed job ID for testing
    const testJobId = 'cmhf7aari037fsbboxb3fciqj';

    console.log('\n=== Test 1: Navigate to Job Detail Page ===');
    console.log(`Using test job ID: ${testJobId}`);
    const jobUrl = `http://localhost:3002/ingestion/jobs/${testJobId}`;
    await page.goto(jobUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });

    // Wait for page to be interactive
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('✅ Job detail page loaded');
    await page.screenshot({ path: '/tmp/job-detail-page.png', fullPage: true });

    console.log('\n=== Test 2: Find Image Processing Tab ===');
    const tabs = await page.evaluate(() => {
      const tabButtons = Array.from(document.querySelectorAll('[role="tab"]'));
      return tabButtons.map((tab, index) => ({
        text: tab.textContent?.trim(),
        index: index
      }));
    });

    console.log('Available tabs:', tabs);

    const imageProcessingTab = tabs.find(tab =>
      tab.text?.toLowerCase().includes('image') &&
      tab.text?.toLowerCase().includes('processing')
    );

    if (!imageProcessingTab) {
      throw new Error('Image Processing tab not found');
    }

    console.log(`✅ Found Image Processing tab at index ${imageProcessingTab.index}: "${imageProcessingTab.text}"`);

    console.log('\n=== Test 3: Click Image Processing Tab ===');
    await page.evaluate((index) => {
      const tabButtons = Array.from(document.querySelectorAll('[role="tab"]'));
      tabButtons[index]?.click();
    }, imageProcessingTab.index);

    // Wait for tab content to render
    await new Promise(resolve => setTimeout(resolve, 1000));
    await page.screenshot({ path: '/tmp/image-processing-tab.png', fullPage: true });
    console.log('✅ Clicked Image Processing tab');

    console.log('\n=== Test 4: Verify Fallback UI Content ===');
    const tabContent = await page.evaluate(() => {
      // Find the active tab panel
      const tabPanel = document.querySelector('[role="tabpanel"]:not([hidden])');
      if (!tabPanel) return null;

      // Check for Alert message
      const alert = tabPanel.querySelector('[role="alert"]');
      const alertText = alert?.textContent?.trim();

      // Check for Cards with statistics
      const cards = Array.from(tabPanel.querySelectorAll('[class*="MuiCard"]'));
      const cardData = cards.map(card => {
        const title = card.querySelector('[class*="MuiTypography"][class*="subtitle"]')?.textContent?.trim();
        const value = card.querySelector('[class*="MuiTypography"][class*="h5"]')?.textContent?.trim();
        return { title, value };
      });

      return {
        alertText,
        cardCount: cards.length,
        cards: cardData
      };
    });

    if (!tabContent) {
      throw new Error('Tab panel content not found');
    }

    console.log('Alert message:', tabContent.alertText);
    console.log('Number of statistic cards:', tabContent.cardCount);
    console.log('Card data:', JSON.stringify(tabContent.cards, null, 2));

    // Verify expected content
    const expectedMessage = 'Detailed image download metrics not available';
    if (!tabContent.alertText?.includes(expectedMessage)) {
      throw new Error(`Expected alert message to contain "${expectedMessage}", got: ${tabContent.alertText}`);
    }
    console.log('✅ Alert message is correct');

    // Verify cards are shown (either 3 cards or a warning)
    if (tabContent.cardCount === 0) {
      console.log('⚠️  No statistic cards shown - checking for warning');
      const hasWarning = await page.evaluate(() => {
        const tabPanel = document.querySelector('[role="tabpanel"]:not([hidden])');
        const alerts = Array.from(tabPanel?.querySelectorAll('[role="alert"]') || []);
        return alerts.some(alert =>
          alert.textContent?.includes('No images were downloaded')
        );
      });

      if (hasWarning) {
        console.log('✅ Warning message shown for zero images');
      } else {
        throw new Error('Expected either statistic cards or warning message');
      }
    } else {
      console.log('✅ Statistic cards are displayed');

      // Verify expected card titles
      const expectedTitles = ['Images Downloaded', 'Listings Processed', 'Status'];
      const actualTitles = tabContent.cards.map(c => c.title);

      for (const expectedTitle of expectedTitles) {
        if (!actualTitles.includes(expectedTitle)) {
          console.log(`⚠️  Missing expected card: ${expectedTitle}`);
        }
      }
    }

    console.log('\n=== Test 5: Check for Errors in Console ===');
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Wait a bit to catch any delayed errors
    await new Promise(resolve => setTimeout(resolve, 2000));

    if (consoleErrors.length > 0) {
      console.log('⚠️  Console errors detected:');
      consoleErrors.forEach(err => console.log(`  - ${err}`));
    } else {
      console.log('✅ No console errors');
    }

    console.log('\n=== Test Complete ===');
    console.log('✅ All tests passed!');
    console.log('\nScreenshots saved:');
    console.log('  - /tmp/job-detail-page.png');
    console.log('  - /tmp/image-processing-tab.png');

    console.log('\nBrowser will stay open for 5 seconds for manual inspection...');
    await new Promise(resolve => setTimeout(resolve, 5000));

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await page.screenshot({ path: '/tmp/test-image-processing-error.png', fullPage: true });
    console.log('Error screenshot saved to /tmp/test-image-processing-error.png');
    throw error;
  } finally {
    await browser.close();
  }
}

testImageProcessingTab().catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
});
