/**
 * E2E Test: Listing Images
 *
 * Tests that images load correctly on the listing detail page after
 * fixing the image URL transformation logic.
 */

import puppeteer from 'puppeteer';

const LISTING_ID = 'cmhgwdo7o004rsbc5k2gcxxw9';
const ADMIN_URL = 'http://localhost:3002/data/listings/' + LISTING_ID;

async function testListingImages() {
  console.log('Starting listing images test...\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 },
  });

  const page = await browser.newPage();

  // Track network requests
  const imageRequests = [];
  const failedImages = [];

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/api/images/')) {
      const status = response.status();
      imageRequests.push({ url, status });

      if (status !== 200) {
        failedImages.push({ url, status });
        console.log('Image failed: ' + url + ' (' + status + ')');
      } else {
        console.log('Image loaded: ' + url.split('/').pop());
      }
    }
  });

  try {
    console.log('Navigating to: ' + ADMIN_URL + '\n');
    await page.goto(ADMIN_URL, { waitUntil: 'networkidle0' });

    await new Promise(resolve => setTimeout(resolve, 2000));

    await page.screenshot({
      path: '/tmp/listing-images-initial.png',
      fullPage: true,
    });
    console.log('Screenshot saved: /tmp/listing-images-initial.png\n');

    const images = await page.$$eval('img', (imgs) =>
      imgs
        .filter((img) => img.src.includes('/api/images/'))
        .map((img) => ({
          src: img.src,
          alt: img.alt,
          width: img.naturalWidth,
          height: img.naturalHeight,
          complete: img.complete,
          hasError: !img.naturalWidth || !img.naturalHeight,
        }))
    );

    console.log('\nImage Summary:');
    console.log('   Total images on page: ' + images.length);
    console.log('   Total image requests: ' + imageRequests.length);
    console.log('   Failed image requests: ' + failedImages.length + '\n');

    if (images.length === 0) {
      console.log('No images found on page');
    } else {
      console.log('Images found on page:');
      images.forEach((img, index) => {
        const status = img.hasError ? 'BROKEN' : 'OK';
        const fileName = img.src.split('/').pop();
        console.log(
          '   ' + status + ' [' + (index + 1) + '] ' + fileName + ' (' + img.width + 'x' + img.height + ')'
        );
      });
    }

    const brokenImages = images.filter((img) => img.hasError);
    if (brokenImages.length > 0) {
      console.log('\nFound ' + brokenImages.length + ' broken images:');
      brokenImages.forEach((img) => {
        console.log('   - ' + img.src);
      });
    }

    console.log('\nScrolling to load lazy images...');
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await new Promise(resolve => setTimeout(resolve, 2000));

    await page.screenshot({
      path: '/tmp/listing-images-final.png',
      fullPage: true,
    });
    console.log('Screenshot saved: /tmp/listing-images-final.png\n');

    console.log('\n' + '='.repeat(60));
    console.log('TEST SUMMARY');
    console.log('='.repeat(60));
    console.log('Images on page: ' + images.length);
    console.log('Successful image loads: ' + imageRequests.filter(r => r.status === 200).length);
    console.log('Failed image loads: ' + failedImages.length);
    console.log('Broken images: ' + brokenImages.length);
    console.log('='.repeat(60));

    if (failedImages.length === 0 && brokenImages.length === 0) {
      console.log('\nTEST PASSED: All images loaded successfully!\n');
    } else {
      console.log('\nTEST FAILED: Some images failed to load\n');
      console.log('Failed requests:');
      failedImages.forEach((req) => {
        console.log('   - ' + req.url + ' (' + req.status + ')');
      });
    }
  } catch (error) {
    console.error('\nTest failed with error:', error);
  } finally {
    await browser.close();
  }
}

testListingImages().catch(console.error);
