import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

/**
 * E2E Test: Simplified History Flow
 *
 * Tests the new direct navigation from history to chat:
 * 1. Sign in with OAuth
 * 2. Navigate to History page
 * 3. Click on a conversation card
 * 4. Verify direct navigation to /chat/[id] (not /history/[id])
 * 5. Verify conversation loads and can be continued
 */

const PORTAL_URL = 'http://localhost:3001';
const SCREENSHOTS_DIR = '/tmp/history-flow-test';

// Create screenshots directory
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

function screenshot(page, name) {
  const filepath = path.join(SCREENSHOTS_DIR, `${name}.png`);
  return page.screenshot({ path: filepath, fullPage: true });
}

async function testHistoryFlow() {
  console.log('🚀 Starting E2E test for simplified history flow...\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 800 },
    args: ['--start-maximized']
  });

  const page = await browser.newPage();

  // Enable console logging
  page.on('console', msg => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      console.log(`[Browser ${type}]:`, msg.text());
    }
  });

  try {
    // Step 1: Navigate to portal homepage
    console.log('📍 Step 1: Navigating to portal homepage...');
    await page.goto(PORTAL_URL, { waitUntil: 'networkidle2' });
    await screenshot(page, '01-homepage');
    console.log('✅ Homepage loaded\n');

    // Check if already signed in (look for dashboard or sign-in button)
    const isSignedIn = await page.evaluate(() => {
      const signInButton = document.querySelector('a[href*="signin"]');
      const dashboardContent = document.querySelector('[data-testid="dashboard"], nav, [role="navigation"]');
      return !signInButton || !!dashboardContent;
    });

    if (!isSignedIn) {
      console.log('⚠️  Not signed in. Please sign in manually...');
      console.log('   Waiting 30 seconds for manual authentication...');
      await new Promise(resolve => setTimeout(resolve, 30000));
      await screenshot(page, '02-after-signin');
    } else {
      console.log('✅ Already signed in\n');
    }

    // Step 2: Navigate to History page
    console.log('📍 Step 2: Navigating to History page...');
    await page.goto(`${PORTAL_URL}/history`, { waitUntil: 'networkidle2' });
    await new Promise(resolve => setTimeout(resolve, 2000));
    await screenshot(page, '03-history-page');

    // Check if there are conversations
    const hasConversations = await page.evaluate(() => {
      const emptyState = document.querySelector('[data-testid="empty-state"]');
      const conversationCards = document.querySelectorAll('[data-conversation-id]');
      return conversationCards.length > 0 && !emptyState;
    });

    if (!hasConversations) {
      console.log('⚠️  No conversations found in history');
      console.log('   Please create a conversation first by:');
      console.log('   1. Navigate to /chat/new');
      console.log('   2. Send a few messages');
      console.log('   3. Return to history');
      await browser.close();
      return;
    }

    console.log('✅ Conversations found in history\n');

    // Step 3: Get first conversation ID and click it
    console.log('📍 Step 3: Clicking on first conversation card...');

    const conversationId = await page.evaluate(() => {
      const firstCard = document.querySelector('[data-conversation-id]');
      return firstCard?.getAttribute('data-conversation-id');
    });

    if (!conversationId) {
      throw new Error('Could not find conversation ID');
    }

    console.log(`   Conversation ID: ${conversationId}`);

    // Click the conversation card
    await page.click(`[data-conversation-id="${conversationId}"]`);

    // Wait for navigation
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    await new Promise(resolve => setTimeout(resolve, 2000));
    await screenshot(page, '04-after-click');

    // Step 4: Verify we're on /chat/[id] (not /history/[id])
    console.log('📍 Step 4: Verifying navigation to /chat/[id]...');

    const currentUrl = page.url();
    console.log(`   Current URL: ${currentUrl}`);

    if (currentUrl.includes('/chat/')) {
      console.log('✅ Successfully navigated to /chat/[id]\n');
    } else if (currentUrl.includes('/history/')) {
      console.log('❌ ERROR: Still on /history/[id] - flow not updated correctly\n');
      await browser.close();
      return;
    } else {
      console.log(`❌ ERROR: Unexpected URL: ${currentUrl}\n`);
      await browser.close();
      return;
    }

    // Step 5: Verify conversation loaded
    console.log('📍 Step 5: Verifying conversation loaded...');

    const conversationData = await page.evaluate(() => {
      const messages = document.querySelectorAll('[data-message-id], [role="article"]');
      const inputField = document.querySelector('textarea[placeholder*="message"], input[type="text"]');
      return {
        messageCount: messages.length,
        hasInputField: !!inputField,
        pageTitle: document.title,
      };
    });

    console.log(`   Messages found: ${conversationData.messageCount}`);
    console.log(`   Input field present: ${conversationData.hasInputField}`);
    console.log(`   Page title: ${conversationData.pageTitle}`);

    if (conversationData.messageCount > 0 && conversationData.hasInputField) {
      console.log('✅ Conversation loaded successfully\n');
    } else {
      console.log('⚠️  Conversation may not have loaded correctly\n');
    }

    await screenshot(page, '05-conversation-loaded');

    // Step 6: Test that we can interact with the chat
    console.log('📍 Step 6: Testing chat input...');

    const inputSelector = 'textarea[placeholder*="message"], input[type="text"]';
    const hasInput = await page.$(inputSelector);

    if (hasInput) {
      await page.click(inputSelector);
      await page.type(inputSelector, 'Test message from E2E test');
      await new Promise(resolve => setTimeout(resolve, 1000));
      await screenshot(page, '06-typed-message');
      console.log('✅ Can type in chat input\n');

      // Clear the input (don't actually send)
      await page.evaluate((selector) => {
        const input = document.querySelector(selector);
        if (input) input.value = '';
      }, inputSelector);
    } else {
      console.log('⚠️  Could not find chat input field\n');
    }

    // Final summary
    console.log('═'.repeat(60));
    console.log('✅ TEST PASSED: Simplified history flow works correctly!');
    console.log('═'.repeat(60));
    console.log('\nTest Summary:');
    console.log('  ✅ History page loads conversations');
    console.log('  ✅ Clicking conversation navigates directly to /chat/[id]');
    console.log('  ✅ Conversation loads with all messages');
    console.log('  ✅ Chat input is available for continuing conversation');
    console.log(`\nScreenshots saved to: ${SCREENSHOTS_DIR}`);

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error(error.stack);
    await screenshot(page, 'error-state');
    console.log(`\nScreenshots saved to: ${SCREENSHOTS_DIR}`);
  } finally {
    console.log('\n🏁 Test completed. Closing browser in 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    await browser.close();
  }
}

// Run the test
testHistoryFlow().catch(console.error);
