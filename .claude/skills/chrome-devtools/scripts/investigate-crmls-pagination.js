/**
 * Investigate CRMLS pagination mechanism
 * Logs in, performs SpeedBar search, and monitors network when clicking Next
 */
import puppeteer from 'puppeteer';
import fs from 'fs/promises';

const CRMLS_USERNAME = 'pf22353';
const CRMLS_PASSWORD = '3gENjjP4XH97?To3';

async function main() {
  console.error('Starting CRMLS pagination investigation...');

  const browser = await puppeteer.launch({
    headless: false, // Show browser for debugging
    defaultViewport: { width: 1920, height: 1080 }
  });

  const page = await browser.newPage();

  // Track all network requests
  const requests = [];
  page.on('request', request => {
    requests.push({
      url: request.url(),
      method: request.method(),
      postData: request.postData(),
      headers: request.headers()
    });
  });

  page.on('response', async response => {
    const url = response.url();
    if (url.includes('GetPageByKey') || url.includes('LoadResults') || url.includes('Speedbar')) {
      console.error(`\n=== RESPONSE: ${url} ===`);
      console.error(`Status: ${response.status()}`);
      const text = await response.text().catch(() => '(binary)');
      console.error(`Body length: ${text.length}`);
      if (text.length < 5000) {
        console.error(`Body preview: ${text.substring(0, 500)}`);
      }
    }
  });

  try {
    // Step 1: Login
    console.error('\n[1/4] Navigating to login page...');
    await page.goto('https://matrix.crmls.org/Matrix/login.aspx', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    console.error('[2/4] Logging in...');
    await page.type('#username', CRMLS_USERNAME);
    await page.type('#password', CRMLS_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

    // Step 2: Perform SpeedBar search
    console.error('[3/4] Performing SpeedBar search: "resi C A U P San Marino"');
    await page.waitForSelector('#SpeedBarText', { timeout: 10000 });
    await page.type('#SpeedBarText', 'resi C A U P San Marino');
    await page.keyboard.press('Enter');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for results to load
    await page.waitForSelector('.D_ListRow, tr[data-mls]', { timeout: 10000 });

    // Check for pagination
    console.error('[4/4] Looking for pagination controls...');
    const paginationHTML = await page.evaluate(() => {
      const pagination = document.querySelector('.pagination, [class*="paginat"]');
      return pagination ? pagination.outerHTML : 'No pagination element found';
    });
    console.error('\nPagination HTML:');
    console.error(paginationHTML);

    // Count results
    const resultCount = await page.evaluate(() => {
      return document.querySelectorAll('.D_ListRow, tr[data-mls]').length;
    });
    console.error(`\nResults on page: ${resultCount}`);

    // Look for Next button
    const nextButtonInfo = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, a')).filter(el => {
        const text = el.textContent.toLowerCase();
        return text.includes('next') || text === '>' || text === '→';
      });

      return buttons.map(btn => ({
        tagName: btn.tagName,
        text: btn.textContent.trim(),
        onclick: btn.getAttribute('onclick'),
        href: btn.getAttribute('href'),
        disabled: btn.disabled || btn.hasAttribute('disabled'),
        className: btn.className
      }));
    });

    console.error('\nNext button(s) found:');
    console.error(JSON.stringify(nextButtonInfo, null, 2));

    // Take screenshot before clicking
    await page.screenshot({ path: '/tmp/crmls-before-next.png', fullPage: true });
    console.error('\nScreenshot saved: /tmp/crmls-before-next.png');

    // Click Next if available
    if (nextButtonInfo.length > 0 && !nextButtonInfo[0].disabled) {
      console.error('\n=== CLICKING NEXT BUTTON ===');

      // Clear previous requests
      const requestsBefore = requests.length;

      // Click the button
      const nextButton = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, a')).filter(el => {
          const text = el.textContent.toLowerCase();
          return text.includes('next') || text === '>' || text === '→';
        });
        if (buttons[0]) {
          buttons[0].click();
          return true;
        }
        return false;
      });

      if (nextButton) {
        // Wait for navigation or AJAX
        await Promise.race([
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {}),
          page.waitForTimeout(3000)
        ]);

        // Get new requests
        const newRequests = requests.slice(requestsBefore);
        console.error('\n=== REQUESTS AFTER CLICKING NEXT ===');
        newRequests.forEach(req => {
          console.error(`\n${req.method} ${req.url}`);
          if (req.postData) {
            console.error(`POST data: ${req.postData}`);
          }
        });

        // Take screenshot after
        await page.screenshot({ path: '/tmp/crmls-after-next.png', fullPage: true });
        console.error('\nScreenshot saved: /tmp/crmls-after-next.png');

        // Check new page
        const newResultCount = await page.evaluate(() => {
          return document.querySelectorAll('.D_ListRow, tr[data-mls]').length;
        });
        console.error(`\nResults on new page: ${newResultCount}`);
      }
    } else {
      console.error('\nNext button is disabled or not found');
    }

    // Save all requests to file
    await fs.writeFile('/tmp/crmls-requests.json', JSON.stringify(requests, null, 2));
    console.error('\nAll requests saved to: /tmp/crmls-requests.json');

    // Keep browser open for manual inspection
    console.error('\n\nBrowser will stay open for 30 seconds for manual inspection...');
    await page.waitForTimeout(30000);

  } catch (error) {
    console.error('\nError:', error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
