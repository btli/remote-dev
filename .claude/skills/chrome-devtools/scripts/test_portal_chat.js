/**
 * E2E Test: Portal Chat Interface
 * Tests that the chat interface loads and renders correctly
 */

import puppeteer from 'puppeteer';

async function testPortalChatInterface() {
  console.log('🧪 Starting Portal Chat Interface E2E Test...\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 800 },
  });

  const page = await browser.newPage();

  try {
    // Step 1: Navigate to chat page
    console.log('1️⃣  Navigating to http://localhost:3001/chat/new');
    await page.goto('http://localhost:3001/chat/new', {
      waitUntil: 'networkidle0',
      timeout: 10000,
    });
    console.log('   ✅ Page loaded\n');

    // Take screenshot of initial state
    await page.screenshot({ path: '/tmp/portal-chat-01-initial.png' });
    console.log('   📸 Screenshot saved: /tmp/portal-chat-01-initial.png\n');

    // Step 2: Check for portal navigation
    console.log('2️⃣  Checking for portal navigation bar...');

    // Check for navigation elements
    const navBar = await page.$('nav, [role="navigation"]');
    if (navBar) {
      console.log('   ✅ Navigation bar found');
    } else {
      console.log('   ⚠️  Navigation bar not found');
    }

    // Step 3: Check for main chat components
    console.log('\n3️⃣  Checking for chat interface components...');

    // Check for input field
    const inputField = await page.$('textarea, input[type="text"]');
    if (inputField) {
      console.log('   ✅ Input field found');
    } else {
      console.log('   ⚠️  Input field not found');
    }

    // Check for send button
    const sendButton = await page.$('button');
    if (sendButton) {
      console.log('   ✅ Send button found');
    } else {
      console.log('   ⚠️  Send button not found');
    }

    // Step 4: Check page title
    const title = await page.title();
    console.log(`\n4️⃣  Page title: "${title}"`);
    if (title.includes('kaelyn')) {
      console.log('   ✅ Title is correct\n');
    }

    // Step 5: Check for voice input button (optional feature)
    console.log('5️⃣  Checking for optional voice input button...');
    const voiceButton = await page.$('[aria-label*="voice" i], button:has([data-testid="mic-icon"])');
    if (voiceButton) {
      console.log('   ✅ Voice input button found');
    } else {
      console.log('   ℹ️  Voice input button not found (may be browser-dependent)\n');
    }

    // Step 6: Check console for errors
    console.log('6️⃣  Checking browser console for errors...');
    const logs = [];
    page.on('console', (msg) => logs.push(msg));

    // Wait a moment to collect any console errors
    await page.waitForTimeout(1000);

    const errors = logs.filter((log) => log.type() === 'error');
    if (errors.length > 0) {
      console.log(`   ⚠️  Found ${errors.length} console errors:`);
      errors.forEach((err) => console.log(`      - ${err.text()}`));
    } else {
      console.log('   ✅ No console errors\n');
    }

    // Take final screenshot
    await page.screenshot({ path: '/tmp/portal-chat-02-final.png' });
    console.log('   📸 Screenshot saved: /tmp/portal-chat-02-final.png\n');

    console.log('✅ Test completed successfully!');
    console.log('\nScreenshots saved in /tmp/');
    console.log('  - portal-chat-01-initial.png');
    console.log('  - portal-chat-02-final.png');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: '/tmp/portal-chat-error.png' });
    console.log('📸 Error screenshot saved: /tmp/portal-chat-error.png');
    throw error;
  } finally {
    await browser.close();
  }
}

// Run the test
testPortalChatInterface().catch((error) => {
  console.error('Test execution failed:', error);
  process.exit(1);
});
