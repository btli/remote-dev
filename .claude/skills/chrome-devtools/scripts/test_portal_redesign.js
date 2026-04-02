import puppeteer from 'puppeteer';

async function testRedesign() {
  console.log('Testing redesigned chat input...');
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 }
  });
  const page = await browser.newPage();

  try {
    console.log('1. Navigating to chat...');
    await page.goto('http://localhost:3001/chat/new', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('textarea', { timeout: 10000 });

    // Wait for textarea to be enabled
    await page.waitForFunction(() => {
      const textarea = document.querySelector('textarea');
      return textarea && !textarea.disabled;
    }, { timeout: 10000 });

    console.log('2. Taking screenshot of empty state...');
    await page.screenshot({ path: '/tmp/portal-redesign-empty.png', fullPage: true });

    console.log('3. Typing a message...');
    await page.type('textarea', 'This is a test message to check the new design');
    await page.screenshot({ path: '/tmp/portal-redesign-typing.png', fullPage: true });

    console.log('4. Sending message...');
    await page.keyboard.press('Enter');
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('5. Taking screenshot after response...');
    await page.screenshot({ path: '/tmp/portal-redesign-with-messages.png', fullPage: true });

    console.log('\n✅ Test completed!');
    console.log('Screenshots saved:');
    console.log('  - /tmp/portal-redesign-empty.png');
    console.log('  - /tmp/portal-redesign-typing.png');
    console.log('  - /tmp/portal-redesign-with-messages.png');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: '/tmp/portal-redesign-error.png', fullPage: true });
  } finally {
    await new Promise(resolve => setTimeout(resolve, 2000));
    await browser.close();
  }
}

testRedesign().catch(console.error);
