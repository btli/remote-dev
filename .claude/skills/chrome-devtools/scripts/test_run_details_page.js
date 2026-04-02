import puppeteer from 'puppeteer';

async function testRunDetailsPage() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 }
  });

  const page = await browser.newPage();

  try {
    console.log('📄 Navigating to run details page...');
    await page.goto('http://localhost:3002/ingestion/runs/cmhh6vy0a0000sbpwnffkqlih', {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    // Wait for the main content to load
    await page.waitForSelector('h1', { timeout: 10000 });

    // Take screenshot
    await page.screenshot({ path: '/tmp/run_details_page.png', fullPage: true });
    console.log('✅ Screenshot saved to /tmp/run_details_page.png');

    // Check for any console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log('❌ Browser console error:', msg.text());
      }
    });

    // Check if the page loaded without errors
    const pageTitle = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      return h1 ? h1.textContent : 'NOT FOUND';
    });
    console.log('📋 Page title:', pageTitle);

    // Check if pipeline stages are visible
    const pipelineVisible = await page.evaluate(() => {
      return !!document.querySelector('[data-testid="pipeline-dag"], .MuiStepper-root');
    });
    console.log('🔄 Pipeline visualization visible:', pipelineVisible);

    // Wait a bit to see the page
    await page.waitForTimeout(3000);

    console.log('✅ Test completed successfully');
  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: '/tmp/run_details_error.png' });
    console.log('📸 Error screenshot saved to /tmp/run_details_error.png');
  } finally {
    await browser.close();
  }
}

testRunDetailsPage().catch(console.error);
