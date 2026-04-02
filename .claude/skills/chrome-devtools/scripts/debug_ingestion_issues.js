import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

async function debugIngestionIssues() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 }
  });
  const page = await browser.newPage();

  // Enable console logging
  page.on('console', msg => {
    console.log('PAGE LOG:', msg.text());
  });

  // Enable network logging
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url().includes('/api/')) {
      console.log('API Request:', request.method(), request.url());
    }
    request.continue();
  });

  page.on('response', async response => {
    if (response.url().includes('/api/')) {
      console.log('API Response:', response.status(), response.url());
      try {
        const body = await response.json();
        console.log('Response body:', JSON.stringify(body, null, 2));
      } catch (e) {
        // Not JSON
      }
    }
  });

  try {
    console.log('Navigating to admin panel...');
    await page.goto('http://localhost:3002', { waitUntil: 'networkidle2' });
    await page.screenshot({ path: '/tmp/admin_home.png', fullPage: true });
    console.log('Screenshot saved: /tmp/admin_home.png');

    // Wait a bit for the page to fully load
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check if there's a navigation menu or links to ingestion history
    console.log('\nLooking for navigation elements...');
    const navLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      return links.map(link => ({
        text: link.textContent.trim(),
        href: link.getAttribute('href')
      }));
    });
    console.log('Navigation links found:', navLinks);

    // Look for ingestion/backend related links
    const ingestionLinks = navLinks.filter(link =>
      link.text.toLowerCase().includes('ingestion') ||
      link.text.toLowerCase().includes('backend') ||
      link.text.toLowerCase().includes('run') ||
      link.text.toLowerCase().includes('history')
    );

    console.log('\nIngestion-related links:', ingestionLinks);

    if (ingestionLinks.length > 0) {
      const targetLink = ingestionLinks[0];
      console.log(`\nNavigating to: ${targetLink.text} (${targetLink.href})`);
      await page.click(`a[href="${targetLink.href}"]`);
      await new Promise(resolve => setTimeout(resolve, 3000));
      await page.screenshot({ path: '/tmp/ingestion_page.png', fullPage: true });
      console.log('Screenshot saved: /tmp/ingestion_page.png');
    }

    // Check for tables or data grids
    console.log('\nLooking for data tables...');
    const tables = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table, [role="table"]'));
      return tables.map((table, idx) => ({
        index: idx,
        rows: table.querySelectorAll('tr, [role="row"]').length,
        headers: Array.from(table.querySelectorAll('th, [role="columnheader"]')).map(th => th.textContent.trim())
      }));
    });
    console.log('Tables found:', JSON.stringify(tables, null, 2));

    // Look for job status indicators
    console.log('\nLooking for job statuses...');
    const jobStatuses = await page.evaluate(() => {
      const statusElements = Array.from(document.querySelectorAll('[class*="status"], [class*="badge"], [class*="chip"]'));
      return statusElements.map(el => ({
        text: el.textContent.trim(),
        class: el.className
      }));
    });
    console.log('Job status elements:', JSON.stringify(jobStatuses, null, 2));

    // Check for RUNNING jobs
    const runningJobs = jobStatuses.filter(status =>
      status.text.toUpperCase().includes('RUNNING')
    );
    console.log(`\nFound ${runningJobs.length} RUNNING jobs`);

    // Check for error indicators
    const errorJobs = jobStatuses.filter(status =>
      status.text.toUpperCase().includes('ERROR') ||
      status.text.toUpperCase().includes('FAILED') ||
      status.text.toUpperCase().includes('PARTIAL')
    );
    console.log(`\nFound ${errorJobs.length} jobs with errors`);

    // Try to navigate to listings page to check parsed properties
    console.log('\nNavigating to listings page...');
    const listingsLinks = navLinks.filter(link =>
      link.text.toLowerCase().includes('listing') ||
      link.text.toLowerCase().includes('property')
    );

    if (listingsLinks.length > 0) {
      const listingsLink = listingsLinks[0];
      console.log(`Navigating to: ${listingsLink.text} (${listingsLink.href})`);
      await page.click(`a[href="${listingsLink.href}"]`);
      await new Promise(resolve => setTimeout(resolve, 3000));
      await page.screenshot({ path: '/tmp/listings_page.png', fullPage: true });
      console.log('Screenshot saved: /tmp/listings_page.png');

      // Check table columns
      const listingsTable = await page.evaluate(() => {
        const table = document.querySelector('table, [role="table"]');
        if (!table) return null;

        const headers = Array.from(table.querySelectorAll('th, [role="columnheader"]')).map(th => th.textContent.trim());
        const firstRow = table.querySelector('tr:nth-child(2), [role="row"]:nth-child(2)');
        const cells = firstRow ? Array.from(firstRow.querySelectorAll('td, [role="cell"]')).map(td => td.textContent.trim()) : [];

        return { headers, firstRow: cells };
      });
      console.log('\nListings table structure:', JSON.stringify(listingsTable, null, 2));
    }

    console.log('\n=== Debug session complete ===');
    console.log('Press Ctrl+C to close browser or wait for timeout...');
    await new Promise(resolve => setTimeout(resolve, 30000)); // Keep browser open for 30 seconds

  } catch (error) {
    console.error('Error during debugging:', error);
    await page.screenshot({ path: '/tmp/error_screenshot.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

debugIngestionIssues().catch(console.error);
