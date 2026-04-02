import puppeteer from 'puppeteer';

async function testTabsUIRefresh() {
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

    // Check if listing details section exists
    const hasListingDetails = await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll('h6, h5, h4'));
      return headings.some(h => h.textContent?.includes('Listing Detail Pages'));
    });

    console.log('\n=== UI Check ===');
    console.log('Has Listing Detail Pages section:', hasListingDetails);

    if (hasListingDetails) {
      console.log('✓ New UI is loaded!');

      // Count how many listings are shown
      const listingCount = await page.evaluate(() => {
        const heading = Array.from(document.querySelectorAll('h6')).find(h =>
          h.textContent?.includes('Listing Detail Pages')
        );
        if (heading) {
          const match = heading.textContent?.match(/\((\d+)\)/);
          return match ? parseInt(match[1]) : 0;
        }
        return 0;
      });

      console.log(`Found ${listingCount} listings`);

      // Check for expand buttons
      const hasExpandButtons = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.some(btn => {
          const svg = btn.querySelector('svg');
          return svg && (
            svg.innerHTML.includes('ExpandMore') ||
            svg.innerHTML.includes('ExpandLess')
          );
        });
      });

      console.log('Has expand buttons:', hasExpandButtons);

      // Take full page screenshot
      await page.screenshot({
        path: '/tmp/archived_html_new_ui.png',
        fullPage: true
      });
      console.log('\nScreenshot saved: /tmp/archived_html_new_ui.png');

      if (hasExpandButtons) {
        // Try to expand first listing
        console.log('\nExpanding first listing...');
        await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const expandBtn = buttons.find(btn => {
            const svg = btn.querySelector('svg');
            return svg && svg.innerHTML.includes('ExpandMore');
          });
          if (expandBtn) {
            expandBtn.click();
          }
        });

        await new Promise(resolve => setTimeout(resolve, 1000));

        // Take screenshot with expanded tabs
        await page.screenshot({
          path: '/tmp/archived_html_tabs_visible.png',
          fullPage: true
        });
        console.log('Screenshot saved: /tmp/archived_html_tabs_visible.png');

        // Check what tabs are visible
        const visibleTabs = await page.evaluate(() => {
          // Look for tab items in the expanded section
          const items = Array.from(document.querySelectorAll('li'));
          return items
            .filter(li => {
              const text = li.textContent || '';
              return text.match(/Tab (Demographics|Tax|History|Flood|Foreclosure|Open House|Parcel)/i) ||
                     text.includes('Demographics') ||
                     text.includes('Flood Map') ||
                     text.includes('Tax');
            })
            .map(li => li.textContent?.trim().split('\n')[0])
            .filter(Boolean);
        });

        console.log('\n=== Visible Tabs ===');
        console.log(visibleTabs);
      }

    } else {
      console.log('✗ Old UI is still showing');
      console.log('Try hard refreshing the page (Cmd+Shift+R)');

      // Take screenshot
      await page.screenshot({
        path: '/tmp/archived_html_old_ui.png',
        fullPage: true
      });
      console.log('Screenshot saved: /tmp/archived_html_old_ui.png');
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

testTabsUIRefresh().catch(console.error);
