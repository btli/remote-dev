/**
 * Inspect CRMLS Detail Page Tabs
 *
 * This script:
 * 1. Logs in to CRMLS via Puppeteer
 * 2. Navigates to a listing detail page
 * 3. Finds all available tabs
 * 4. Clicks each tab and captures:
 *    - Screenshot
 *    - HTML content
 *    - Visible data
 *    - Map data (if present)
 * 5. Documents findings for proper tab extraction implementation
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from backend/.env
const envPath = '/Users/bryanli/Projects/joyfulhouse/websites/kaelyn.ai/backend/.env';
console.log(`Loading env from: ${envPath}`);
const result = config({ path: envPath });
console.log(`Loaded ${Object.keys(result.parsed || {}).length} environment variables`);

const SCREENSHOTS_DIR = '/tmp/crmls-tab-inspection';
const OUTPUT_FILE = '/tmp/crmls-tabs-analysis.json';

// Create output directory
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function inspectTabs() {
  console.log('🔍 CRMLS Detail Page Tab Inspector\n');
  console.log('This script will login to CRMLS and inspect all available tabs\n');

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 500,
    args: ['--window-size=1920,1080']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  // Enable console logging from page
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('   [PAGE ERROR]:', msg.text());
    }
  });

  try {
    // Step 1: Login to CRMLS
    console.log('📍 Step 1: Login to CRMLS');
    await page.goto('https://matrix.crmls.org/Matrix/Public/Login.aspx', {
      waitUntil: 'networkidle2'
    });

    // Read credentials from env
    const username = process.env.CRMLS_USERNAME || '';
    const password = process.env.CRMLS_PASSWORD || '';

    if (!username || !password) {
      console.error('❌ Missing CRMLS_USERNAME or CRMLS_PASSWORD');
      console.log('   Set these in backend/.env file');
      process.exit(1);
    }

    // Fill login form
    await page.type('input[name="ctl00$ctl00$Main$Main$UsrCtrlUsername$txtEmail"]', username);
    await page.type('input[name="ctl00$ctl00$Main$Main$txtPassword"]', password);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01-login-form.png'), fullPage: true });

    // Click login button
    await page.click('input[name="ctl00$ctl00$Main$Main$btnLogin"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

    console.log('✅ Logged in successfully\n');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02-logged-in.png'), fullPage: true });

    // Step 2: Navigate to a detail page
    console.log('📍 Step 2: Navigate to a listing detail page');

    // Use SpeedBar to search for a listing
    await page.goto('https://matrix.crmls.org/Matrix/Public/Portal.aspx', {
      waitUntil: 'networkidle2'
    });

    // Wait for SpeedBar and search
    await page.waitForSelector('#divSpeedBarMagnifyingGlass, input[name="QueryText"]', { timeout: 10000 });

    // Type in SpeedBar
    const speedbarInput = await page.$('input[name="QueryText"]');
    if (speedbarInput) {
      await speedbarInput.type('resi San Marino');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    }

    console.log('   Waiting for search results...');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '03-search-results.png'), fullPage: true });

    // Click on first listing to open detail page
    console.log('   Clicking on first listing...');

    // Look for listing links in search results
    const listingLink = await page.$('a[href*="DisplayITQPopup"], a[onclick*="DisplayITQPopup"]');

    if (!listingLink) {
      console.error('❌ Could not find listing link');
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '04-error-no-listing.png'), fullPage: true });
      process.exit(1);
    }

    await listingLink.click();
    await page.waitForTimeout(5000);

    // Switch to popup window if opened
    const pages = await browser.pages();
    const detailPage = pages.length > 1 ? pages[pages.length - 1] : page;

    console.log('✅ Detail page opened\n');
    await detailPage.screenshot({ path: path.join(SCREENSHOTS_DIR, '04-detail-page-main.png'), fullPage: true });

    // Step 3: Find all tabs
    console.log('📍 Step 3: Analyze available tabs\n');

    // Look for tab elements (Matrix uses various tab structures)
    const tabSelectors = [
      '#tabs a', // Standard tab links
      '.tab-link',
      '[role="tab"]',
      'a[href*="#"]', // Anchor links
      'button[onclick*="tab"]',
      'a[onclick*="tab"]',
      '.ui-tabs-anchor', // jQuery UI tabs
    ];

    let tabs = [];
    let tabElements = [];

    // Try each selector
    for (const selector of tabSelectors) {
      const elements = await detailPage.$$(selector);
      if (elements.length > 0) {
        console.log(`   Found ${elements.length} potential tabs with selector: ${selector}`);
        tabElements = elements;
        break;
      }
    }

    // If no tabs found with selectors, look for any clickable elements with "tab" in text
    if (tabElements.length === 0) {
      console.log('   No tabs found with standard selectors, searching for tab-like elements...');

      // Get all clickable elements and check their text
      const allClickable = await detailPage.$$('a, button, span[onclick], div[onclick]');
      console.log(`   Found ${allClickable.length} clickable elements`);

      for (const element of allClickable) {
        const text = await detailPage.evaluate(el => el.textContent?.trim().toLowerCase() || '', element);
        const visible = await detailPage.evaluate(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }, element);

        // Look for tab-like keywords
        const tabKeywords = ['tax', 'photo', 'history', 'map', 'demographic', 'parcel', 'flood', 'school', 'neighborhood'];
        const isTabLike = tabKeywords.some(keyword => text.includes(keyword));

        if (isTabLike && visible && text.length < 50) {
          console.log(`   Potential tab: "${text}"`);
          tabElements.push(element);
        }
      }
    }

    console.log(`\n   ✅ Found ${tabElements.length} potential tabs\n`);

    // Step 4: Click each tab and capture data
    console.log('📍 Step 4: Inspect each tab\n');

    const tabsData = [];

    for (let i = 0; i < Math.min(tabElements.length, 15); i++) {
      const tabElement = tabElements[i];

      try {
        // Get tab name
        const tabName = await detailPage.evaluate(el => {
          return el.textContent?.trim() ||
                 el.getAttribute('aria-label') ||
                 el.getAttribute('title') ||
                 el.getAttribute('id') ||
                 `Tab ${i + 1}`;
        }, tabElement);

        console.log(`\n   📑 Tab ${i + 1}: "${tabName}"`);
        console.log(`   -------------------------------------------`);

        // Scroll into view and click
        await detailPage.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), tabElement);
        await detailPage.waitForTimeout(500);

        await tabElement.click();
        await detailPage.waitForTimeout(2000);

        // Take screenshot
        const screenshotPath = path.join(SCREENSHOTS_DIR, `tab-${i + 1}-${tabName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.png`);
        await detailPage.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`   📸 Screenshot: ${screenshotPath}`);

        // Analyze tab content
        const tabContent = await detailPage.evaluate(() => {
          // Get visible text content
          const getVisibleText = () => {
            const walker = document.createTreeWalker(
              document.body,
              NodeFilter.SHOW_TEXT,
              {
                acceptNode: (node) => {
                  const parent = node.parentElement;
                  if (!parent) return NodeFilter.FILTER_REJECT;

                  const style = window.getComputedStyle(parent);
                  if (style.display === 'none' || style.visibility === 'hidden') {
                    return NodeFilter.FILTER_REJECT;
                  }

                  const rect = parent.getBoundingClientRect();
                  if (rect.width === 0 || rect.height === 0) {
                    return NodeFilter.FILTER_REJECT;
                  }

                  return NodeFilter.FILTER_ACCEPT;
                }
              }
            );

            const texts = [];
            let node;
            while (node = walker.nextNode()) {
              const text = node.textContent?.trim();
              if (text && text.length > 2) {
                texts.push(text);
              }
            }
            return texts;
          };

          // Check for maps
          const maps = [];
          document.querySelectorAll('iframe, img[src*="map"], canvas, div[id*="map"], div[class*="map"]').forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.width > 100 && rect.height > 100) {
              maps.push({
                type: el.tagName,
                id: el.id,
                className: el.className,
                src: el.src || el.getAttribute('data-src'),
                width: rect.width,
                height: rect.height
              });
            }
          });

          // Check for tables
          const tables = [];
          document.querySelectorAll('table').forEach(table => {
            const rows = table.querySelectorAll('tr');
            if (rows.length > 0) {
              const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent?.trim());
              tables.push({
                rowCount: rows.length,
                columnCount: table.querySelectorAll('td, th').length / rows.length,
                headers: headers
              });
            }
          });

          // Get key-value pairs (common in property details)
          const keyValuePairs = {};
          document.querySelectorAll('.label, .field-label, dt').forEach(label => {
            const key = label.textContent?.trim();
            const valueElement = label.nextElementSibling || label.parentElement?.nextElementSibling;
            const value = valueElement?.textContent?.trim();

            if (key && value && key.length < 100) {
              keyValuePairs[key] = value;
            }
          });

          return {
            visibleText: getVisibleText().slice(0, 50), // First 50 text nodes
            hasMaps: maps.length > 0,
            maps: maps,
            tableCount: tables.length,
            tables: tables,
            keyValuePairs: keyValuePairs,
            htmlLength: document.body.innerHTML.length
          };
        });

        console.log(`   📊 Content Analysis:`);
        console.log(`      - Has maps: ${tabContent.hasMaps ? 'YES (' + tabContent.maps.length + ' found)' : 'NO'}`);
        console.log(`      - Tables: ${tabContent.tableCount}`);
        console.log(`      - Key-value pairs: ${Object.keys(tabContent.keyValuePairs).length}`);
        console.log(`      - HTML size: ${(tabContent.htmlLength / 1024).toFixed(1)} KB`);

        if (tabContent.hasMaps) {
          console.log(`\n   🗺️  Map Details:`);
          tabContent.maps.forEach((map, idx) => {
            console.log(`      Map ${idx + 1}:`);
            console.log(`        Type: ${map.type}`);
            console.log(`        ID: ${map.id || 'none'}`);
            console.log(`        Class: ${map.className || 'none'}`);
            console.log(`        Src: ${map.src ? map.src.substring(0, 100) + '...' : 'none'}`);
            console.log(`        Size: ${map.width}x${map.height}`);
          });
        }

        if (Object.keys(tabContent.keyValuePairs).length > 0) {
          console.log(`\n   🔑 Sample Key-Value Pairs:`);
          const sampleKeys = Object.keys(tabContent.keyValuePairs).slice(0, 5);
          sampleKeys.forEach(key => {
            console.log(`      ${key}: ${tabContent.keyValuePairs[key].substring(0, 50)}...`);
          });
        }

        // Save tab data
        tabsData.push({
          index: i + 1,
          name: tabName,
          screenshotPath,
          content: tabContent,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.log(`   ❌ Error inspecting tab ${i + 1}: ${error.message}`);
      }
    }

    // Step 5: Save analysis results
    console.log('\n\n📍 Step 5: Save analysis results\n');

    const analysis = {
      inspectionDate: new Date().toISOString(),
      totalTabsFound: tabElements.length,
      tabsInspected: tabsData.length,
      tabs: tabsData.map(tab => ({
        name: tab.name,
        hasMaps: tab.content.hasMaps,
        mapCount: tab.content.maps?.length || 0,
        tableCount: tab.content.tableCount,
        keyValuePairCount: Object.keys(tab.content.keyValuePairs).length,
        screenshotPath: tab.screenshotPath
      })),
      recommendations: {
        tabsToExtract: [],
        mapDataNeeded: [],
        additionalFields: []
      }
    };

    // Analyze and provide recommendations
    tabsData.forEach(tab => {
      const name = tab.name.toLowerCase();

      // Skip photos tab as user requested
      if (name.includes('photo')) {
        analysis.recommendations.tabsToExtract.push({
          tab: tab.name,
          action: 'SKIP',
          reason: 'User requested to skip photos tab (already handled in main extraction)'
        });
      }
      // Important tabs to extract
      else if (name.includes('tax') || name.includes('history') || name.includes('demographic') ||
               name.includes('parcel') || name.includes('flood') || name.includes('school') ||
               name.includes('neighborhood')) {
        analysis.recommendations.tabsToExtract.push({
          tab: tab.name,
          action: 'EXTRACT',
          priority: 'HIGH',
          hasMaps: tab.content.hasMaps,
          hasTabularData: tab.content.tableCount > 0,
          hasKeyValueData: Object.keys(tab.content.keyValuePairs).length > 0
        });
      }

      // Track tabs with maps
      if (tab.content.hasMaps) {
        analysis.recommendations.mapDataNeeded.push({
          tab: tab.name,
          mapCount: tab.content.maps.length,
          maps: tab.content.maps.map(m => ({
            type: m.type,
            src: m.src
          }))
        });
      }
    });

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(analysis, null, 2));
    console.log(`✅ Analysis saved to: ${OUTPUT_FILE}\n`);

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('📋 INSPECTION SUMMARY');
    console.log('='.repeat(80) + '\n');

    console.log(`Total tabs found: ${analysis.totalTabsFound}`);
    console.log(`Tabs inspected: ${analysis.tabsInspected}\n`);

    console.log('Tabs with Maps:');
    analysis.recommendations.mapDataNeeded.forEach(rec => {
      console.log(`  - ${rec.tab}: ${rec.mapCount} map(s)`);
    });

    console.log('\nRecommended Tabs to Extract:');
    analysis.recommendations.tabsToExtract.forEach(rec => {
      if (rec.action === 'EXTRACT') {
        console.log(`  ✅ ${rec.tab} (Priority: ${rec.priority})`);
        if (rec.hasMaps) console.log(`     🗺️  Has maps`);
        if (rec.hasTabularData) console.log(`     📊 Has tables`);
        if (rec.hasKeyValueData) console.log(`     🔑 Has key-value data`);
      } else if (rec.action === 'SKIP') {
        console.log(`  ⏭️  ${rec.tab} - ${rec.reason}`);
      }
    });

    console.log(`\n📸 Screenshots saved to: ${SCREENSHOTS_DIR}`);
    console.log('='.repeat(80) + '\n');

  } catch (error) {
    console.error('\n❌ Error during inspection:', error);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'error.png'), fullPage: true });
    throw error;
  } finally {
    console.log('\n⏳ Keeping browser open for 30 seconds for manual inspection...');
    await new Promise(resolve => setTimeout(resolve, 30000));
    await browser.close();
  }
}

// Run inspection
inspectTabs().catch(error => {
  console.error('Inspection failed:', error);
  process.exit(1);
});
