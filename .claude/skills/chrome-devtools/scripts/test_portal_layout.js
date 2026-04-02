import puppeteer from 'puppeteer';

async function testLayout() {
  console.log('Testing portal layout...');

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    console.log('Navigating to chat page...');
    await page.goto('http://localhost:3001/chat/new', { waitUntil: 'networkidle2' });
    
    await page.waitForTimeout(3000);
    
    console.log('Taking screenshot...');
    await page.screenshot({ path: '/tmp/portal_layout.png', fullPage: true });
    
    // Get layout dimensions
    const dimensions = await page.evaluate(() => {
      const chatInterface = document.querySelector('[class*="ChatInterface"]') || document.querySelector('main');
      const inputArea = document.querySelector('textarea');
      
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        chatInterface: chatInterface ? {
          width: chatInterface.offsetWidth,
          height: chatInterface.offsetHeight,
          computedHeight: window.getComputedStyle(chatInterface).height,
        } : null,
        inputArea: inputArea ? {
          width: inputArea.offsetWidth,
          height: inputArea.offsetHeight,
        } : null,
      };
    });
    
    console.log('Layout dimensions:', JSON.stringify(dimensions, null, 2));
    console.log('Screenshot saved to /tmp/portal_layout.png');
    
    // Keep browser open for manual inspection
    console.log('\nBrowser will stay open for 30 seconds for manual inspection...');
    await page.waitForTimeout(30000);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
}

testLayout();
