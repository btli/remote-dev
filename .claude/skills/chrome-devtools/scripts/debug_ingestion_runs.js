import puppeteer from 'puppeteer';

async function debugIngestionRuns() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 }
  });
  const page = await browser.newPage();

  // Enable console logging
  page.on('console', msg => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      console.log(`[${type.toUpperCase()}]`, msg.text());
    }
  });

  // Enable network logging for API calls
  const apiCalls = [];
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url().includes('/api/')) {
      console.log('→', request.method(), request.url());
    }
    request.continue();
  });

  page.on('response', async response => {
    if (response.url().includes('/api/')) {
      const status = response.status();
      const url = response.url();
      console.log('←', status, url);

      if (url.includes('/api/ingestion/runs')) {
        try {
          const body = await response.json();
          console.log('\n=== API Response: /api/ingestion/runs ===');
          console.log(JSON.stringify(body, null, 2));
          apiCalls.push({ url, status, body });
        } catch (e) {
          // Not JSON
        }
      }
    }
  });

  try {
    console.log('=== Step 1: Navigate to Ingestion Runs page ===');
    await page.goto('http://localhost:3002/ingestion/runs', { waitUntil: 'networkidle2' });
    await new Promise(resolve => setTimeout(resolve, 2000));
    await page.screenshot({ path: '/tmp/ingestion_runs.png', fullPage: true });
    console.log('Screenshot: /tmp/ingestion_runs.png');

    console.log('\n=== Step 2: Analyze page structure ===');
    const pageInfo = await page.evaluate(() => {
      // Find all tables
      const tables = Array.from(document.querySelectorAll('table'));
      const tableInfo = tables.map((table, idx) => {
        const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent?.trim());
        const rows = Array.from(table.querySelectorAll('tbody tr'));
        const rowData = rows.map(row => {
          const cells = Array.from(row.querySelectorAll('td'));
          return cells.map(cell => cell.textContent?.trim());
        });
        return { tableIndex: idx, headers, rowCount: rows.length, sampleRows: rowData.slice(0, 3) };
      });

      // Find status badges/chips
      const statusElements = Array.from(document.querySelectorAll('[class*="Chip"], [class*="Badge"], [class*="status"]'));
      const statuses = statusElements.map(el => ({
        text: el.textContent?.trim(),
        className: el.className
      }));

      return { tableInfo, statuses };
    });

    console.log('\nTables found:', pageInfo.tableInfo.length);
    pageInfo.tableInfo.forEach((table, idx) => {
      console.log(`\nTable ${idx}:`);
      console.log('  Headers:', table.headers);
      console.log('  Rows:', table.rowCount);
      console.log('  Sample data:', table.sampleRows);
    });

    console.log('\nStatus elements:', pageInfo.statuses.length);
    const runningJobs = pageInfo.statuses.filter(s => s.text?.toUpperCase().includes('RUNNING'));
    const errorJobs = pageInfo.statuses.filter(s =>
      s.text?.toUpperCase().includes('ERROR') ||
      s.text?.toUpperCase().includes('FAILED') ||
      s.text?.toUpperCase().includes('PARTIAL')
    );
    console.log(`  RUNNING jobs: ${runningJobs.length}`);
    console.log(`  Error/Failed jobs: ${errorJobs.length}`);

    console.log('\n=== Step 3: Check database directly for job status ===');
    // We'll need to check the database separately

    console.log('\n=== Step 4: Navigate to Listings page ===');
    await page.goto('http://localhost:3002/data/listings', { waitUntil: 'networkidle2' });
    await new Promise(resolve => setTimeout(resolve, 2000));
    await page.screenshot({ path: '/tmp/listings_page.png', fullPage: true });
    console.log('Screenshot: /tmp/listings_page.png');

    const listingsInfo = await page.evaluate(() => {
      const table = document.querySelector('table');
      if (!table) return null;

      const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent?.trim());
      const rows = Array.from(table.querySelectorAll('tbody tr'));
      const firstRow = rows[0];
      const firstRowCells = firstRow ? Array.from(firstRow.querySelectorAll('td')).map(td => {
        const text = td.textContent?.trim();
        return text && text.length > 50 ? text.substring(0, 50) + '...' : text;
      }) : [];

      return {
        headers,
        totalRows: rows.length,
        firstRowSample: firstRowCells
      };
    });

    console.log('\n=== Listings Table ===');
    console.log('Headers:', listingsInfo?.headers);
    console.log('Total rows:', listingsInfo?.totalRows);
    console.log('First row sample:', listingsInfo?.firstRowSample);

    console.log('\n=== Analysis Complete ===');
    console.log('API calls made:', apiCalls.length);
    console.log('\nKeeping browser open for 30 seconds for manual inspection...');
    await new Promise(resolve => setTimeout(resolve, 30000));

  } catch (error) {
    console.error('Error during debugging:', error);
    await page.screenshot({ path: '/tmp/error_screenshot.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

debugIngestionRuns().catch(console.error);
