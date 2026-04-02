import puppeteer from 'puppeteer';

async function testPortalChatFresh() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  try {
    console.log('1. Navigating to chat page...');
    await page.goto('http://localhost:3001/chat/new', { waitUntil: 'networkidle0' });

    console.log('2. Clearing localStorage...');
    await page.evaluate(() => {
      localStorage.clear();
      console.log('localStorage cleared');
    });

    console.log('3. Refreshing page...');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForTimeout(2000);

    console.log('4. Taking screenshot of fresh state...');
    await page.screenshot({ path: '/tmp/portal-chat-02-fresh.png', fullPage: true });

    console.log('5. Checking if input is enabled...');
    const inputDisabled = await page.$eval('textarea', (el) => el.disabled);
    console.log(`Input disabled: ${inputDisabled}`);

    if (!inputDisabled) {
      console.log('6. Input is enabled! Testing conversation...');

      // Type a message
      await page.type('textarea', 'I am looking for a 3 bedroom house');
      await page.waitForTimeout(500);

      // Click send button
      await page.click('button[type="submit"]');

      // Wait for response
      await page.waitForTimeout(3000);

      console.log('7. Taking screenshot after message...');
      await page.screenshot({ path: '/tmp/portal-chat-03-conversation.png', fullPage: true });

      console.log('✅ Chat is working!');
    } else {
      console.log('❌ Input is still disabled after clearing localStorage');

      // Check console for errors
      const logs = [];
      page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));

      await page.waitForTimeout(1000);
      console.log('\nConsole logs:');
      logs.forEach(log => console.log(log));
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: '/tmp/portal-chat-error.png', fullPage: true });
  } finally {
    await page.waitForTimeout(2000);
    await browser.close();
  }
}

testPortalChatFresh().catch(console.error);
