import puppeteer from 'puppeteer';

async function testRedesign() {
  console.log('Testing redesigned compact input field...');
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
    await page.screenshot({ path: '/tmp/portal-input-empty.png', fullPage: true });

    console.log('3. Checking input field dimensions...');
    const inputDimensions = await page.evaluate(() => {
      const container = document.querySelector('textarea')?.closest('.MuiBox-root');
      if (!container) return null;

      const rect = container.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        bottom: rect.bottom,
        windowHeight: window.innerHeight
      };
    });
    console.log('Input container dimensions:', inputDimensions);

    console.log('4. Typing a message...');
    await page.type('textarea', 'Testing the new compact design');
    await new Promise(resolve => setTimeout(resolve, 500));
    await page.screenshot({ path: '/tmp/portal-input-typing.png', fullPage: true });

    console.log('5. Checking send button...');
    const sendButton = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const sendBtn = buttons.find(btn => {
        const svg = btn.querySelector('svg');
        return svg && btn.closest('.MuiBox-root');
      });

      if (!sendBtn) return null;

      const styles = window.getComputedStyle(sendBtn);
      return {
        width: styles.width,
        height: styles.height,
        backgroundColor: styles.backgroundColor,
        enabled: !sendBtn.disabled
      };
    });
    console.log('Send button state:', sendButton);

    console.log('6. Sending message...');
    await page.keyboard.press('Enter');
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('7. Taking screenshot after response...');
    await page.screenshot({ path: '/tmp/portal-input-with-messages.png', fullPage: true });

    console.log('\n✅ Test completed!');
    console.log('Screenshots saved:');
    console.log('  - /tmp/portal-input-empty.png');
    console.log('  - /tmp/portal-input-typing.png');
    console.log('  - /tmp/portal-input-with-messages.png');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: '/tmp/portal-input-error.png', fullPage: true });
  } finally {
    await new Promise(resolve => setTimeout(resolve, 2000));
    await browser.close();
  }
}

testRedesign().catch(console.error);
