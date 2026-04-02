import puppeteer from 'puppeteer';

/**
 * E2E Test: Theme Default (Unauthenticated)
 *
 * Tests that the default theme is light mode for unauthenticated users
 */

async function testThemeDefault() {
  console.log('🧪 Starting theme default E2E test...\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 800 },
    args: ['--window-size=1280,800']
  });

  const page = await browser.newPage();

  try {
    console.log('📍 Step 1: Navigate to portal login page');
    await page.goto('http://localhost:3001/signin', { waitUntil: 'networkidle0' });
    await page.screenshot({ path: '/tmp/theme_default_signin.png' });
    console.log('  ✅ Login page loaded\n');

    console.log('📍 Step 2: Check default theme is light mode');
    const theme = await page.evaluate(() => {
      const body = document.body;
      const bgColor = window.getComputedStyle(body).backgroundColor;
      const isLight = bgColor === 'rgb(250, 250, 250)'; // Light mode background
      return { bgColor, isLight };
    });

    console.log(`  Background color: ${theme.bgColor}`);
    console.log(`  ${theme.isLight ? '✅' : '❌'} Default theme is ${theme.isLight ? 'light' : 'dark'} mode\n`);

    console.log('📍 Step 3: Check for light theme styles in page');
    const hasLightThemeStyles = await page.evaluate(() => {
      const textColor = window.getComputedStyle(document.body).color;
      const isDarkText = textColor.includes('0, 0, 0'); // Dark text on light background
      return { textColor, isDarkText };
    });

    console.log(`  Text color: ${hasLightThemeStyles.textColor}`);
    console.log(`  ${hasLightThemeStyles.isDarkText ? '✅' : '❌'} Text is ${hasLightThemeStyles.isDarkText ? 'dark' : 'light'} (expected dark on light background)\n`);

    console.log('📍 Summary:');
    console.log(`  ${theme.isLight ? '✅' : '❌'} Default theme: ${theme.isLight ? 'light' : 'dark'} mode`);
    console.log(`  ${hasLightThemeStyles.isDarkText ? '✅' : '❌'} Text color: correct for light theme`);
    console.log('\n📸 Screenshot saved to: /tmp/theme_default_signin.png');

    if (theme.isLight && hasLightThemeStyles.isDarkText) {
      console.log('\n✅ Test passed! Default theme is light mode.');
    } else {
      console.log('\n❌ Test failed! Default theme is not light mode.');
    }

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await page.screenshot({ path: '/tmp/theme_default_error.png' });
    console.log('📸 Error screenshot: /tmp/theme_default_error.png');
  } finally {
    console.log('\n⏳ Keeping browser open for 5 seconds for manual inspection...');
    await page.waitForTimeout(5000);
    await browser.close();
  }
}

testThemeDefault().catch(console.error);
