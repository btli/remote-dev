#!/usr/bin/env node
/**
 * Test admin listings pages to diagnose display issues
 */
import puppeteer from 'puppeteer';

async function testListings() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 }
  });

  const page = await browser.newPage();

  try {
    console.log('📋 Testing Listings List Page...');

    // Navigate to listings page
    await page.goto('http://localhost:3002/data/listings', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 2000));

    // Take screenshot of list page
    await page.screenshot({ path: '/tmp/admin-listings-list.png', fullPage: true });
    console.log('✅ Screenshot saved: /tmp/admin-listings-list.png');

    // Check table headers
    const headers = await page.evaluate(() => {
      const headerCells = Array.from(document.querySelectorAll('thead th'));
      return headerCells.map(cell => cell.textContent?.trim());
    });
    console.log('📊 Table headers:', headers);

    // Check first row data
    const firstRow = await page.evaluate(() => {
      const cells = Array.from(document.querySelectorAll('tbody tr:first-child td'));
      return cells.map(cell => cell.textContent?.trim());
    });
    console.log('📄 First row data:', firstRow);

    console.log('\n📝 Testing Listing Detail Page...');

    // Navigate to detail page
    await page.goto('http://localhost:3002/data/listings/cmhh18hlh000qsb6oth72uypj', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 2000));

    // Take screenshot of detail page
    await page.screenshot({ path: '/tmp/admin-listings-detail.png', fullPage: true });
    console.log('✅ Screenshot saved: /tmp/admin-listings-detail.png');

    // Check detail page content
    const detailContent = await page.evaluate(() => {
      const body = document.body.textContent || '';
      return {
        hasPrice: body.includes('Price') || body.includes('$'),
        hasBedrooms: body.includes('Bedroom') || body.includes('Bed'),
        hasBathrooms: body.includes('Bathroom') || body.includes('Bath'),
        hasAddress: body.includes('Address'),
        hasImages: document.querySelectorAll('img').length,
        bodyText: body.substring(0, 500),
      };
    });
    console.log('📋 Detail page content check:', detailContent);

    // Check for error messages
    const errors = await page.evaluate(() => {
      const errorElements = Array.from(document.querySelectorAll('[role="alert"], .error, .MuiAlert-root'));
      return errorElements.map(el => el.textContent);
    });
    if (errors.length > 0) {
      console.log('❌ Errors found:', errors);
    }

    // Check console logs
    page.on('console', msg => console.log('Browser console:', msg.text()));

    console.log('\n✅ Test completed. Check screenshots in /tmp/');

    await new Promise(r => setTimeout(r, 3000));
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
  }
}

testListings().catch(console.error);
