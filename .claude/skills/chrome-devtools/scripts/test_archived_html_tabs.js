import puppeteer from 'puppeteer';

async function testArchivedHTMLTabs() {
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

    await new Promise(resolve => setTimeout(resolve, 3000));

    // Take screenshot of the initial view
    await page.screenshot({
      path: '/tmp/archived_html_with_tabs_collapsed.png',
      fullPage: true
    });
    console.log('Screenshot saved: /tmp/archived_html_with_tabs_collapsed.png');

    // Find and click on the expand icon for the first listing
    console.log('\nExpanding first listing to show tabs...');
    const expanded = await page.evaluate(() => {
      // Find the first expand button (ExpandMoreIcon)
      const expandButtons = Array.from(document.querySelectorAll('button[aria-label], button'))
        .filter(btn => {
          const svg = btn.querySelector('svg');
          return svg && svg.getAttribute('data-testid') === 'ExpandMoreIcon';
        });

      if (expandButtons.length > 0) {
        expandButtons[0].click();
        return true;
      }

      // Alternative: find any button with ExpandMore icon
      const allButtons = Array.from(document.querySelectorAll('button'));
      for (const btn of allButtons) {
        if (btn.innerHTML.includes('ExpandMore')) {
          btn.click();
          return true;
        }
      }

      return false;
    });

    if (expanded) {
      console.log('✓ Expanded first listing');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Take screenshot with tabs expanded
      await page.screenshot({
        path: '/tmp/archived_html_with_tabs_expanded.png',
        fullPage: true
      });
      console.log('Screenshot saved: /tmp/archived_html_with_tabs_expanded.png');

      // Get the list of visible tabs
      const tabs = await page.evaluate(() => {
        const tabElements = Array.from(document.querySelectorAll('[role="button"]'))
          .filter(el => {
            const text = el.textContent || '';
            return text.includes('Tab ') ||
                   text.includes('Demographics') ||
                   text.includes('Tax') ||
                   text.includes('History') ||
                   text.includes('Flood') ||
                   text.includes('Foreclosure') ||
                   text.includes('Open House') ||
                   text.includes('Parcel');
          })
          .map(el => el.textContent?.trim());
        return tabs;
      });

      console.log('\n=== Visible Tabs ===');
      console.log(tabs);

      // Try to click on one of the tab links
      console.log('\nTesting tab click functionality...');
      const tabClicked = await page.evaluate(() => {
        const viewButtons = Array.from(document.querySelectorAll('button'))
          .filter(btn => btn.textContent?.includes('View'));

        // Find a View button that's inside the expanded section
        for (const btn of viewButtons) {
          const parent = btn.closest('ul, div[role="list"]');
          if (parent && parent.style.paddingLeft) {
            console.log('Found tab View button');
            return true;
          }
        }
        return false;
      });

      if (tabClicked) {
        console.log('✓ Found tab View buttons');
      } else {
        console.log('✗ Tab View buttons not found');
      }

    } else {
      console.log('✗ Could not find expand button');
    }

    // Wait to observe
    await new Promise(resolve => setTimeout(resolve, 5000));

  } catch (error) {
    console.error('Error:', error);
    await page.screenshot({ path: '/tmp/error_screenshot.png' });
  } finally {
    await browser.close();
  }
}

testArchivedHTMLTabs().catch(console.error);
