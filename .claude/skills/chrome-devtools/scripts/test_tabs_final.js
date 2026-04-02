import puppeteer from 'puppeteer';

async function testTabsFinal() {
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

    await new Promise(resolve => setTimeout(resolve, 3000));

    // Scroll to Listing Detail Pages section
    console.log('Scrolling to Listing Detail Pages section...');
    await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll('h6, h5, h4'));
      const listingDetailsHeading = headings.find(h => h.textContent?.includes('Listing Detail Pages'));
      if (listingDetailsHeading) {
        listingDetailsHeading.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check first listing
    const firstListing = await page.evaluate(() => {
      const listItems = Array.from(document.querySelectorAll('li'));
      for (const li of listItems) {
        const text = li.textContent || '';
        const mlsMatch = text.match(/([A-Z]{2}\d{8})/);
        if (mlsMatch) {
          return {
            mlsNumber: mlsMatch[1],
            text: text.substring(0, 150),
            hasTabsChip: text.includes('tabs')
          };
        }
      }
      return null;
    });

    console.log('\n=== First Listing ===');
    console.log(firstListing);

    if (firstListing?.hasTabsChip) {
      console.log('✗ Still showing tabs chip - need to wait for reload');
    } else {
      console.log('✓ Tab count chip removed');
    }

    // Take screenshot before expanding
    await page.screenshot({
      path: '/tmp/archived_html_final_collapsed.png',
      fullPage: false
    });
    console.log('Screenshot saved: /tmp/archived_html_final_collapsed.png');

    // Expand first listing
    console.log('\nExpanding first listing...');
    await page.evaluate(() => {
      const listItems = Array.from(document.querySelectorAll('li'));
      for (const li of listItems) {
        const text = li.textContent || '';
        if (text.match(/[A-Z]{2}\d{8}/)) {
          const buttons = Array.from(li.querySelectorAll('button'));
          const expandBtn = buttons.find(btn =>
            btn.innerHTML.includes('ExpandMore')
          );
          if (expandBtn) {
            expandBtn.click();
            return true;
          }
        }
      }
      return false;
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get visible tabs
    const tabs = await page.evaluate(() => {
      const allLists = Array.from(document.querySelectorAll('ul'));
      const nestedList = allLists.find(ul => {
        const style = window.getComputedStyle(ul);
        return style.paddingLeft && parseInt(style.paddingLeft) > 32;
      });

      if (nestedList) {
        const items = Array.from(nestedList.querySelectorAll('li'));
        return items.map(li => {
          const textEl = li.querySelector('[role="button"]');
          if (textEl) {
            const text = textEl.textContent || '';
            const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
            return lines[0];
          }
          return '';
        }).filter(Boolean);
      }
      return [];
    });

    console.log('\n=== Visible Tabs ===');
    console.log(tabs);

    if (tabs.length > 0) {
      const hasTabPrefix = tabs.some(tab => tab.toLowerCase().startsWith('tab '));
      if (hasTabPrefix) {
        console.log('✗ Still showing "Tab" prefix');
      } else {
        console.log('✓ "Tab" prefix removed from all tabs');
      }
    }

    // Take screenshot with tabs expanded
    await page.screenshot({
      path: '/tmp/archived_html_final_expanded.png',
      fullPage: false
    });
    console.log('Screenshot saved: /tmp/archived_html_final_expanded.png');

    // Wait to observe
    await new Promise(resolve => setTimeout(resolve, 5000));

  } catch (error) {
    console.error('Error:', error);
    await page.screenshot({ path: '/tmp/error_screenshot.png' });
  } finally {
    await browser.close();
  }
}

testTabsFinal().catch(console.error);
