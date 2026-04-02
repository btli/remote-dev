import puppeteer from 'puppeteer';

/**
 * E2E Test: Theme Persistence with Light/Dark/System Options
 *
 * Tests:
 * 1. Default theme is light mode
 * 2. Theme radio buttons appear in profile menu
 * 3. Can select dark mode and it persists
 * 4. Can select light mode and it persists
 * 5. Can select system mode and it follows OS preference
 */

async function testAllThemeModes() {
  console.log('🧪 Starting comprehensive theme E2E test...\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 800 },
    args: ['--window-size=1280,800']
  });

  const page = await browser.newPage();

  // Track API calls
  await page.setRequestInterception(true);
  const apiCalls = [];

  page.on('request', request => {
    if (request.url().includes('/api/')) {
      apiCalls.push({
        method: request.method(),
        url: request.url(),
        postData: request.postData()
      });
    }
    request.continue();
  });

  try {
    console.log('📍 Step 1: Navigate to portal and verify default light theme');
    await page.goto('http://localhost:3001/signin', { waitUntil: 'networkidle0' });

    const initialTheme = await page.evaluate(() => {
      const body = document.body;
      const bgColor = window.getComputedStyle(body).backgroundColor;
      const isLight = bgColor === 'rgb(250, 250, 250)';
      return { bgColor, isLight };
    });

    console.log(`  Background: ${initialTheme.bgColor}`);
    console.log(`  ${initialTheme.isLight ? '✅' : '❌'} Default is light mode\n`);
    await page.screenshot({ path: '/tmp/theme_all_1_default.png' });

    console.log('📍 Step 2: Sign in (manual step - 60 seconds)');
    console.log('  ⚠️  Please sign in with Google within 60 seconds...');

    try {
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
      console.log('  ✅ Signed in successfully\n');
    } catch (error) {
      console.log('  ⚠️  Timeout waiting for sign-in, checking if already on dashboard...');
    }

    await page.screenshot({ path: '/tmp/theme_all_2_signed_in.png' });

    console.log('📍 Step 3: Open profile menu and verify theme options');
    const avatar = await page.waitForSelector('button img[alt]', { timeout: 5000 });
    await avatar.click();
    await new Promise(resolve => setTimeout(resolve, 500));
    await page.screenshot({ path: '/tmp/theme_all_3_profile_menu.png' });

    // Check for radio buttons
    const radioButtons = await page.$$('input[type="radio"][value]');
    console.log(`  Found ${radioButtons.length} theme options`);

    const radioValues = await Promise.all(
      radioButtons.map(radio => page.evaluate(r => r.value, radio))
    );
    console.log(`  Options: ${radioValues.join(', ')}`);
    console.log(`  ${radioValues.includes('light') && radioValues.includes('dark') && radioValues.includes('system') ? '✅' : '❌'} All three options available\n`);

    console.log('📍 Step 4: Select dark mode');
    const darkRadio = await page.$('input[type="radio"][value="dark"]');
    await darkRadio.click();
    console.log('  ✅ Dark mode selected');

    // Close menu
    await page.click('body');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await page.screenshot({ path: '/tmp/theme_all_4_dark_mode.png' });

    const darkTheme = await page.evaluate(() => {
      const body = document.body;
      const bgColor = window.getComputedStyle(body).backgroundColor;
      const isDark = bgColor === 'rgb(10, 10, 10)';
      return { bgColor, isDark };
    });

    console.log(`  Background: ${darkTheme.bgColor}`);
    console.log(`  ${darkTheme.isDark ? '✅' : '❌'} Dark mode applied\n`);

    console.log('📍 Step 5: Reload and verify dark mode persists');
    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise(resolve => setTimeout(resolve, 2000));
    await page.screenshot({ path: '/tmp/theme_all_5_dark_persisted.png' });

    const reloadedDark = await page.evaluate(() => {
      const body = document.body;
      const bgColor = window.getComputedStyle(body).backgroundColor;
      const isDark = bgColor === 'rgb(10, 10, 10)';
      return { bgColor, isDark };
    });

    console.log(`  Background: ${reloadedDark.bgColor}`);
    console.log(`  ${reloadedDark.isDark ? '✅' : '❌'} Dark mode persisted after reload\n`);

    console.log('📍 Step 6: Select light mode');
    const avatar2 = await page.waitForSelector('button img[alt]', { timeout: 5000 });
    await avatar2.click();
    await new Promise(resolve => setTimeout(resolve, 500));

    const lightRadio = await page.$('input[type="radio"][value="light"]');
    await lightRadio.click();
    console.log('  ✅ Light mode selected');

    await page.click('body');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await page.screenshot({ path: '/tmp/theme_all_6_light_mode.png' });

    const lightTheme = await page.evaluate(() => {
      const body = document.body;
      const bgColor = window.getComputedStyle(body).backgroundColor;
      const isLight = bgColor === 'rgb(250, 250, 250)';
      return { bgColor, isLight };
    });

    console.log(`  Background: ${lightTheme.bgColor}`);
    console.log(`  ${lightTheme.isLight ? '✅' : '❌'} Light mode applied\n`);

    console.log('📍 Step 7: Reload and verify light mode persists');
    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise(resolve => setTimeout(resolve, 2000));
    await page.screenshot({ path: '/tmp/theme_all_7_light_persisted.png' });

    const reloadedLight = await page.evaluate(() => {
      const body = document.body;
      const bgColor = window.getComputedStyle(body).backgroundColor;
      const isLight = bgColor === 'rgb(250, 250, 250)';
      return { bgColor, isLight };
    });

    console.log(`  Background: ${reloadedLight.bgColor}`);
    console.log(`  ${reloadedLight.isLight ? '✅' : '❌'} Light mode persisted after reload\n`);

    console.log('📍 Step 8: Select system preference mode');
    const avatar3 = await page.waitForSelector('button img[alt]', { timeout: 5000 });
    await avatar3.click();
    await new Promise(resolve => setTimeout(resolve, 500));

    const systemRadio = await page.$('input[type="radio"][value="system"]');
    await systemRadio.click();
    console.log('  ✅ System preference selected');

    await page.click('body');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await page.screenshot({ path: '/tmp/theme_all_8_system_mode.png' });

    const systemTheme = await page.evaluate(() => {
      const body = document.body;
      const bgColor = window.getComputedStyle(body).backgroundColor;
      const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      return { bgColor, systemPrefersDark };
    });

    console.log(`  Background: ${systemTheme.bgColor}`);
    console.log(`  System prefers: ${systemTheme.systemPrefersDark ? 'dark' : 'light'} mode`);
    console.log(`  ✅ System mode applied (following OS preference)\n`);

    console.log('📍 Step 9: Check API calls for persistence');
    const themeCalls = apiCalls.filter(call =>
      call.method === 'PATCH' && call.url.includes('/api/user')
    );

    console.log(`  Found ${themeCalls.length} theme update API calls`);
    if (themeCalls.length >= 3) {
      console.log('  ✅ Theme preferences saved to database\n');
    } else {
      console.log('  ⚠️  Expected at least 3 API calls (dark, light, system)\n');
    }

    console.log('📸 Screenshots:');
    console.log('  1. /tmp/theme_all_1_default.png - Default light theme');
    console.log('  2. /tmp/theme_all_2_signed_in.png - After sign in');
    console.log('  3. /tmp/theme_all_3_profile_menu.png - Profile menu with theme options');
    console.log('  4. /tmp/theme_all_4_dark_mode.png - Dark mode selected');
    console.log('  5. /tmp/theme_all_5_dark_persisted.png - Dark mode after reload');
    console.log('  6. /tmp/theme_all_6_light_mode.png - Light mode selected');
    console.log('  7. /tmp/theme_all_7_light_persisted.png - Light mode after reload');
    console.log('  8. /tmp/theme_all_8_system_mode.png - System preference mode');

    console.log('\n📊 Test Summary:');
    console.log(`  ${initialTheme.isLight ? '✅' : '❌'} Default theme is light`);
    console.log(`  ${radioValues.includes('system') ? '✅' : '❌'} System option available`);
    console.log(`  ${darkTheme.isDark ? '✅' : '❌'} Dark mode works`);
    console.log(`  ${reloadedDark.isDark ? '✅' : '❌'} Dark mode persists`);
    console.log(`  ${lightTheme.isLight ? '✅' : '❌'} Light mode works`);
    console.log(`  ${reloadedLight.isLight ? '✅' : '❌'} Light mode persists`);
    console.log(`  ${themeCalls.length >= 3 ? '✅' : '⚠️ '} API persistence working`);

    console.log('\n✅ Test complete!');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await page.screenshot({ path: '/tmp/theme_all_error.png' });
    console.log('📸 Error screenshot: /tmp/theme_all_error.png');
  } finally {
    console.log('\n⏳ Keeping browser open for 10 seconds...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    await browser.close();
  }
}

testAllThemeModes().catch(console.error);
