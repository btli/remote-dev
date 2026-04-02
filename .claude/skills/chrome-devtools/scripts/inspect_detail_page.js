/**
 * Chrome DevTools Script to Inspect CRMLS Detail Page
 *
 * This script:
 * 1. Authenticates with CRMLS Matrix
 * 2. Performs a search to get a real detail URL
 * 3. Navigates to the detail page
 * 4. Takes comprehensive screenshots
 * 5. Analyzes HTML structure to identify all extractable fields
 */

import 'dotenv/config';
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

// Load credentials from environment
const CRMLS_USERNAME = process.env.CRMLS_USERNAME || 'pf22353';
const CRMLS_PASSWORD = process.env.CRMLS_PASSWORD;

if (!CRMLS_PASSWORD) {
  console.error('❌ CRMLS_PASSWORD environment variable not set');
  process.exit(1);
}

async function inspectDetailPage() {
  console.log('🔍 Starting CRMLS Detail Page Inspection\n');

  const browser = await puppeteer.launch({
    headless: false, // Show browser
    slowMo: 50,
    defaultViewport: {
      width: 1600,
      height: 1200
    }
  });

  const page = await browser.newPage();

  try {
    // Step 1: Authenticate
    console.log('🔐 Step 1: Authenticating with CRMLS...');
    await page.goto('https://auth.crmls.org/');

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', CRMLS_USERNAME);
    await page.type('input[type="password"]', CRMLS_PASSWORD);
    await page.click('button[type="submit"]');

    // Wait for redirect to Matrix
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
    console.log('✅ Authenticated successfully\n');

    // Step 2: Perform search to get a real detail URL
    console.log('🔎 Step 2: Performing search to get detail URLs...');
    await page.goto('https://matrix.crmls.org/Matrix/search/criteria');
    await page.waitForSelector('input', { timeout: 10000 });

    // Search for "Pasadena residential"
    const searchInput = await page.$('input[placeholder*="city" i], input[name*="city" i], input[type="text"]');
    if (searchInput) {
      await searchInput.type('Pasadena');
    }

    // Submit search
    const searchButton = await page.$('button[type="submit"], button:has-text("Search")');
    if (searchButton) {
      await searchButton.click();
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
    }

    console.log('✅ Search results loaded\n');

    // Step 3: Click first listing to get detail page
    console.log('🏠 Step 3: Opening first listing detail page...');

    // Wait for listing results
    await page.waitForSelector('a[href*="DisplayITQPopup"], a[href*="Detail"]', { timeout: 10000 });

    // Get the first detail link
    const detailLink = await page.$eval(
      'a[href*="DisplayITQPopup"], a[href*="Detail"]',
      el => el.href
    );

    console.log(`📍 Detail URL: ${detailLink}\n`);

    // Navigate to detail page
    await page.goto(detailLink, { waitUntil: 'networkidle2' });
    console.log('✅ Detail page loaded\n');

    // Step 4: Take comprehensive screenshots
    console.log('📸 Step 4: Taking screenshots...');

    // Full page screenshot
    await page.screenshot({
      path: '/tmp/crmls-detail-full.png',
      fullPage: true
    });
    console.log('  ✓ Saved full page: /tmp/crmls-detail-full.png');

    // Viewport screenshot (above the fold)
    await page.screenshot({
      path: '/tmp/crmls-detail-viewport.png'
    });
    console.log('  ✓ Saved viewport: /tmp/crmls-detail-viewport.png');

    // Scroll and take screenshots of different sections
    const scrollPositions = [0, 500, 1000, 1500, 2000];
    for (let i = 0; i < scrollPositions.length; i++) {
      await page.evaluate((y) => window.scrollTo(0, y), scrollPositions[i]);
      await page.waitForTimeout(500);
      await page.screenshot({
        path: `/tmp/crmls-detail-section-${i + 1}.png`
      });
      console.log(`  ✓ Saved section ${i + 1}: /tmp/crmls-detail-section-${i + 1}.png`);
    }

    console.log('✅ Screenshots complete\n');

    // Step 5: Analyze HTML structure
    console.log('🔍 Step 5: Analyzing HTML structure...\n');

    const analysis = await page.evaluate(() => {
      // Extract all field labels and values
      const fields = [];

      // Look for label/value pairs
      const labels = document.querySelectorAll('span.label, .label, label, dt, th');
      labels.forEach(label => {
        const labelText = label.textContent?.trim();
        if (labelText) {
          // Find associated value
          let valueElement = label.nextElementSibling;
          if (!valueElement && label.parentElement) {
            valueElement = label.parentElement.nextElementSibling;
          }

          const valueText = valueElement?.textContent?.trim() || '';

          fields.push({
            label: labelText,
            value: valueText.substring(0, 100), // Truncate long values
            labelClass: label.className,
            valueClass: valueElement?.className || '',
          });
        }
      });

      // Get page structure
      return {
        title: document.title,
        url: window.location.href,
        fieldCount: fields.length,
        fields: fields.slice(0, 50), // First 50 fields
        hasPhotosTab: !!document.querySelector('[data-tab="photos"], a:contains("Photos"), button:contains("Photos")'),
        hasTaxTab: !!document.querySelector('[data-tab="tax"], a:contains("Tax"), button:contains("Tax")'),
        hasHistoryTab: !!document.querySelector('[data-tab="history"], a:contains("History"), button:contains("History")'),
        mainContentClass: document.querySelector('.d-mega, .detail-content, main, #content')?.className || 'not-found',
      };
    });

    console.log('📊 HTML Analysis Results:');
    console.log(`  Title: ${analysis.title}`);
    console.log(`  URL: ${analysis.url}`);
    console.log(`  Field count: ${analysis.fieldCount}`);
    console.log(`  Main content class: ${analysis.mainContentClass}`);
    console.log(`  Has Photos tab: ${analysis.hasPhotosTab}`);
    console.log(`  Has Tax tab: ${analysis.hasTaxTab}`);
    console.log(`  Has History tab: ${analysis.hasHistoryTab}\n`);

    console.log('📋 First 50 Fields Found:');
    analysis.fields.forEach((field, i) => {
      console.log(`  ${i + 1}. ${field.label}: ${field.value}`);
    });

    // Save HTML for offline analysis
    const html = await page.content();
    fs.writeFileSync('/tmp/crmls-detail-page.html', html);
    console.log('\n✅ Saved HTML: /tmp/crmls-detail-page.html');

    // Save analysis as JSON
    fs.writeFileSync('/tmp/crmls-detail-analysis.json', JSON.stringify(analysis, null, 2));
    console.log('✅ Saved analysis: /tmp/crmls-detail-analysis.json');

    console.log('\n✨ Inspection complete! Keep browser open for 30 seconds...');
    await page.waitForTimeout(30000);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    await page.screenshot({ path: '/tmp/crmls-error.png' });
    console.log('Error screenshot saved to /tmp/crmls-error.png');
  } finally {
    await browser.close();
  }
}

inspectDetailPage().catch(console.error);
