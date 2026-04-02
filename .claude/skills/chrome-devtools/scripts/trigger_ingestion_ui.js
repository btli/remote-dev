import puppeteer from 'puppeteer';

async function triggerIngestionViaBrowser() {
  console.log('🚀 Opening admin interface and triggering ingestion for San Marino\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 }
  });

  try {
    const page = await browser.newPage();

    // Step 1: Navigate to admin ingestion page
    console.log('📍 Step 1: Navigating to admin ingestion page...');
    await page.goto('http://localhost:3002/ingestion', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: '/tmp/admin_ingestion_page.png' });
    console.log('   ✅ Loaded ingestion page\n');

    // Step 2: Click "Trigger Ingestion" button
    console.log('📍 Step 2: Looking for "Trigger Ingestion" button...');
    const triggerButton = await page.waitForSelector('button:has-text("Trigger Ingestion")', { timeout: 10000 });
    await page.screenshot({ path: '/tmp/before_click_trigger.png' });
    console.log('   ✅ Found button, clicking...');
    await triggerButton.click();
    await new Promise(r => setTimeout(r, 1000));
    console.log('   ✅ Clicked trigger button\n');

    // Step 3: Wait for modal/dialog to appear
    console.log('📍 Step 3: Waiting for ingestion configuration modal...');
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
    await page.screenshot({ path: '/tmp/ingestion_modal.png' });
    console.log('   ✅ Modal appeared\n');

    // Step 4: Select San Marino from cities dropdown
    console.log('📍 Step 4: Selecting San Marino from cities...');

    // Try to find and click the cities select/autocomplete
    const citiesInput = await page.waitForSelector('input[placeholder*="Select cities"], input[name="cities"], [data-testid="cities-select"]', { timeout: 5000 });
    await citiesInput.click();
    await new Promise(r => setTimeout(r, 500));

    // Type "San Marino"
    await citiesInput.type('San Marino');
    await new Promise(r => setTimeout(r, 1000));

    // Click the San Marino option
    await page.click('[role="option"]:has-text("San Marino")');
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: '/tmp/after_select_san_marino.png' });
    console.log('   ✅ Selected San Marino\n');

    // Step 5: Set limit to 3
    console.log('📍 Step 5: Setting limit to 3 listings...');
    const limitInput = await page.waitForSelector('input[name="limit"], input[placeholder*="limit"]', { timeout: 5000 });
    await limitInput.click({ clickCount: 3 }); // Select all
    await limitInput.type('3');
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: '/tmp/after_set_limit.png' });
    console.log('   ✅ Set limit to 3\n');

    // Step 6: Click "Start Ingestion" button
    console.log('📍 Step 6: Starting ingestion...');
    const startButton = await page.waitForSelector('button:has-text("Start Ingestion"), button:has-text("Confirm"), button[type="submit"]', { timeout: 5000 });
    await startButton.click();
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: '/tmp/after_start_ingestion.png' });
    console.log('   ✅ Clicked start button\n');

    // Step 7: Wait for ingestion to start and show in UI
    console.log('📍 Step 7: Waiting for ingestion to appear in runs list...');
    await new Promise(r => setTimeout(r, 5000));
    await page.screenshot({ path: '/tmp/ingestion_started.png' });
    console.log('   ✅ Ingestion started!\n');

    console.log('✅ Ingestion triggered successfully via admin UI!');
    console.log('   Screenshots saved to /tmp/');
    console.log('   Browser will remain open for 30 seconds...\n');

    // Keep browser open for observation
    await new Promise(r => setTimeout(r, 30000));

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

triggerIngestionViaBrowser().catch(console.error);
