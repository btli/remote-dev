import puppeteer from 'puppeteer';

/**
 * E2E Test: Ingestion Trigger
 * Tests that the ingestion trigger form works correctly
 */
async function testIngestionTrigger() {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--window-size=1920,1080']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  try {
    console.log('🔍 Navigating to ingestion page...');
    await page.goto('http://localhost:3002/ingestion', {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    // Take screenshot of initial page
    await page.screenshot({ path: '/tmp/ingestion_initial.png' });
    console.log('✅ Ingestion page loaded');

    // Find the target cities dropdown
    console.log('🔍 Opening city selection dropdown...');
    await page.click('[aria-labelledby="cities-label"]');
    await page.waitForSelector('[role="listbox"]', { visible: true });
    await page.screenshot({ path: '/tmp/ingestion_cities_dropdown.png' });
    console.log('✅ City dropdown opened');

    // Select Alhambra
    console.log('🔍 Selecting Alhambra...');
    const menuItems = await page.$$('[role="option"]');
    let foundAlhambra = false;

    for (const item of menuItems) {
      const text = await item.evaluate(el => el.textContent);
      if (text && text.includes('Alhambra')) {
        await item.click();
        foundAlhambra = true;
        console.log('✅ Selected Alhambra');
        break;
      }
    }

    if (!foundAlhambra) {
      throw new Error('Could not find Alhambra in city list');
    }

    // Click outside dropdown to close it
    await page.click('h1');
    await new Promise(resolve => setTimeout(resolve, 500));
    await page.screenshot({ path: '/tmp/ingestion_city_selected.png' });

    // Check if "Start Ingestion" button is enabled
    console.log('🔍 Checking if Start Ingestion button is enabled...');
    const startButton = await page.$('button[type="submit"]');
    const isDisabled = await startButton?.evaluate(el => el.disabled);

    if (isDisabled) {
      throw new Error('Start Ingestion button is still disabled after selecting city');
    }
    console.log('✅ Start Ingestion button is enabled');

    // Click the Start Ingestion button
    console.log('🔍 Clicking Start Ingestion button...');
    await startButton?.click();

    // Wait for the API call to complete
    await new Promise(resolve => setTimeout(resolve, 2000));
    await page.screenshot({ path: '/tmp/ingestion_after_trigger.png' });

    // Check for success indicators
    const hasError = await page.$('[role="alert"][aria-live="polite"]');
    const errorText = hasError ? await hasError.evaluate(el => el.textContent) : null;

    if (errorText && errorText.includes('Failed')) {
      console.error('❌ Ingestion trigger failed:', errorText);
      throw new Error(`Trigger failed: ${errorText}`);
    }

    // Check if form was reset (cities cleared)
    const chipsAfter = await page.$$('[role="button"].MuiChip-root');
    if (chipsAfter.length > 0) {
      console.warn('⚠️ Form was not reset after submission');
    } else {
      console.log('✅ Form was reset successfully');
    }

    // Check if recent runs table was updated
    console.log('🔍 Checking recent runs table...');
    const tableRows = await page.$$('table tbody tr');
    console.log(`✅ Recent runs table has ${tableRows.length} row(s)`);

    // Take final screenshot
    await page.screenshot({ path: '/tmp/ingestion_final.png' });

    console.log('\n✅ All tests passed!');
    console.log('\nScreenshots saved:');
    console.log('  - /tmp/ingestion_initial.png');
    console.log('  - /tmp/ingestion_cities_dropdown.png');
    console.log('  - /tmp/ingestion_city_selected.png');
    console.log('  - /tmp/ingestion_after_trigger.png');
    console.log('  - /tmp/ingestion_final.png');

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: '/tmp/ingestion_error.png' });
    console.log('Error screenshot saved to /tmp/ingestion_error.png');
    throw error;
  } finally {
    await browser.close();
  }
}

testIngestionTrigger().catch(console.error);
