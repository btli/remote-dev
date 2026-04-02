import puppeteer from 'puppeteer';

async function testConversation() {
  console.log('Starting conversation test...');
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 }
  });
  const page = await browser.newPage();

  try {
    console.log('1. Navigating to chat page...');
    await page.goto('http://localhost:3001/chat/new', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('textarea', { timeout: 5000 });

    console.log('2. Taking screenshot of initial state...');
    await page.screenshot({ path: '/tmp/portal-chat-01-initial.png', fullPage: false });

    console.log('3. Waiting for textarea to be enabled...');
    await page.waitForFunction(() => {
      const textarea = document.querySelector('textarea');
      return textarea && !textarea.disabled;
    }, { timeout: 10000 });

    console.log('4. Typing message...');
    await page.type('textarea', 'I am looking for a 3 bedroom house');
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('5. Taking screenshot after typing...');
    await page.screenshot({ path: '/tmp/portal-chat-02-typed.png', fullPage: false });

    console.log('6. Pressing Enter to send...');
    await page.keyboard.press('Enter');

    console.log('7. Waiting for AI response...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('8. Taking screenshot after response...');
    await page.screenshot({ path: '/tmp/portal-chat-03-response.png', fullPage: false });

    // Check if response was received
    const messages = await page.evaluate(() => {
      const messageElements = document.querySelectorAll('[role="article"], .message, .chat-message');
      return Array.from(messageElements).map(el => el.textContent?.slice(0, 100));
    });

    console.log('\n✅ Conversation test completed!');
    console.log(`Found ${messages.length} messages in chat`);
    if (messages.length > 0) {
      console.log('Messages:', messages);
    }

    console.log('\nScreenshots saved:');
    console.log('  - /tmp/portal-chat-01-initial.png');
    console.log('  - /tmp/portal-chat-02-typed.png');
    console.log('  - /tmp/portal-chat-03-response.png');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: '/tmp/portal-chat-error.png', fullPage: false });
    console.log('Error screenshot saved to /tmp/portal-chat-error.png');
  } finally {
    await new Promise(resolve => setTimeout(resolve, 2000));
    await browser.close();
  }
}

testConversation().catch(console.error);
