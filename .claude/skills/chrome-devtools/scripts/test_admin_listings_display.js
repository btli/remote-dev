/**
 * Test Admin Listings Display with Chrome DevTools
 *
 * This script:
 * 1. Navigates to the admin listings page
 * 2. Takes screenshots of the page
 * 3. Inspects the table data structure
 * 4. Checks if tab data (tax, photos, etc.) is displayed
 * 5. Identifies what enhancements are needed
 */

import puppeteer from 'puppeteer';
import fs from 'fs';

async function testAdminListingsDisplay() {
  const browser = await puppeteer.launch({
    headless: false, // Show browser so we can see what's happening
    slowMo: 100, // Slow down operations for visibility
    defaultViewport: {
      width: 1920,
      height: 1080
    }
  });

  const page = await browser.newPage();

  try {
    console.log('🌐 Navigating to admin listings page...');
    await page.goto('http://localhost:3002/data/listings', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Wait a bit for dynamic content
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Wait for the page to load
    await page.waitForSelector('body', { timeout: 10000 });

    // Take initial screenshot
    console.log('📸 Taking screenshot of listings page...');
    await page.screenshot({
      path: '/tmp/admin-listings-initial.png',
      fullPage: true
    });

    // Check if we're on the login page
    const isLoginPage = await page.evaluate(() => {
      return document.body.textContent?.includes('Sign in') ||
             document.body.textContent?.includes('Login') ||
             document.querySelector('input[type="email"]') !== null;
    });

    if (isLoginPage) {
      console.log('⚠️  Login required - this is expected for admin pages');
      console.log('   You may need to log in manually first');
      await page.screenshot({ path: '/tmp/admin-login-page.png' });
    }

    // Extract page structure
    console.log('\n📊 Analyzing page structure...');
    const pageInfo = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      const headings = Array.from(document.querySelectorAll('h1, h2, h3'));
      const buttons = Array.from(document.querySelectorAll('button'));

      return {
        title: document.title,
        headings: headings.map(h => h.textContent?.trim()).filter(Boolean),
        tableCount: tables.length,
        tableHeaders: tables.map(table => {
          const headers = Array.from(table.querySelectorAll('th'));
          return headers.map(th => th.textContent?.trim()).filter(Boolean);
        }),
        buttonTexts: buttons.map(b => b.textContent?.trim()).filter(Boolean),
        hasDataGrid: document.querySelector('[role="grid"]') !== null,
        hasPagination: document.querySelector('[aria-label*="pagination"]') !== null,
      };
    });

    console.log('\n📄 Page Information:');
    console.log(`   Title: ${pageInfo.title}`);
    console.log(`   Headings: ${pageInfo.headings.join(', ')}`);
    console.log(`   Tables: ${pageInfo.tableCount}`);
    console.log(`   Has Data Grid: ${pageInfo.hasDataGrid}`);
    console.log(`   Has Pagination: ${pageInfo.hasPagination}`);

    if (pageInfo.tableHeaders.length > 0) {
      console.log('\n📊 Table Headers:');
      pageInfo.tableHeaders.forEach((headers, i) => {
        console.log(`   Table ${i + 1}: ${headers.join(', ')}`);
      });
    }

    // Check for tab data columns
    console.log('\n🔍 Checking for tab data columns...');
    const hasTabColumns = await page.evaluate(() => {
      const allText = document.body.textContent || '';
      const tabKeywords = ['tax', 'photos', 'history', 'parcel', 'flood', 'foreclosure', 'open house', 'neighborhood', 'demographics'];
      const found = tabKeywords.filter(keyword =>
        allText.toLowerCase().includes(keyword.toLowerCase())
      );
      return {
        found,
        hasMultiTabData: allText.includes('multiTabData') || allText.includes('Multi Tab'),
      };
    });

    console.log(`   Tab-related keywords found: ${hasTabColumns.found.join(', ') || 'None'}`);
    console.log(`   Has multiTabData: ${hasTabColumns.hasMultiTabData}`);

    // Check for data rows
    console.log('\n📋 Checking for listing data...');
    const listingData = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr, [role="row"]'));
      const firstFewRows = rows.slice(0, 3).map(row => {
        const cells = Array.from(row.querySelectorAll('td, [role="gridcell"]'));
        return cells.map(cell => cell.textContent?.trim()).filter(Boolean);
      });

      return {
        totalRows: rows.length,
        sampleRows: firstFewRows,
      };
    });

    console.log(`   Total rows: ${listingData.totalRows}`);
    if (listingData.sampleRows.length > 0) {
      console.log('\n   Sample data (first 3 rows):');
      listingData.sampleRows.forEach((row, i) => {
        console.log(`   Row ${i + 1}: ${row.slice(0, 5).join(' | ')}...`);
      });
    } else {
      console.log('   ⚠️  No data rows found');
    }

    // Final screenshot
    await page.screenshot({
      path: '/tmp/admin-listings-analysis-complete.png',
      fullPage: true
    });

    console.log('\n✅ Analysis complete!');
    console.log('\nScreenshots saved:');
    console.log('   /tmp/admin-listings-initial.png');
    console.log('   /tmp/admin-listings-analysis-complete.png');

    // Keep browser open for manual inspection
    console.log('\n👀 Browser will stay open for 30 seconds for manual inspection...');
    await new Promise(resolve => setTimeout(resolve, 30000));

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    await page.screenshot({ path: '/tmp/admin-error.png' });
    console.log('Error screenshot saved to /tmp/admin-error.png');
  } finally {
    await browser.close();
  }
}

testAdminListingsDisplay().catch(console.error);
