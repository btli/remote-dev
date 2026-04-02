import puppeteer from 'puppeteer';

async function testCRMLSTabs() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--start-maximized']
  });

  const page = await browser.newPage();

  try {
    console.log('🔐 Logging into CRMLS Matrix...');

    // Step 1: Navigate to login page
    await page.goto('https://auth.crmls.org/auth/Account/Login', {
      waitUntil: 'networkidle2'
    });

    // Step 2: Fill login form
    await page.type('#Username', 'pf22353');
    await page.type('#Password', '3gENjjP4XH97?To3');

    // Step 3: Submit login
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('button[type="submit"]')
    ]);

    console.log('✅ Logged in successfully');

    // Step 4: Navigate to a known listing (San Marino example)
    console.log('🔍 Searching for a San Marino listing...');

    // Use SpeedBar search
    await page.goto('https://matrix.crmls.org/Matrix/Public/Portal.aspx', {
      waitUntil: 'networkidle2'
    });

    // Wait for SpeedBar and search
    await page.waitForSelector('#m_ucSpeedBar_m_tbSpeedBar', { timeout: 10000 });
    await page.type('#m_ucSpeedBar_m_tbSpeedBar', 'resi C A U P San Marino');
    await page.keyboard.press('Enter');

    // Wait for search results
    await page.waitForSelector('.SearchResults, .grid-view, table', { timeout: 15000 });

    console.log('✅ Search results loaded');

    // Take screenshot of search results
    await page.screenshot({ path: '/tmp/crmls-search-results.png', fullPage: true });
    console.log('📸 Saved search results screenshot: /tmp/crmls-search-results.png');

    // Click on first listing detail link
    console.log('🏠 Opening first listing detail page...');

    // Find first ToFull link (detail page)
    const detailLink = await page.$('a[href*="ToFull"]');

    if (!detailLink) {
      console.log('❌ No detail link found. Trying alternative selectors...');

      // Try alternative selectors
      const altLink = await page.$('a[title*="View Details"], a[href*="DisplayITQPopup"]');
      if (altLink) {
        await altLink.click();
      } else {
        throw new Error('Could not find detail link');
      }
    } else {
      await detailLink.click();
    }

    // Wait for detail page to load
    await page.waitForTimeout(3000);

    // Check if we opened in new tab
    const pages = await browser.pages();
    const detailPage = pages[pages.length - 1]; // Get last opened page

    console.log('✅ Detail page opened');

    // Take screenshot of detail page
    await detailPage.screenshot({ path: '/tmp/crmls-detail-page.png', fullPage: true });
    console.log('📸 Saved detail page screenshot: /tmp/crmls-detail-page.png');

    // Step 5: Analyze tab structure
    console.log('\n📋 Analyzing tab structure...\n');

    // Look for tab elements
    const tabs = await detailPage.$$eval('[role="tab"], .tab, .nav-tabs > li, a[data-toggle="tab"]', elements => {
      return elements.map(el => ({
        text: el.textContent?.trim(),
        id: el.id,
        href: el.getAttribute('href'),
        dataToggle: el.getAttribute('data-toggle'),
        onclick: el.getAttribute('onclick'),
        classes: el.className
      }));
    });

    console.log('Found tabs:', JSON.stringify(tabs, null, 2));

    // Look for AJAX event listeners
    console.log('\n🔍 Looking for AJAX handlers...\n');

    // Set up request interception to see AJAX calls
    await detailPage.setRequestInterception(true);

    const ajaxRequests = [];
    detailPage.on('request', request => {
      if (request.resourceType() === 'xhr' || request.resourceType() === 'fetch') {
        ajaxRequests.push({
          url: request.url(),
          method: request.method(),
          headers: request.headers(),
          postData: request.postData()
        });
      }
      request.continue();
    });

    // Try clicking on each tab and observe AJAX calls
    const tabSelectors = [
      'a:has-text("Tax")',
      'a:has-text("Photos")',
      'a:has-text("History")',
      'a:has-text("Parcel Map")',
      'a:has-text("Flood Map")',
      'a:has-text("Foreclosure")',
      'a:has-text("Open House")',
      'a:has-text("Neighborhood")',
      'a:has-text("Demographics")'
    ];

    for (const selector of tabSelectors) {
      try {
        console.log(`\nTrying to click tab: ${selector}`);

        const tabElement = await detailPage.$(selector);
        if (tabElement) {
          const beforeCount = ajaxRequests.length;

          await tabElement.click();
          await detailPage.waitForTimeout(1000); // Wait for AJAX to complete

          const newRequests = ajaxRequests.slice(beforeCount);
          if (newRequests.length > 0) {
            console.log(`  ✅ AJAX calls detected:`);
            newRequests.forEach(req => {
              console.log(`    ${req.method} ${req.url}`);
              if (req.postData) {
                console.log(`    POST data: ${req.postData.substring(0, 200)}`);
              }
            });
          } else {
            console.log(`  ℹ️  No AJAX calls detected (static content)`);
          }

          // Take screenshot after clicking tab
          const tabName = selector.replace(/[^a-zA-Z]/g, '').toLowerCase();
          await detailPage.screenshot({
            path: `/tmp/crmls-tab-${tabName}.png`,
            fullPage: true
          });
          console.log(`  📸 Saved screenshot: /tmp/crmls-tab-${tabName}.png`);
        } else {
          console.log(`  ⚠️  Tab not found: ${selector}`);
        }
      } catch (error) {
        console.log(`  ❌ Error clicking tab: ${error.message}`);
      }
    }

    // Step 6: Extract HTML structure of detail page
    const htmlStructure = await detailPage.evaluate(() => {
      // Find all elements with ID or data attributes that might indicate tabs
      const elements = Array.from(document.querySelectorAll('[id], [data-tab], [data-target]'));

      return elements
        .filter(el => {
          const text = el.textContent?.toLowerCase() || '';
          return text.includes('tax') ||
                 text.includes('photo') ||
                 text.includes('history') ||
                 text.includes('parcel') ||
                 text.includes('flood') ||
                 text.includes('foreclosure') ||
                 text.includes('open house') ||
                 text.includes('neighborhood') ||
                 text.includes('demographic');
        })
        .map(el => ({
          tagName: el.tagName,
          id: el.id,
          className: el.className,
          text: el.textContent?.trim().substring(0, 50),
          onclick: el.getAttribute('onclick'),
          dataTab: el.getAttribute('data-tab'),
          dataTarget: el.getAttribute('data-target')
        }));
    });

    console.log('\n📊 HTML elements related to tabs:');
    console.log(JSON.stringify(htmlStructure, null, 2));

    // Step 7: Save full HTML for analysis
    const html = await detailPage.content();
    const fs = await import('fs');
    await fs.promises.writeFile('/tmp/crmls-detail-page.html', html, 'utf-8');
    console.log('\n💾 Saved full HTML to: /tmp/crmls-detail-page.html');

    console.log('\n✅ Tab analysis complete! Review screenshots and AJAX logs above.');
    console.log('\nScreenshots saved in /tmp/:');
    console.log('  - crmls-search-results.png');
    console.log('  - crmls-detail-page.png');
    console.log('  - crmls-tab-*.png (for each tab)');

  } catch (error) {
    console.error('❌ Error:', error);

    // Take error screenshot
    await page.screenshot({ path: '/tmp/crmls-error.png', fullPage: true });
    console.log('📸 Saved error screenshot: /tmp/crmls-error.png');
  } finally {
    // Keep browser open for manual inspection
    console.log('\n⏸️  Browser will stay open for manual inspection. Press Ctrl+C to close.');
    await new Promise(() => {}); // Keep process alive
  }
}

testCRMLSTabs().catch(console.error);
