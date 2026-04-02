import puppeteer from 'puppeteer';

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testThemePersistence() {
  console.log('🧪 Starting theme persistence E2E test...\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 720 }
  });

  const page = await browser.newPage();

  // Enable console logging from the page
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[ThemeContext]')) {
      console.log('📱 Browser console:', text);
    }
  });

  // Enable request interception to log API calls
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.url().includes('/api/user')) {
      console.log(`🌐 API ${request.method()} ${request.url()}`);
      if (request.method() === 'PATCH') {
        console.log('📤 Request body:', request.postData());
      }
    }
    request.continue();
  });

  page.on('response', async (response) => {
    if (response.url().includes('/api/user')) {
      console.log(`✅ API Response ${response.status()}`);
      if (response.request().method() === 'PATCH') {
        try {
          const body = await response.text();
          console.log('📥 Response body:', body.substring(0, 200));
        } catch (e) {
          console.log('⚠️ Could not read response body');
        }
      }
    }
  });

  try {
    // Step 1: Navigate directly to signin page
    console.log('\n📍 Step 1: Navigate to signin page');
    await page.goto('http://localhost:3001/signin', { waitUntil: 'networkidle2' });
    await page.screenshot({ path: '/tmp/theme_1_signin.png' });
    console.log('✅ Screenshot saved: /tmp/theme_1_signin.png');

    // Step 2: Sign in with credentials
    console.log('\n📍 Step 2: Click Sign in with Credentials button');
    await wait(1000);
    const buttons = await page.$$('button');
    let credentialsButton = null;
    for (const button of buttons) {
      const text = await page.evaluate(el => el.textContent, button);
      if (text.includes('Sign in with Credentials')) {
        credentialsButton = button;
        break;
      }
    }

    if (!credentialsButton) {
      throw new Error('Could not find Credentials button');
    }

    await credentialsButton.click();
    await wait(1000);
    await page.screenshot({ path: '/tmp/theme_2_credentials_form.png' });
    console.log('✅ Screenshot saved: /tmp/theme_2_credentials_form.png');

    // Fill in credentials
    console.log('📝 Filling in credentials...');
    await page.type('input[name="email"]', 'bryan.li@gmail.com');
    await page.type('input[name="password"]', 'Password123!');
    await page.screenshot({ path: '/tmp/theme_3_credentials_filled.png' });
    console.log('✅ Screenshot saved: /tmp/theme_3_credentials_filled.png');

    // Submit form
    console.log('🔐 Submitting credentials...');
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 });
    await wait(2000); // Wait for theme to load
    await page.screenshot({ path: '/tmp/theme_4_logged_in.png' });
    console.log('✅ Screenshot saved: /tmp/theme_4_logged_in.png');

    // Step 3: Check current theme
    console.log('\n📍 Step 3: Check current theme (should be light)');
    const currentTheme = await page.evaluate(() => {
      const html = document.documentElement;
      return {
        dataTheme: html.getAttribute('data-theme'),
        backgroundColor: window.getComputedStyle(html).backgroundColor
      };
    });
    console.log('🎨 Current theme:', currentTheme);

    // Step 4: Open profile menu
    console.log('\n📍 Step 4: Open profile menu');
    await wait(1000);
    const profileButton = await page.waitForSelector('[aria-haspopup="true"]', { timeout: 5000 });
    await profileButton.click();
    await page.waitForSelector('[id="profile-menu"]', { visible: true });
    await page.screenshot({ path: '/tmp/theme_5_menu_open.png' });
    console.log('✅ Screenshot saved: /tmp/theme_5_menu_open.png');

    // Step 5: Select dark theme
    console.log('\n📍 Step 5: Select dark theme');
    const darkRadio = await page.$('input[type="radio"][value="dark"]');
    await darkRadio.click();
    await wait(2000); // Wait for API call and theme change
    await page.screenshot({ path: '/tmp/theme_6_dark_selected.png' });
    console.log('✅ Screenshot saved: /tmp/theme_6_dark_selected.png');

    // Step 6: Verify theme changed in UI
    console.log('\n📍 Step 6: Verify theme changed in UI');
    const newTheme = await page.evaluate(() => {
      const html = document.documentElement;
      return {
        dataTheme: html.getAttribute('data-theme'),
        backgroundColor: window.getComputedStyle(html).backgroundColor
      };
    });
    console.log('🎨 New theme:', newTheme);

    // Step 7: Reload page to test persistence
    console.log('\n📍 Step 7: Reload page to test persistence');
    await page.reload({ waitUntil: 'networkidle2' });
    await wait(3000); // Wait for theme to load
    await page.screenshot({ path: '/tmp/theme_7_after_reload.png' });
    console.log('✅ Screenshot saved: /tmp/theme_7_after_reload.png');

    // Step 8: Verify theme persisted
    console.log('\n📍 Step 8: Verify theme persisted');
    const persistedTheme = await page.evaluate(() => {
      const html = document.documentElement;
      return {
        dataTheme: html.getAttribute('data-theme'),
        backgroundColor: window.getComputedStyle(html).backgroundColor
      };
    });
    console.log('🎨 Persisted theme:', persistedTheme);

    // Final verification
    console.log('\n🎉 Test Summary:');
    console.log('  - Initial theme:', currentTheme.dataTheme || 'light');
    console.log('  - After selection:', newTheme.dataTheme || 'unknown');
    console.log('  - After reload:', persistedTheme.dataTheme || 'unknown');

    if (persistedTheme.dataTheme === 'dark') {
      console.log('\n✅ SUCCESS: Theme persisted after page reload!');
    } else {
      console.log('\n❌ FAILURE: Theme did not persist (expected dark, got', persistedTheme.dataTheme, ')');
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    console.error(error);
    await page.screenshot({ path: '/tmp/theme_error.png' });
    console.log('Error screenshot saved: /tmp/theme_error.png');
  } finally {
    console.log('\n🏁 Test completed. Press Ctrl+C to close browser or wait...');
    await wait(5000);
    await browser.close();
  }
}

testThemePersistence().catch(console.error);
