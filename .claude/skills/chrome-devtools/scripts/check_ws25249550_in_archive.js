import puppeteer from 'puppeteer';

async function checkWS25249550() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 }
  });

  const page = await browser.newPage();

  try {
    console.log('Navigating to ingestion run page...');
    await page.goto('http://localhost:3002/ingestion/runs/cmhgq38nf0000sbsnggzlwvjr', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Click on "Archived HTML" tab
    console.log('Clicking on Archived HTML tab...');
    await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('[role="tab"], button, a'));
      const archivedTab = tabs.find(el => el.textContent?.includes('Archived HTML'));
      if (archivedTab) {
        archivedTab.click();
      }
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Search for WS25249550 in the archived listings
    const ws25249550Data = await page.evaluate(() => {
      // Find all list items containing WS25249550
      const allListItems = Array.from(document.querySelectorAll('li, tr, div'));
      const ws25249550Items = allListItems.filter(el =>
        el.textContent?.includes('WS25249550')
      );

      return ws25249550Items.map(el => ({
        tag: el.tagName,
        text: el.textContent?.trim().substring(0, 300),
        innerHTML: el.innerHTML.substring(0, 500),
        className: el.className,
      }));
    });

    console.log('\n=== WS25249550 Entries Found ===');
    console.log(JSON.stringify(ws25249550Data, null, 2));

    // Check if there's a "View" button for WS25249550
    const hasViewButton = await page.evaluate(() => {
      const allElements = Array.from(document.querySelectorAll('*'));
      const ws25249550Elements = allElements.filter(el =>
        el.textContent?.includes('WS25249550') &&
        el.offsetParent !== null // Is visible
      );

      for (const el of ws25249550Elements) {
        // Find parent list item or row
        let parent = el.closest('li, tr');
        if (parent) {
          const viewButton = parent.querySelector('a[href*="WS25249550"], button');
          if (viewButton) {
            return {
              found: true,
              buttonText: viewButton.textContent,
              href: viewButton.getAttribute('href'),
              parentText: parent.textContent?.substring(0, 200),
            };
          }
        }
      }
      return { found: false };
    });

    console.log('\n=== View Button Status ===');
    console.log(JSON.stringify(hasViewButton, null, 2));

    // Scroll to WS25249550 and take screenshot
    await page.evaluate(() => {
      const ws25249550El = Array.from(document.querySelectorAll('*'))
        .find(el => el.textContent?.includes('WS25249550'));
      if (ws25249550El) {
        ws25249550El.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    await page.screenshot({
      path: '/tmp/ws25249550_in_archive.png',
      fullPage: false
    });
    console.log('\nScreenshot saved to /tmp/ws25249550_in_archive.png');

    // Try to click on the WS25249550 view link
    console.log('\n=== Attempting to click WS25249550 view link ===');
    const clicked = await page.evaluate(() => {
      const allElements = Array.from(document.querySelectorAll('*'));
      const ws25249550Elements = allElements.filter(el =>
        el.textContent?.includes('WS25249550') &&
        el.offsetParent !== null
      );

      for (const el of ws25249550Elements) {
        let parent = el.closest('li, tr');
        if (parent) {
          const viewLink = parent.querySelector('a[href*="html-archive"]');
          if (viewLink) {
            const href = viewLink.getAttribute('href');
            console.log('Found view link:', href);
            return href;
          }
        }
      }
      return null;
    });

    if (clicked) {
      console.log('View link URL:', clicked);
    } else {
      console.log('No view link found for WS25249550');
    }

    await new Promise(resolve => setTimeout(resolve, 5000));

  } catch (error) {
    console.error('Error:', error);
    await page.screenshot({ path: '/tmp/error_screenshot.png' });
  } finally {
    await browser.close();
  }
}

checkWS25249550().catch(console.error);
