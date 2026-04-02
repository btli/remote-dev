import puppeteer from 'puppeteer';

async function testMultiTurnConversation() {
  console.log('Starting multi-turn conversation test...');
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 }
  });
  const page = await browser.newPage();

  try {
    console.log('1. Navigating to chat page...');
    await page.goto('http://localhost:3001/chat/new', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('textarea', { timeout: 5000 });

    // Wait for textarea to be enabled
    await page.waitForFunction(() => {
      const textarea = document.querySelector('textarea');
      return textarea && !textarea.disabled;
    }, { timeout: 10000 });

    console.log('2. Sending first message...');
    await page.type('textarea', 'I want a 3 bedroom house');
    await page.keyboard.press('Enter');
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('3. Sending second message...');
    await page.type('textarea', 'In San Francisco');
    await page.keyboard.press('Enter');
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('4. Sending third message...');
    await page.type('textarea', 'Budget is $2 million');
    await page.keyboard.press('Enter');
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('5. Taking final screenshot...');
    await page.screenshot({ path: '/tmp/portal-chat-multi-turn.png', fullPage: true });

    // Count messages
    const messageCount = await page.evaluate(() => {
      // Look for message containers - adjust selector based on actual DOM
      const messages = document.querySelectorAll('[class*="message"], [class*="Message"]');
      return messages.length;
    });

    console.log(`\n✅ Multi-turn conversation test completed!`);
    console.log(`Found ${messageCount} message elements`);
    console.log('Screenshot saved to /tmp/portal-chat-multi-turn.png');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: '/tmp/portal-chat-multi-turn-error.png', fullPage: true });
  } finally {
    await new Promise(resolve => setTimeout(resolve, 2000));
    await browser.close();
  }
}

testMultiTurnConversation().catch(console.error);
