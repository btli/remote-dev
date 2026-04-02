import puppeteer from 'puppeteer';

async function debugListingImages() {
  const browser = await puppeteer.launch({
    headless: false,
    devtools: true
  });
  const page = await browser.newPage();

  // Enable request/response logging
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  page.on('request', request => {
    if (request.url().includes('image') || request.url().includes('minio') || request.url().includes('s3')) {
      console.log('📤 IMAGE REQUEST:', request.url());
    }
  });

  page.on('response', async response => {
    if (response.url().includes('image') || response.url().includes('minio') || response.url().includes('s3')) {
      console.log('📥 IMAGE RESPONSE:', response.status(), response.url());
    }
  });

  page.on('requestfailed', request => {
    if (request.url().includes('image') || request.url().includes('minio') || request.url().includes('s3')) {
      console.error('❌ FAILED REQUEST:', request.url(), request.failure());
    }
  });

  try {
    console.log('Navigating to listing detail page...');
    await page.goto('http://localhost:3002/data/listings/cmhgxnvn80021sba9zgefy07n', {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    // Wait a moment for images to attempt loading
    await page.waitForTimeout(2000);

    // Take screenshot
    await page.screenshot({ path: '/tmp/listing-detail.png', fullPage: true });
    console.log('📸 Screenshot saved to /tmp/listing-detail.png');

    // Check for image elements
    const imageInfo = await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll('img'));
      return images.map(img => ({
        src: img.src,
        alt: img.alt,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        complete: img.complete,
        hasError: img.naturalWidth === 0
      }));
    });

    console.log('\n📊 Image Elements Found:', imageInfo.length);
    imageInfo.forEach((img, i) => {
      console.log(`\nImage ${i + 1}:`);
      console.log('  src:', img.src);
      console.log('  complete:', img.complete);
      console.log('  hasError:', img.hasError);
      console.log('  dimensions:', `${img.naturalWidth}x${img.naturalHeight}`);
    });

    // Check network tab for failed requests
    const failedRequests = await page.evaluate(() => {
      return window.performance.getEntriesByType('resource')
        .filter(r => r.name.includes('image') || r.name.includes('minio'))
        .map(r => ({
          url: r.name,
          duration: r.duration,
          transferSize: r.transferSize
        }));
    });

    console.log('\n📡 Network Requests:', failedRequests);

    // Check console errors
    console.log('\n🔍 Checking for errors in console...');

    // Keep browser open for manual inspection
    console.log('\n✅ Browser staying open for manual inspection. Press Ctrl+C to close.');
    await new Promise(() => {}); // Keep alive

  } catch (error) {
    console.error('❌ Error:', error);
    await page.screenshot({ path: '/tmp/listing-detail-error.png', fullPage: true });
  }
}

debugListingImages().catch(console.error);
