import puppeteer from 'puppeteer';

async function testImageGallery() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 }
  });
  const page = await browser.newPage();

  // Track console errors
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  try {
    console.log('=== Testing Image Gallery ===\n');

    // Navigate to listings page
    console.log('Step 1: Navigate to listings page...');
    await page.goto('http://localhost:3002/data/listings', { waitUntil: 'networkidle2' });
    await page.screenshot({ path: '/tmp/test_listings_page.png', fullPage: true });

    // Click on first listing
    console.log('Step 2: Click on first listing...');
    await page.waitForSelector('table tbody tr');
    await page.click('table tbody tr:first-child');
    await new Promise(resolve => setTimeout(resolve, 2000));
    await page.screenshot({ path: '/tmp/test_listing_detail.png', fullPage: true });

    // Check if images loaded
    console.log('Step 3: Check for image gallery...');
    const galleryInfo = await page.evaluate(() => {
      // Check for gallery
      const galleryHeading = Array.from(document.querySelectorAll('h6')).find(h =>
        h.textContent === 'Property Images'
      );

      if (!galleryHeading) return { found: false };

      // Count thumbnails
      const thumbnails = document.querySelectorAll('[role="img"], img');
      const visibleThumbnails = Array.from(thumbnails).filter(img => {
        const rect = img.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      // Get image count chip
      const chip = document.querySelector('[class*="MuiChip"]');
      const imageCountText = chip ? chip.textContent : '';

      return {
        found: true,
        thumbnailCount: visibleThumbnails.length,
        imageCountText,
        galleryVisible: !!galleryHeading
      };
    });

    if (galleryInfo.found) {
      console.log(`✅ Image gallery found`);
      console.log(`   Thumbnails visible: ${galleryInfo.thumbnailCount}`);
      console.log(`   Count display: ${galleryInfo.imageCountText}`);
    } else {
      console.log('⚠️  Image gallery not found on page');
    }

    // Try to click on first thumbnail
    if (galleryInfo.found && galleryInfo.thumbnailCount > 0) {
      console.log('\nStep 4: Click first thumbnail to open modal...');

      // Find and click a thumbnail
      await page.evaluate(() => {
        const papers = Array.from(document.querySelectorAll('[class*="MuiPaper"]'));
        const thumbnail = papers.find(p => {
          const img = p.querySelector('img');
          return img && img.src && img.src.includes('http');
        });
        if (thumbnail) {
          thumbnail.click();
        }
      });

      await new Promise(resolve => setTimeout(resolve, 1000));
      await page.screenshot({ path: '/tmp/test_modal_open.png', fullPage: true });

      // Check if modal opened
      const modalInfo = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return { opened: false };

        const image = dialog.querySelector('img');
        const closeButton = dialog.querySelector('button');
        const prevButton = Array.from(dialog.querySelectorAll('button')).find(b =>
          b.querySelector('svg')?.getAttribute('data-testid') === 'NavigateBeforeIcon'
        );
        const nextButton = Array.from(dialog.querySelectorAll('button')).find(b =>
          b.querySelector('svg')?.getAttribute('data-testid') === 'NavigateNextIcon'
        );

        return {
          opened: true,
          hasImage: !!image,
          imageUrl: image?.src || '',
          hasCloseButton: !!closeButton,
          hasNavigation: !!(prevButton || nextButton),
          imageWidth: image?.naturalWidth || 0,
          imageHeight: image?.naturalHeight || 0
        };
      });

      if (modalInfo.opened) {
        console.log('✅ Modal opened successfully');
        console.log(`   Image loaded: ${modalInfo.hasImage}`);
        console.log(`   Image dimensions: ${modalInfo.imageWidth}×${modalInfo.imageHeight}`);
        console.log(`   Has close button: ${modalInfo.hasCloseButton}`);
        console.log(`   Has navigation: ${modalInfo.hasNavigation}`);
      } else {
        console.log('⚠️  Modal did not open');
      }

      // Test keyboard navigation
      console.log('\nStep 5: Test keyboard navigation...');
      await page.keyboard.press('ArrowRight');
      await new Promise(resolve => setTimeout(resolve, 500));
      console.log('  Pressed Right Arrow');

      await page.keyboard.press('ArrowLeft');
      await new Promise(resolve => setTimeout(resolve, 500));
      console.log('  Pressed Left Arrow');

      // Close modal with Escape
      await page.keyboard.press('Escape');
      await new Promise(resolve => setTimeout(resolve, 500));
      console.log('  Pressed Escape');

      const modalClosed = await page.evaluate(() => {
        return !document.querySelector('[role="dialog"]');
      });

      if (modalClosed) {
        console.log('✅ Modal closed with Escape key');
      } else {
        console.log('⚠️  Modal still open after Escape');
      }
    }

    // Check for errors
    if (errors.length > 0) {
      console.log('\n⚠️  Console errors found:');
      errors.forEach(err => console.log(`  - ${err}`));
    } else {
      console.log('\n✅ No console errors');
    }

    console.log('\n=== Test Complete ===');
    console.log('Keeping browser open for 15 seconds for manual inspection...');
    await new Promise(resolve => setTimeout(resolve, 15000));

  } catch (error) {
    console.error('Error during testing:', error);
    await page.screenshot({ path: '/tmp/test_error.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

testImageGallery().catch(console.error);
