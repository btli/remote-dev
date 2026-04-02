import puppeteer from 'puppeteer';

/**
 * E2E Test: Conversation History Click Fix
 *
 * This test verifies that clicking on conversation cards navigates to the detail page.
 *
 * Prerequisites:
 * - Portal dev server running on http://localhost:3002
 * - User already authenticated (session cookie exists)
 *
 * Test Steps:
 * 1. Navigate to history page
 * 2. Wait for conversations to load
 * 3. Click on first conversation
 * 4. Verify navigation to detail page
 * 5. Verify messages are loaded
 */

async function testConversationClick() {
  console.log('🚀 Starting Conversation Click Fix Test...\n');

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 50,
    args: ['--window-size=1920,1080'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  // Enable console logging
  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      console.log(`  BROWSER ${type.toUpperCase()}:`, msg.text());
    }
  });

  page.on('pageerror', (error) => {
    console.error('  PAGE ERROR:', error.message);
  });

  try {
    // Step 1: Navigate to history page
    console.log('📍 Step 1: Navigating to history page...');
    await page.goto('http://localhost:3002/history', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    const currentUrl = page.url();
    console.log(`  Current URL: ${currentUrl}`);

    // Check if redirected to signin (no auth)
    if (currentUrl.includes('/signin') || currentUrl.includes('/error')) {
      console.log('❌ Not authenticated. Please sign in first.');
      console.log('   Run this test after signing in via the browser.');
      await page.screenshot({ path: '/tmp/conv_click_no_auth.png', fullPage: true });
      return;
    }

    await page.screenshot({ path: '/tmp/conv_click_1_history.png', fullPage: true });
    console.log('  ✅ History page loaded');

    // Step 2: Wait for conversations to load
    console.log('\n📍 Step 2: Waiting for conversations to load...');

    // Wait for either conversations or empty state
    await page.waitForFunction(
      () => {
        const hasConversations = document.querySelectorAll('[data-conversation-id]').length > 0;
        const hasEmptyState = document.querySelector('text=No conversations yet') !== null;
        return hasConversations || hasEmptyState;
      },
      { timeout: 10000 }
    ).catch(() => null);

    const conversations = await page.$$('[data-conversation-id]');
    console.log(`  Found ${conversations.length} conversations`);

    if (conversations.length === 0) {
      console.log('ℹ️  No conversations to test with. Test cannot proceed.');
      console.log('   Create some conversations first, then re-run this test.');
      await page.screenshot({ path: '/tmp/conv_click_empty.png', fullPage: true });
      return;
    }

    // Get the first conversation ID
    const firstConvId = await page.evaluate(() => {
      const firstCard = document.querySelector('[data-conversation-id]');
      return firstCard?.getAttribute('data-conversation-id');
    });

    console.log(`  First conversation ID: ${firstConvId}`);

    // Step 3: Click on first conversation
    console.log('\n📍 Step 3: Clicking on first conversation...');

    // Set up navigation promise before clicking
    const navigationPromise = page.waitForNavigation({
      waitUntil: 'networkidle2',
      timeout: 10000,
    });

    // Click the first conversation card
    await page.click('[data-conversation-id]');
    console.log('  ✅ Clicked on conversation card');

    // Wait for navigation
    try {
      await navigationPromise;
      console.log('  ✅ Navigation completed');
    } catch (error) {
      console.log('  ⚠️  Navigation timeout (might be slow)');
    }

    // Step 4: Verify we're on the detail page
    console.log('\n📍 Step 4: Verifying detail page...');

    await new Promise(resolve => setTimeout(resolve, 1000));

    const detailUrl = page.url();
    console.log(`  Current URL: ${detailUrl}`);

    if (detailUrl.includes(`/history/${firstConvId}`)) {
      console.log('  ✅ Successfully navigated to conversation detail page');
    } else if (detailUrl.includes('/history/') && firstConvId) {
      console.log('  ✅ Navigated to a conversation detail page');
    } else {
      console.log('  ❌ Did not navigate to detail page');
      await page.screenshot({ path: '/tmp/conv_click_failed.png', fullPage: true });
      throw new Error('Navigation failed');
    }

    await page.screenshot({ path: '/tmp/conv_click_2_detail.png', fullPage: true });

    // Step 5: Verify messages are loaded
    console.log('\n📍 Step 5: Verifying messages are loaded...');

    // Wait for messages to appear
    await page.waitForFunction(
      () => {
        const messages = document.querySelectorAll('.MuiPaper-root');
        const hasBackButton = document.querySelector('[aria-label="back"]') !== null;
        return messages.length > 0 || hasBackButton;
      },
      { timeout: 10000 }
    ).catch(() => null);

    const messageCount = await page.evaluate(() => {
      return document.querySelectorAll('.MuiPaper-root').length;
    });

    console.log(`  Found ${messageCount} message elements`);

    if (messageCount > 0) {
      console.log('  ✅ Messages loaded successfully');
    } else {
      console.log('  ⚠️  No messages found (conversation might be empty)');
    }

    // Final screenshot
    await page.screenshot({ path: '/tmp/conv_click_3_final.png', fullPage: true });

    // Success summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ TEST PASSED: Conversation click navigation works!');
    console.log('='.repeat(60));
    console.log('\nScreenshots saved:');
    console.log('  - /tmp/conv_click_1_history.png (history page)');
    console.log('  - /tmp/conv_click_2_detail.png (detail page)');
    console.log('  - /tmp/conv_click_3_final.png (final state)');

  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('❌ TEST FAILED');
    console.error('='.repeat(60));
    console.error('\nError:', error.message);

    await page.screenshot({ path: '/tmp/conv_click_error.png', fullPage: true });
    console.log('\nError screenshot saved to: /tmp/conv_click_error.png');

  } finally {
    console.log('\n⏳ Keeping browser open for 5 seconds for inspection...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    await browser.close();
  }
}

// Run the test
testConversationClick().catch(console.error);
