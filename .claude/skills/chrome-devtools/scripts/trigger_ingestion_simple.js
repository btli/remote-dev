import puppeteer from 'puppeteer';

async function triggerIngestion() {
  console.log('🚀 Triggering ingestion for San Marino via admin UI\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 }
  });

  try {
    const page = await browser.newPage();

    // Navigate to ingestion page
    console.log('📍 Step 1: Loading admin ingestion page...');
    await page.goto('http://localhost:3002/ingestion', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    console.log('   ✅ Page loaded\n');

    // Click on Target Cities dropdown
    console.log('📍 Step 2: Selecting Target Cities...');
    await page.click('div:has-text("Target Cities") + div');
    await new Promise(r => setTimeout(r, 1000));

    // Type "San Marino" in the dropdown
    await page.keyboard.type('San Marino');
    await new Promise(r => setTimeout(r, 1000));

    // Press Enter to select
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: '/tmp/selected_san_marino.png' });
    console.log('   ✅ Selected San Marino\n');

    // Click "Start Ingestion" button
    console.log('📍 Step 3: Clicking Start Ingestion button...');
    await page.click('button:has-text("Start Ingestion")');
    await new Promise(r => setTimeout(r, 3000));
    await page.screenshot({ path: '/tmp/ingestion_triggered.png' });
    console.log('   ✅ Ingestion started!\n');

    console.log('✅ Success! Ingestion has been triggered for San Marino');
    console.log('   Check the "Recent Runs" section for progress');
    console.log('   Screenshots saved to /tmp/\n');

    // Wait to see the result
    console.log('   Keeping browser open for 20 seconds...');
    await new Promise(r => setTimeout(r, 20000));

  } catch (error) {
    console.error('❌ Error:', error.message);
    await page.screenshot({ path: '/tmp/error_screenshot.png' });
    throw error;
  } finally {
    await browser.close();
  }
}

triggerIngestion().catch(console.error);
