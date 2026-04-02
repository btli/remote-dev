import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function testIngestionRun() {
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

    // Take screenshot of Overview tab
    await page.screenshot({
      path: '/tmp/ingestion_run_page_overview.png',
      fullPage: true
    });
    console.log('Screenshot saved to /tmp/ingestion_run_page_overview.png');

    // Click on "Archived HTML" tab
    console.log('\nClicking on Archived HTML tab...');
    const clicked = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('[role="tab"], button, a'));
      const archivedTab = tabs.find(el => el.textContent?.includes('Archived HTML'));
      if (archivedTab) {
        archivedTab.click();
        return true;
      }
      return false;
    });

    if (clicked) {
      console.log('Clicked Archived HTML tab');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Take screenshot of Archived HTML tab
      await page.screenshot({
        path: '/tmp/ingestion_run_page_archived_html.png',
        fullPage: true
      });
      console.log('Screenshot saved to /tmp/ingestion_run_page_archived_html.png');
    } else {
      console.log('Could not find Archived HTML tab');
    }

    // Extract page content
    const pageData = await page.evaluate(() => {
      // Get run status
      const runStatus = document.querySelector('[data-testid="run-status"]')?.textContent ||
                       document.querySelector('.status')?.textContent ||
                       'Status not found';

      // Get any tables showing listings
      const tables = Array.from(document.querySelectorAll('table')).map(table => {
        const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent?.trim());
        const rows = Array.from(table.querySelectorAll('tbody tr')).slice(0, 20).map(tr => {
          const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent?.trim());
          return cells;
        });
        return { headers, rows };
      });

      // Get all text content that mentions WS25249550
      const bodyText = document.body.textContent || '';
      const hasWS25249550 = bodyText.includes('WS25249550');

      // Get any MLS numbers visible on the page
      const mlsNumbers = [];
      const mlsPattern = /[A-Z]{2}\d{8}/g;
      const matches = bodyText.match(mlsPattern);
      if (matches) {
        mlsNumbers.push(...new Set(matches));
      }

      return {
        runStatus,
        tables,
        hasWS25249550,
        mlsNumbers,
        pageTitle: document.title,
      };
    });

    console.log('\n=== Page Data ===');
    console.log(JSON.stringify(pageData, null, 2));

    // Check for WS25249550 specifically
    if (pageData.hasWS25249550) {
      console.log('\n✓ WS25249550 is mentioned on the page');

      // Try to find the context where it's mentioned
      const context = await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('*'));
        const matches = elements.filter(el =>
          el.textContent?.includes('WS25249550') &&
          !el.querySelector('*')?.textContent?.includes('WS25249550')
        );
        return matches.map(el => ({
          tag: el.tagName,
          text: el.textContent?.substring(0, 200),
          className: el.className,
          id: el.id,
        }));
      });
      console.log('\n=== Context where WS25249550 appears ===');
      console.log(JSON.stringify(context, null, 2));
    } else {
      console.log('\n✗ WS25249550 is NOT mentioned on the page');
    }

    console.log('\n=== MLS Numbers found on page ===');
    console.log(pageData.mlsNumbers);

    // Wait for user to see the browser
    await new Promise(resolve => setTimeout(resolve, 5000));

  } catch (error) {
    console.error('Error:', error);
    await page.screenshot({ path: '/tmp/error_screenshot.png' });
  } finally {
    await browser.close();
  }
}

testIngestionRun().catch(console.error);
