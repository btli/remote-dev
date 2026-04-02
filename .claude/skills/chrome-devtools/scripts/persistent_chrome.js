import puppeteer from 'puppeteer';

async function launchPersistentChrome() {
  console.log('🚀 Launching persistent Chrome browser...\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  const page = await browser.newPage();

  // Set up console logging
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    console.log(`[Browser Console ${type.toUpperCase()}]:`, text);
  });

  // Set up request interception to log AJAX calls
  await page.setRequestInterception(true);

  page.on('request', request => {
    const resourceType = request.resourceType();
    const url = request.url();

    if (resourceType === 'xhr' || resourceType === 'fetch') {
      console.log(`\n📡 AJAX Request: ${request.method()} ${url}`);

      const postData = request.postData();
      if (postData) {
        console.log(`   POST Data: ${postData.substring(0, 200)}${postData.length > 200 ? '...' : ''}`);
      }
    }

    request.continue();
  });

  page.on('response', async response => {
    const resourceType = response.request().resourceType();
    const url = response.url();

    if (resourceType === 'xhr' || resourceType === 'fetch') {
      console.log(`✅ AJAX Response: ${response.status()} ${url}`);
    }
  });

  // Navigate to a blank page initially
  await page.goto('about:blank');

  console.log('✅ Browser is ready!\n');
  console.log('Instructions:');
  console.log('  1. Navigate to CRMLS and log in manually');
  console.log('  2. Open a listing detail page');
  console.log('  3. Click on the tabs (Tax, Photos, History, etc.)');
  console.log('  4. Watch this console for AJAX requests');
  console.log('  5. Press Ctrl+C when done to close\n');
  console.log('📊 All AJAX requests will be logged here automatically.\n');
  console.log('⏸️  Browser will stay open. Press Ctrl+C to close.\n');

  // Expose helper functions to the browser console
  await page.exposeFunction('saveHTML', async (filename) => {
    const html = await page.content();
    const fs = await import('fs');
    const path = `/tmp/${filename || 'page.html'}`;
    await fs.promises.writeFile(path, html, 'utf-8');
    console.log(`💾 Saved HTML to: ${path}`);
    return path;
  });

  await page.exposeFunction('screenshot', async (filename) => {
    const path = `/tmp/${filename || 'screenshot.png'}`;
    await page.screenshot({ path, fullPage: true });
    console.log(`📸 Saved screenshot to: ${path}`);
    return path;
  });

  await page.exposeFunction('getTabs', async () => {
    const tabs = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('a, button, [role="tab"]'));
      return elements
        .filter(el => {
          const text = (el.textContent || '').toLowerCase();
          return text.includes('tax') || text.includes('photo') ||
                 text.includes('history') || text.includes('parcel') ||
                 text.includes('flood') || text.includes('foreclosure') ||
                 text.includes('open house') || text.includes('neighborhood') ||
                 text.includes('demographic') || text.includes('listing');
        })
        .map(el => ({
          tagName: el.tagName,
          text: (el.textContent || '').trim().substring(0, 50),
          id: el.id,
          className: el.className,
          href: el.getAttribute('href'),
          onclick: el.getAttribute('onclick'),
          dataToggle: el.getAttribute('data-toggle'),
          dataTarget: el.getAttribute('data-target')
        }));
    });
    console.log('\n📋 Found tabs/links:', JSON.stringify(tabs, null, 2));
    return tabs;
  });

  console.log('💡 Helper functions available in browser console:');
  console.log('   - saveHTML("filename.html") - Save current page HTML');
  console.log('   - screenshot("filename.png") - Take screenshot');
  console.log('   - getTabs() - Find all tab elements\n');

  // Keep the browser open indefinitely
  await new Promise(() => {});
}

launchPersistentChrome().catch(console.error);
