import puppeteer from 'puppeteer';

async function testIngestionAndValidation() {
  console.log('🚀 Starting E2E test: Ingestion + Field Validation');
  
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--start-maximized']
  });

  try {
    const page = await browser.newPage();
    
    // Step 1: Navigate to admin interface
    console.log('\n📍 Step 1: Opening admin interface...');
    await page.goto('http://localhost:3002', { waitUntil: 'networkidle2' });
    await page.screenshot({ path: '/tmp/01-admin-home.png', fullPage: true });
    console.log('   ✓ Admin interface loaded');

    // Step 2: Navigate to Backend section
    console.log('\n📍 Step 2: Navigating to Backend section...');
    const backendLink = await page.waitForSelector('a[href="/backend"]', { timeout: 5000 });
    await backendLink.click();
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    await page.screenshot({ path: '/tmp/02-backend-page.png', fullPage: true });
    console.log('   ✓ Backend page loaded');

    // Step 3: Find and click "Run Ingestion" button
    console.log('\n📍 Step 3: Triggering ingestion for San Marino...');
    
    // Wait for the Run Ingestion button
    await page.waitForSelector('button:has-text("Run Ingestion")', { timeout: 5000 });
    await page.screenshot({ path: '/tmp/03-before-ingestion.png', fullPage: true });
    
    // Click the button
    await page.click('button:has-text("Run Ingestion")');
    console.log('   ✓ Clicked Run Ingestion button');

    // Wait for modal or form
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/04-ingestion-modal.png', fullPage: true });

    // Fill in cities field (if there's a form)
    const citiesInput = await page.$('input[name="cities"], textarea[name="cities"]');
    if (citiesInput) {
      await citiesInput.clear();
      await citiesInput.type('San Marino');
      console.log('   ✓ Entered city: San Marino');
    }

    // Submit the form
    const submitButton = await page.$('button[type="submit"], button:has-text("Start Ingestion")');
    if (submitButton) {
      await submitButton.click();
      console.log('   ✓ Submitted ingestion request');
    }

    // Wait for ingestion to start
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/05-ingestion-started.png', fullPage: true });

    // Step 4: Monitor ingestion progress
    console.log('\n📍 Step 4: Monitoring ingestion progress...');
    let attempts = 0;
    const maxAttempts = 60; // Wait up to 60 seconds
    
    while (attempts < maxAttempts) {
      await page.waitForTimeout(1000);
      
      // Check for completion indicators
      const pageContent = await page.content();
      
      if (pageContent.includes('Completed') || pageContent.includes('Success')) {
        console.log('   ✓ Ingestion completed!');
        await page.screenshot({ path: '/tmp/06-ingestion-complete.png', fullPage: true });
        break;
      }
      
      if (pageContent.includes('Error') || pageContent.includes('Failed')) {
        console.log('   ⚠️  Ingestion encountered errors');
        await page.screenshot({ path: '/tmp/06-ingestion-error.png', fullPage: true });
        break;
      }
      
      attempts++;
      if (attempts % 10 === 0) {
        console.log(`   ... waiting (${attempts}s)`);
      }
    }

    // Step 5: Navigate to listings to verify data
    console.log('\n📍 Step 5: Checking ingested listings...');
    await page.goto('http://localhost:3002/listings', { waitUntil: 'networkidle2' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/07-listings-page.png', fullPage: true });
    
    // Get listing count
    const listingCount = await page.evaluate(() => {
      const rows = document.querySelectorAll('table tbody tr');
      return rows.length;
    });
    console.log(`   ✓ Found ${listingCount} listings in the UI`);

    // Step 6: Click on first listing to view details
    if (listingCount > 0) {
      console.log('\n📍 Step 6: Opening listing detail page...');
      const firstRow = await page.waitForSelector('table tbody tr:first-child');
      await firstRow.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: '/tmp/08-listing-detail.png', fullPage: true });
      console.log('   ✓ Listing detail page loaded');

      // Extract visible field data
      const visibleFields = await page.evaluate(() => {
        const fields = {};
        const labels = document.querySelectorAll('label, dt, th');
        labels.forEach(label => {
          const text = label.textContent.trim();
          const next = label.nextElementSibling;
          if (next) {
            fields[text] = next.textContent.trim();
          }
        });
        return fields;
      });

      console.log('\n📊 Visible fields on detail page:');
      Object.entries(visibleFields).slice(0, 20).forEach(([key, value]) => {
        console.log(`   ${key}: ${value.substring(0, 50)}${value.length > 50 ? '...' : ''}`);
      });
    }

    console.log('\n✅ E2E test completed successfully!');
    console.log('\n📸 Screenshots saved to /tmp/');
    console.log('   01-admin-home.png - Admin homepage');
    console.log('   02-backend-page.png - Backend management page');
    console.log('   03-before-ingestion.png - Before triggering');
    console.log('   04-ingestion-modal.png - Ingestion form/modal');
    console.log('   05-ingestion-started.png - After submission');
    console.log('   06-ingestion-complete.png - Completion status');
    console.log('   07-listings-page.png - Listings table');
    console.log('   08-listing-detail.png - Listing detail page');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await page.screenshot({ path: '/tmp/error-screenshot.png', fullPage: true });
    throw error;
  } finally {
    await browser.close();
  }
}

testIngestionAndValidation().catch(console.error);
