import puppeteer from 'puppeteer';

/**
 * Test script to verify hydration error is fixed
 * Tests the admin app at http://localhost:3002
 */
async function testHydrationFix() {
  console.log('🧪 Testing hydration fix for kaelyn.ai admin app...\n');

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = await browser.newPage();

  // Set viewport for desktop testing
  await page.setViewport({ width: 1920, height: 1080 });

  // Listen for console errors
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      errors.push(text);
      console.log('❌ Console error:', text);
    }
  });

  // Listen for page errors
  page.on('pageerror', (error) => {
    console.log('❌ Page error:', error.message);
    errors.push(error.message);
  });

  try {
    console.log('📍 Navigating to http://localhost:3002...');
    await page.goto('http://localhost:3002', {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });

    console.log('✅ Page loaded successfully\n');

    // Wait a bit for React to hydrate
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Take screenshot
    await page.screenshot({ path: '/tmp/hydration_test_homepage.png', fullPage: true });
    console.log('📸 Screenshot saved to /tmp/hydration_test_homepage.png\n');

    // Check for hydration errors
    const hasHydrationError = errors.some(
      (error) =>
        error.includes('Hydration') ||
        error.includes('hydration') ||
        error.includes("didn't match")
    );

    if (hasHydrationError) {
      console.log('❌ HYDRATION ERROR DETECTED!\n');
      console.log('Errors found:');
      errors.forEach((error, i) => {
        console.log(`  ${i + 1}. ${error}`);
      });
      return false;
    }

    // Check if the page rendered correctly
    const pageContent = await page.evaluate(() => {
      return {
        hasNavigation: !!document.querySelector('nav'),
        hasMainContent: !!document.querySelector('main'),
        hasMuiBox: !!document.querySelector('.MuiBox-root'),
        bodyClasses: document.body.className,
        emotionStyles: document.querySelectorAll('[data-emotion]').length,
      };
    });

    console.log('📊 Page structure:');
    console.log('  - Navigation:', pageContent.hasNavigation ? '✅' : '❌');
    console.log('  - Main content:', pageContent.hasMainContent ? '✅' : '❌');
    console.log('  - MUI Box components:', pageContent.hasMuiBox ? '✅' : '❌');
    console.log('  - Emotion style tags:', pageContent.emotionStyles);
    console.log('  - Body classes:', pageContent.bodyClasses || '(none)');
    console.log('');

    if (errors.length === 0) {
      console.log('✅ NO HYDRATION ERRORS FOUND!');
      console.log('✅ The fix is working correctly!\n');
      return true;
    } else {
      console.log('⚠️  Some errors were found (but not hydration-related):');
      errors.forEach((error, i) => {
        console.log(`  ${i + 1}. ${error}`);
      });
      console.log('');
      return true; // Still pass if no hydration errors
    }
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    return false;
  } finally {
    await browser.close();
  }
}

testHydrationFix()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
