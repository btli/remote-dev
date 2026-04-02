import puppeteer from 'puppeteer';

async function testTabsScroll() {
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

    // Take screenshot showing listing details
    await page.screenshot({
      path: '/tmp/listing_details_section.png',
      fullPage: false
    });
    console.log('Screenshot saved: /tmp/listing_details_section.png');

    // Find the first listing and check if it has expand button
    const firstListingInfo = await page.evaluate(() => {
      // Find all list items
      const listItems = Array.from(document.querySelectorAll('li'));

      // Find first listing with MLS number pattern
      for (const li of listItems) {
        const text = li.textContent || '';
        const mlsMatch = text.match(/([A-Z]{2}\d{8})/);
        if (mlsMatch) {
          const mlsNumber = mlsMatch[1];

          // Check if it has tabs indicator
          const hasTabs = text.includes('tabs');

          // Check if it has expand button
          const hasExpandBtn = li.querySelector('button svg[data-testid*="Expand"]') !== null ||
                                Array.from(li.querySelectorAll('button')).some(btn =>
                                  btn.innerHTML.includes('ExpandMore') || btn.innerHTML.includes('ExpandLess')
                                );

          return {
            mlsNumber,
            hasTabs,
            hasExpandBtn,
            text: text.substring(0, 200)
          };
        }
      }
      return null;
    });

    console.log('\n=== First Listing Info ===');
    console.log(firstListingInfo);

    if (firstListingInfo && firstListingInfo.hasExpandBtn) {
      console.log('\n✓ Found expand button! Clicking it...');

      // Click the expand button
      await page.evaluate(() => {
        const listItems = Array.from(document.querySelectorAll('li'));
        for (const li of listItems) {
          const text = li.textContent || '';
          if (text.match(/[A-Z]{2}\d{8}/)) {
            const buttons = Array.from(li.querySelectorAll('button'));
            const expandBtn = buttons.find(btn =>
              btn.innerHTML.includes('ExpandMore') ||
              btn.querySelector('svg[data-testid="ExpandMoreIcon"]')
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

      // Take screenshot with tabs expanded
      await page.screenshot({
        path: '/tmp/listing_with_tabs_expanded.png',
        fullPage: false
      });
      console.log('Screenshot saved: /tmp/listing_with_tabs_expanded.png');

      // Get list of visible tabs
      const tabs = await page.evaluate(() => {
        // Look for indented/nested list items (tabs are indented)
        const allLists = Array.from(document.querySelectorAll('ul'));
        const nestedList = allLists.find(ul => {
          const style = window.getComputedStyle(ul);
          return style.paddingLeft && parseInt(style.paddingLeft) > 32;
        });

        if (nestedList) {
          const items = Array.from(nestedList.querySelectorAll('li'));
          return items.map(li => {
            const text = li.textContent || '';
            // Extract just the tab name (first line)
            const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
            return lines[0];
          });
        }
        return [];
      });

      console.log('\n=== Visible Tabs ===');
      console.log(tabs);

      if (tabs.length > 0) {
        console.log(`✓ Found ${tabs.length} tabs!`);

        // Try clicking on a tab
        console.log('\nTesting tab View button...');
        const tabClicked = await page.evaluate(() => {
          const allLists = Array.from(document.querySelectorAll('ul'));
          const nestedList = allLists.find(ul => {
            const style = window.getComputedStyle(ul);
            return style.paddingLeft && parseInt(style.paddingLeft) > 32;
          });

          if (nestedList) {
            const viewBtn = nestedList.querySelector('button');
            if (viewBtn && viewBtn.textContent?.includes('View')) {
              console.log('Found tab View button');
              return true;
            }
          }
          return false;
        });

        console.log('Tab View button available:', tabClicked);
      }

    } else {
      console.log('\n✗ No expand button found');
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

testTabsScroll().catch(console.error);
