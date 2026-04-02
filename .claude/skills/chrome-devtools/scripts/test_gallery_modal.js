import puppeteer from 'puppeteer';

async function testGalleryModal() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 }
  });
  const page = await browser.newPage();

  try {
    console.log('=== Testing Image Gallery Modal ===\n');

    // Navigate directly to a listing detail page
    console.log('Step 1: Navigate to listing detail...');
    await page.goto('http://localhost:3002/data/listings', { waitUntil: 'networkidle2' });

    // Click first listing
    await page.waitForSelector('table tbody tr');
    await page.click('table tbody tr:first-child');
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('Step 2: Find clickable thumbnail...');
    const thumbnailInfo = await page.evaluate(() => {
      const heading = Array.from(document.querySelectorAll('h6')).find(h =>
        h.textContent === 'Property Images'
      );
      if (!heading) return { found: false };

      // Find all Paper components with images
      const papers = Array.from(document.querySelectorAll('[class*="MuiPaper"]'));
      const clickablePapers = papers.filter(p => {
        const img = p.querySelector('img');
        const rect = p.getBoundingClientRect();
        return img && img.src && rect.width > 50 && rect.height > 50;
      });

      return {
        found: true,
        count: clickablePapers.length,
        hasPointerCursor: clickablePapers.length > 0 &&
          window.getComputedStyle(clickablePapers[0]).cursor === 'pointer'
      };
    });

    console.log(`Found ${thumbnailInfo.count} clickable thumbnails`);
    console.log(`Has pointer cursor: ${thumbnailInfo.hasPointerCursor}`);

    console.log('\nStep 3: Click on second thumbnail (index 1)...');
    await page.evaluate(() => {
      // Find all papers with images
      const papers = Array.from(document.querySelectorAll('[class*="MuiPaper"]'));
      const clickablePapers = papers.filter(p => {
        const img = p.querySelector('img');
        const rect = p.getBoundingClientRect();
        return img && img.src && rect.width > 50 && rect.height > 50;
      });

      if (clickablePapers.length > 1) {
        console.log('Clicking paper element');
        clickablePapers[1].click();
      }
    });

    await new Promise(resolve => setTimeout(resolve, 1500));
    await page.screenshot({ path: '/tmp/test_modal_clicked.png', fullPage: true });

    // Check if modal opened
    console.log('\nStep 4: Check if modal opened...');
    const modalInfo = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return { opened: false };

      const dialogImage = dialog.querySelector('img');
      const closeBtn = Array.from(dialog.querySelectorAll('button')).find(b =>
        b.querySelector('[data-testid="CloseIcon"]')
      );
      const prevBtn = Array.from(dialog.querySelectorAll('button')).find(b =>
        b.querySelector('[data-testid="NavigateBeforeIcon"]')
      );
      const nextBtn = Array.from(dialog.querySelectorAll('button')).find(b =>
        b.querySelector('[data-testid="NavigateNextIcon"]')
      );

      return {
        opened: true,
        hasImage: !!dialogImage,
        imageUrl: dialogImage?.src || '',
        hasCloseButton: !!closeBtn,
        hasPrevButton: !!prevBtn,
        hasNextButton: !!nextBtn,
        imageNaturalWidth: dialogImage?.naturalWidth || 0,
        imageNaturalHeight: dialogImage?.naturalHeight || 0
      };
    });

    if (modalInfo.opened) {
      console.log('✅ Modal opened successfully!');
      console.log(`   Image loaded: ${modalInfo.hasImage}`);
      console.log(`   Dimensions: ${modalInfo.imageNaturalWidth}×${modalInfo.imageNaturalHeight}`);
      console.log(`   Has close button: ${modalInfo.hasCloseButton}`);
      console.log(`   Has prev button: ${modalInfo.hasPrevButton}`);
      console.log(`   Has next button: ${modalInfo.hasNextButton}`);

      // Test navigation
      console.log('\nStep 5: Test next button...');
      await page.evaluate(() => {
        const nextBtn = Array.from(document.querySelectorAll('button')).find(b =>
          b.querySelector('[data-testid="NavigateNextIcon"]')
        );
        if (nextBtn) nextBtn.click();
      });
      await new Promise(resolve => setTimeout(resolve, 800));
      await page.screenshot({ path: '/tmp/test_modal_next.png', fullPage: true });
      console.log('   Clicked next button');

      console.log('\nStep 6: Test keyboard navigation...');
      await page.keyboard.press('ArrowLeft');
      await new Promise(resolve => setTimeout(resolve, 500));
      console.log('   Pressed ArrowLeft');

      await page.keyboard.press('ArrowRight');
      await new Promise(resolve => setTimeout(resolve, 500));
      console.log('   Pressed ArrowRight');

      console.log('\nStep 7: Close with Escape...');
      await page.keyboard.press('Escape');
      await new Promise(resolve => setTimeout(resolve, 500));

      const modalClosed = await page.evaluate(() => {
        return !document.querySelector('[role="dialog"]');
      });

      if (modalClosed) {
        console.log('✅ Modal closed with Escape');
      } else {
        console.log('⚠️  Modal still open');
      }

    } else {
      console.log('❌ Modal did not open');

      // Debug info
      console.log('\nDebug: Checking React component state...');
      const debugInfo = await page.evaluate(() => {
        const heading = Array.from(document.querySelectorAll('h6')).find(h =>
          h.textContent === 'Property Images'
        );
        if (!heading) return { error: 'Gallery not found' };

        const papers = Array.from(document.querySelectorAll('[class*="MuiPaper"]'));
        const clickablePapers = papers.filter(p => {
          const img = p.querySelector('img');
          return img && img.src;
        });

        return {
          totalPapers: papers.length,
          clickablePapers: clickablePapers.length,
          firstPaperStyle: clickablePapers.length > 0 ? {
            cursor: window.getComputedStyle(clickablePapers[0]).cursor,
            pointerEvents: window.getComputedStyle(clickablePapers[0]).pointerEvents
          } : null
        };
      });
      console.log('Debug info:', JSON.stringify(debugInfo, null, 2));
    }

    console.log('\n=== Test Complete ===');
    console.log('Keeping browser open for 20 seconds...');
    await new Promise(resolve => setTimeout(resolve, 20000));

  } catch (error) {
    console.error('❌ Error:', error.message);
    await page.screenshot({ path: '/tmp/test_error.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

testGalleryModal().catch(console.error);
