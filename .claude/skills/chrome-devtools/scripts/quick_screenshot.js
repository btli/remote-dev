import puppeteer from 'puppeteer';

async function screenshot() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 }
  });
  const page = await browser.newPage();

  try {
    console.log('Navigating to chat...');
    await page.goto('http://localhost:3001/chat/new', {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    // Wait a bit for React to hydrate
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('Taking screenshot...');
    await page.screenshot({ path: '/tmp/portal-current.png', fullPage: true });

    console.log('✅ Screenshot saved to /tmp/portal-current.png');

  } catch (error) {
    console.error('Error:', error.message);
    await page.screenshot({ path: '/tmp/portal-error.png', fullPage: true });
  } finally {
    await new Promise(resolve => setTimeout(resolve, 2000));
    await browser.close();
  }
}

screenshot().catch(console.error);
