import puppeteer from 'puppeteer';

async function comprehensiveTest() {
  console.log('Starting comprehensive portal test...');
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 }
  });
  const page = await browser.newPage();

  try {
    // Test 1: Chat auto-scroll and no progress tracking
    console.log('\n=== Test 1: Chat Interface ===');
    console.log('1. Navigating to new chat page...');
    await page.goto('http://localhost:3001/chat/new', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('textarea', { timeout: 5000 });

    // Wait for textarea to be enabled
    await page.waitForFunction(() => {
      const textarea = document.querySelector('textarea');
      return textarea && !textarea.disabled;
    }, { timeout: 10000 });

    // Verify no progress tracking UI visible
    console.log('2. Checking for progress tracking UI (should not exist)...');
    const hasProgressSidebar = await page.evaluate(() => {
      const sidebar = document.querySelector('[class*="sidebar"]');
      const progressBar = document.querySelector('[class*="progress"]');
      return { sidebar: !!sidebar, progressBar: !!progressBar };
    });
    console.log(`   - Progress sidebar found: ${hasProgressSidebar.sidebar}`);
    console.log(`   - Progress bar found: ${hasProgressSidebar.progressBar}`);

    // Send multiple messages to test auto-scroll
    console.log('3. Sending multiple messages to test auto-scroll...');
    await page.type('textarea', 'I am looking for a 3 bedroom house');
    await page.keyboard.press('Enter');
    await new Promise(resolve => setTimeout(resolve, 2000));

    await page.type('textarea', 'In San Francisco');
    await page.keyboard.press('Enter');
    await new Promise(resolve => setTimeout(resolve, 2000));

    await page.type('textarea', 'Budget is $2 million');
    await page.keyboard.press('Enter');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check if scrolled to bottom
    const isAtBottom = await page.evaluate(() => {
      const container = document.querySelector('[class*="overflowY"]');
      if (!container) return false;
      const scrollTop = container.scrollTop;
      const scrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;
      const atBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 50;
      return { scrollTop, scrollHeight, clientHeight, atBottom };
    });
    console.log(`4. Scroll position check:`, isAtBottom);

    await page.screenshot({ path: '/tmp/portal-test-chat.png', fullPage: true });
    console.log('   Screenshot saved to /tmp/portal-test-chat.png');

    // Test 2: Message persistence
    console.log('\n=== Test 2: Message Persistence ===');
    console.log('1. Navigating away from chat...');
    await page.goto('http://localhost:3001/', { waitUntil: 'domcontentloaded' });
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('2. Navigating back to chat...');
    await page.goto('http://localhost:3001/chat/new', { waitUntil: 'domcontentloaded' });
    await new Promise(resolve => setTimeout(resolve, 2000));

    const messagesPersisted = await page.evaluate(() => {
      const messages = document.querySelectorAll('[class*="message"]');
      return messages.length;
    });
    console.log(`3. Found ${messagesPersisted} persisted messages`);

    await page.screenshot({ path: '/tmp/portal-test-persisted.png', fullPage: true });
    console.log('   Screenshot saved to /tmp/portal-test-persisted.png');

    // Test 3: History page API
    console.log('\n=== Test 3: History Page ===');
    console.log('1. Navigating to history page...');
    await page.goto('http://localhost:3001/history', { waitUntil: 'domcontentloaded' });
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check for API errors in console
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    const historyContent = await page.evaluate(() => {
      const body = document.body.textContent;
      const hasNoConversations = body.includes('No conversations yet') || body.includes('no conversations');
      const hasError = body.includes('error') || body.includes('Error') || body.includes('401') || body.includes('Unauthorized');
      return { hasNoConversations, hasError, bodyText: body.substring(0, 200) };
    });

    console.log('2. History page status:');
    console.log(`   - Shows "No conversations": ${historyContent.hasNoConversations}`);
    console.log(`   - Shows error: ${historyContent.hasError}`);
    console.log(`   - Console errors: ${consoleErrors.length}`);

    await page.screenshot({ path: '/tmp/portal-test-history.png', fullPage: true });
    console.log('   Screenshot saved to /tmp/portal-test-history.png');

    // Summary
    console.log('\n=== Test Summary ===');
    console.log(`✅ Chat auto-scroll: ${isAtBottom.atBottom ? 'WORKING' : 'NEEDS FIX'}`);
    console.log(`✅ No progress tracking: ${!hasProgressSidebar.sidebar && !hasProgressSidebar.progressBar ? 'WORKING' : 'NEEDS FIX'}`);
    console.log(`✅ Message persistence: ${messagesPersisted > 0 ? 'WORKING' : 'NEEDS FIX'} (${messagesPersisted} messages)`);
    console.log(`✅ History API: ${!historyContent.hasError ? 'WORKING' : 'NEEDS FIX'}`);

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: '/tmp/portal-test-error.png', fullPage: true });
  } finally {
    await new Promise(resolve => setTimeout(resolve, 2000));
    await browser.close();
  }
}

comprehensiveTest().catch(console.error);
