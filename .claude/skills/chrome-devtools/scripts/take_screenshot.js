import puppeteer from 'puppeteer';

async function takeScreenshot() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto('http://localhost:3001/chat/new', { waitUntil: 'networkidle2' });
    await page.screenshot({ path: '/tmp/portal-chat-debug.png', fullPage: true });
    console.log('Screenshot saved to /tmp/portal-chat-debug.png');
  } catch (error) {
    console.error('Error taking screenshot:', error);
  } finally {
    await browser.close();
  }
}

takeScreenshot().catch(console.error);
