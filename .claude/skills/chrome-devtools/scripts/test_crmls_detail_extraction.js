import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '/Users/bryanli/Projects/joyfulhouse/websites/kaelyn.ai/backend/.env' });

/**
 * CRMLS Detail Page Field Extraction Test
 *
 * This script directly navigates to a known listing detail page and analyzes
 * what fields are available vs what we're actually extracting.
 *
 * Test URL: https://matrix.crmls.org/Matrix/s/ToFull?recordId=449682651&tableId=50
 * This should redirect to DisplayITQPopup.aspx with all listing details.
 */

const SCREENSHOTS_DIR = '/tmp/crmls_detail_test';
const TEST_LISTING_ID = '449682651';
const TEST_TABLE_ID = '50';

// Create screenshots directory
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function testDetailExtraction() {
  console.log('🚀 Starting CRMLS Detail Page Extraction Test...\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--start-maximized']
  });

  const page = await browser.newPage();

  try {
    // ============================================
    // STEP 1: Authentication
    // ============================================
    console.log('📝 STEP 1: Authenticating with CRMLS Matrix...');

    await page.goto('https://matrix.crmls.org/Matrix/Home', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Check if we need to log in
    const username = process.env.CRMLS_USERNAME;
    const password = process.env.CRMLS_PASSWORD;

    if (!username || !password) {
      throw new Error('CRMLS_USERNAME or CRMLS_PASSWORD not found in environment variables');
    }

    // Check for different login form types
    let usernameField = await page.$('input[name="L"]');
    let passwordField = await page.$('input[name="P"]');

    // Try REcore login form fields
    if (!usernameField) {
      usernameField = await page.$('input[name="Username"], input[type="text"]#Username');
    }
    if (!passwordField) {
      passwordField = await page.$('input[name="Password"], input[type="password"]#Password');
    }

    if (usernameField && passwordField) {
      console.log('   Logging in with credentials from .env...');

      await usernameField.type(username);
      await passwordField.type(password);

      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, '01a_credentials_entered.png'),
        fullPage: true
      });

      // Find and click login button
      const loginButton = await page.evaluateHandle(() => {
        const selectors = ['button[type="submit"]', 'input[type="submit"]'];
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el) return el;
        }
        // Find by text content
        const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
        return buttons.find(btn =>
          btn.textContent.toLowerCase().includes('sign in') ||
          btn.textContent.toLowerCase().includes('log in') ||
          btn.value?.toLowerCase().includes('sign in') ||
          btn.value?.toLowerCase().includes('log in')
        );
      });

      if (loginButton && loginButton.asElement()) {
        await loginButton.asElement().click();
      } else {
        // Try pressing Enter as fallback
        await passwordField.press('Enter');
      }

      console.log('   Waiting for SAML SSO flow to complete...');

      // Wait for SAML flow: signin.crmls.org/saml/sso/login -> auto-submit -> matrix.crmls.org
      await page.waitForFunction(() => {
        return window.location.hostname === 'matrix.crmls.org';
      }, { timeout: 60000 });

      // Wait a bit more for any final redirects
      await new Promise(resolve => setTimeout(resolve, 2000));

      console.log('   ✅ Logged in successfully');
      console.log(`   Current URL: ${page.url()}`);
    } else {
      console.log('   ⚠️  Login form not found. Possibly already logged in.');
    }

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '01_after_login.png'),
      fullPage: true
    });

    // Handle LoginIntermediateMLD if present
    if (page.url().includes('LoginIntermediateMLD')) {
      console.log('   ⚠️  User Identity Conflict page detected');
      console.log('   Clicking "Continue" button...');

      const continueButton = await page.$('#btnContinue');
      if (continueButton) {
        await continueButton.click();
        await page.waitForFunction(() => {
          return !window.location.href.includes('LoginIntermediateMLD');
        }, { timeout: 10000 });

        await page.screenshot({
          path: path.join(SCREENSHOTS_DIR, '01b_after_continue.png'),
          fullPage: true
        });

        console.log(`   ✅ Continue clicked, now at: ${page.url()}`);
      }
    }

    console.log('✅ Authentication complete\n');

    // ============================================
    // STEP 2: Navigate to Detail Page via ToFull
    // ============================================
    console.log('🔗 STEP 2: Navigating to detail page via ToFull...');

    const toFullUrl = `https://matrix.crmls.org/Matrix/s/ToFull?recordId=${TEST_LISTING_ID}&tableId=${TEST_TABLE_ID}`;
    console.log(`   URL: ${toFullUrl}`);

    // Monitor navigation events
    let redirectCount = 0;
    page.on('response', response => {
      if (response.status() >= 300 && response.status() < 400) {
        redirectCount++;
        console.log(`   ↪️  Redirect #${redirectCount}: ${response.status()} → ${response.headers()['location']}`);
      }
    });

    await page.goto(toFullUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    const finalUrl = page.url();
    console.log(`   Final URL: ${finalUrl}`);
    console.log(`   Is DisplayITQPopup: ${finalUrl.includes('DisplayITQPopup')}`);
    console.log(`   Total redirects: ${redirectCount}`);

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '02_detail_page.png'),
      fullPage: true
    });

    console.log('✅ Navigation complete\n');

    // ============================================
    // STEP 3: Save Raw HTML
    // ============================================
    console.log('💾 STEP 3: Saving raw HTML...');

    const rawHTML = await page.content();
    fs.writeFileSync(
      path.join(SCREENSHOTS_DIR, 'detail_page.html'),
      rawHTML
    );

    console.log(`   Saved: detail_page.html (${rawHTML.length} bytes)\n`);

    // ============================================
    // STEP 4: Analyze Page Structure
    // ============================================
    console.log('🔬 STEP 4: Analyzing page structure...');

    const pageStructure = await page.evaluate(() => {
      const structure = {
        title: document.title,
        bodyClasses: document.body.className,
        mainContainersCount: document.querySelectorAll('.container, .content, main, [role="main"]').length,
        tablesCount: document.querySelectorAll('table').length,
        formsCount: document.querySelectorAll('form').length,
        imagesCount: document.querySelectorAll('img').length,
        linksCount: document.querySelectorAll('a').length,
        headings: [],
        containers: []
      };

      // Get all headings
      document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
        structure.headings.push({
          tag: h.tagName,
          text: h.textContent.trim().substring(0, 100)
        });
      });

      // Identify main containers
      const containerSelectors = [
        '.d-mega',
        '.d-mega-row',
        '.itq-container',
        '.detail-container',
        '.listing-detail',
        'table.details',
        'table.itq',
        '[class*="detail"]'
      ];

      containerSelectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          structure.containers.push({
            selector,
            count: elements.length,
            firstElementHTML: elements[0].outerHTML.substring(0, 500)
          });
        }
      });

      return structure;
    });

    console.log('   Page Structure:');
    console.log(`      Title: ${pageStructure.title}`);
    console.log(`      Body classes: ${pageStructure.bodyClasses || 'none'}`);
    console.log(`      Tables: ${pageStructure.tablesCount}`);
    console.log(`      Images: ${pageStructure.imagesCount}`);
    console.log(`      Headings: ${pageStructure.headings.length}`);
    console.log(`      Containers found: ${pageStructure.containers.length}`);

    if (pageStructure.containers.length > 0) {
      console.log('\n   Detected containers:');
      pageStructure.containers.forEach(c => {
        console.log(`      - ${c.selector}: ${c.count} elements`);
      });
    }

    fs.writeFileSync(
      path.join(SCREENSHOTS_DIR, 'page_structure.json'),
      JSON.stringify(pageStructure, null, 2)
    );

    console.log('\n✅ Structure analysis complete\n');

    // ============================================
    // STEP 5: Extract Fields Using Multiple Strategies
    // ============================================
    console.log('📊 STEP 5: Extracting fields using multiple strategies...');

    const extractionResults = await page.evaluate(() => {
      const allFields = {};
      const strategyResults = {};

      // Strategy 1: Data attributes
      strategyResults.dataAttributes = {};
      document.querySelectorAll('[data-field]').forEach(el => {
        const fieldName = el.getAttribute('data-field');
        const value = el.textContent.trim();
        if (fieldName && value) {
          strategyResults.dataAttributes[fieldName] = value;
          allFields[fieldName] = value;
        }
      });

      // Strategy 2: Tables with label-value pairs
      strategyResults.tables = {};
      document.querySelectorAll('table tr').forEach(row => {
        const cells = Array.from(row.querySelectorAll('td, th'));
        if (cells.length >= 2) {
          const label = cells[0].textContent.trim().replace(/[:|\s]+$/, '');
          const value = cells[1].textContent.trim();
          if (label && value && label.length < 100) {
            strategyResults.tables[label] = value;
            allFields[label] = value;
          }
        }
      });

      // Strategy 3: Definition lists
      strategyResults.definitionLists = {};
      document.querySelectorAll('dl').forEach(dl => {
        const dts = dl.querySelectorAll('dt');
        const dds = dl.querySelectorAll('dd');
        dts.forEach((dt, idx) => {
          if (dds[idx]) {
            const label = dt.textContent.trim().replace(/[:|\s]+$/, '');
            const value = dds[idx].textContent.trim();
            if (label && value) {
              strategyResults.definitionLists[label] = value;
              allFields[label] = value;
            }
          }
        });
      });

      // Strategy 4: Divs with .label and .value classes
      strategyResults.labeledDivs = {};
      document.querySelectorAll('[class*="field"], [class*="detail"]').forEach(container => {
        const labelEl = container.querySelector('.label, [class*="label"]');
        const valueEl = container.querySelector('.value, [class*="value"]');
        if (labelEl && valueEl) {
          const label = labelEl.textContent.trim().replace(/[:|\s]+$/, '');
          const value = valueEl.textContent.trim();
          if (label && value) {
            strategyResults.labeledDivs[label] = value;
            allFields[label] = value;
          }
        }
      });

      // Strategy 5: All text content analysis (extract label: value patterns)
      strategyResults.textPatterns = {};
      const bodyText = document.body.innerText;
      const lines = bodyText.split('\n');
      lines.forEach(line => {
        const colonMatch = line.match(/^([^:]+):\s*(.+)$/);
        if (colonMatch) {
          const label = colonMatch[1].trim();
          const value = colonMatch[2].trim();
          if (label.length < 50 && value.length < 500 && value.length > 0) {
            strategyResults.textPatterns[label] = value;
            allFields[label] = value;
          }
        }
      });

      return {
        allFields,
        strategyResults,
        counts: {
          dataAttributes: Object.keys(strategyResults.dataAttributes).length,
          tables: Object.keys(strategyResults.tables).length,
          definitionLists: Object.keys(strategyResults.definitionLists).length,
          labeledDivs: Object.keys(strategyResults.labeledDivs).length,
          textPatterns: Object.keys(strategyResults.textPatterns).length,
          total: Object.keys(allFields).length
        }
      };
    });

    console.log('   Extraction Results:');
    console.log(`      Data attributes: ${extractionResults.counts.dataAttributes} fields`);
    console.log(`      Tables: ${extractionResults.counts.tables} fields`);
    console.log(`      Definition lists: ${extractionResults.counts.definitionLists} fields`);
    console.log(`      Labeled divs: ${extractionResults.counts.labeledDivs} fields`);
    console.log(`      Text patterns: ${extractionResults.counts.textPatterns} fields`);
    console.log(`      Total unique fields: ${extractionResults.counts.total}`);

    fs.writeFileSync(
      path.join(SCREENSHOTS_DIR, 'extraction_results.json'),
      JSON.stringify(extractionResults, null, 2)
    );

    // Show sample fields
    console.log('\n   Sample extracted fields:');
    const allFieldNames = Object.keys(extractionResults.allFields);
    const sampleFields = allFieldNames.slice(0, 15);
    sampleFields.forEach(fieldName => {
      const value = extractionResults.allFields[fieldName];
      const displayValue = value.length > 60 ? value.substring(0, 57) + '...' : value;
      console.log(`      ${fieldName}: ${displayValue}`);
    });

    if (allFieldNames.length > 15) {
      console.log(`      ... and ${allFieldNames.length - 15} more fields`);
    }

    console.log('\n✅ Field extraction complete\n');

    // ============================================
    // STEP 6: Check for Images and PhotoPopup
    // ============================================
    console.log('🖼️  STEP 6: Checking for images...');

    const imageData = await page.evaluate(() => {
      const images = {
        photoPopupLinks: [],
        directImages: [],
        thumbnails: [],
        fullSizeImages: []
      };

      // Find PhotoPopup links
      document.querySelectorAll('a[href*="PhotoPopup.aspx"]').forEach(a => {
        images.photoPopupLinks.push({
          href: a.href,
          text: a.textContent.trim()
        });
      });

      // Find all images
      document.querySelectorAll('img').forEach(img => {
        const imgData = {
          src: img.src,
          alt: img.alt || '',
          width: img.width,
          height: img.height
        };

        images.directImages.push(imgData);

        // Categorize by URL pattern
        if (img.src.includes('GetMedia.ashx')) {
          if (img.src.includes('Size=1') || img.width <= 150) {
            images.thumbnails.push(imgData);
          } else {
            images.fullSizeImages.push(imgData);
          }
        }
      });

      return images;
    });

    console.log(`   PhotoPopup links: ${imageData.photoPopupLinks.length}`);
    console.log(`   Direct images: ${imageData.directImages.length}`);
    console.log(`   Thumbnails: ${imageData.thumbnails.length}`);
    console.log(`   Full-size images: ${imageData.fullSizeImages.length}`);

    if (imageData.photoPopupLinks.length > 0) {
      console.log(`\n   First PhotoPopup URL: ${imageData.photoPopupLinks[0].href}`);
    }

    fs.writeFileSync(
      path.join(SCREENSHOTS_DIR, 'image_data.json'),
      JSON.stringify(imageData, null, 2)
    );

    console.log('\n✅ Image extraction complete\n');

    // ============================================
    // STEP 7: Generate Report
    // ============================================
    console.log('📄 STEP 7: Generating comprehensive report...');

    const report = {
      timestamp: new Date().toISOString(),
      testListingId: TEST_LISTING_ID,
      testTableId: TEST_TABLE_ID,
      navigation: {
        toFullUrl: `https://matrix.crmls.org/Matrix/s/ToFull?recordId=${TEST_LISTING_ID}&tableId=${TEST_TABLE_ID}`,
        finalUrl,
        isDisplayITQPopup: finalUrl.includes('DisplayITQPopup'),
        redirectCount
      },
      pageStructure,
      extraction: {
        totalFields: extractionResults.counts.total,
        byStrategy: extractionResults.counts,
        sampleFields: allFieldNames.slice(0, 20)
      },
      images: {
        photoPopupCount: imageData.photoPopupLinks.length,
        directImageCount: imageData.directImages.length,
        thumbnailCount: imageData.thumbnails.length,
        fullSizeCount: imageData.fullSizeImages.length
      },
      files: {
        html: 'detail_page.html',
        structure: 'page_structure.json',
        extraction: 'extraction_results.json',
        images: 'image_data.json',
        report: 'test_report.json'
      },
      screenshots: [
        '01_after_login.png',
        '02_detail_page.png'
      ]
    };

    fs.writeFileSync(
      path.join(SCREENSHOTS_DIR, 'test_report.json'),
      JSON.stringify(report, null, 2)
    );

    console.log('✅ Report generated\n');

    // ============================================
    // Summary
    // ============================================
    console.log('════════════════════════════════════════════════════════');
    console.log('📊 TEST SUMMARY');
    console.log('════════════════════════════════════════════════════════');
    console.log(`Listing ID: ${TEST_LISTING_ID}`);
    console.log(`Final URL: ${finalUrl}`);
    console.log(`Is DisplayITQPopup: ${finalUrl.includes('DisplayITQPopup') ? '✅ YES' : '❌ NO'}`);
    console.log(`\nPage Structure:`);
    console.log(`  - Containers: ${pageStructure.containers.length} types detected`);
    console.log(`  - Tables: ${pageStructure.tablesCount}`);
    console.log(`  - Images: ${pageStructure.imagesCount}`);
    console.log(`\nField Extraction:`);
    console.log(`  - Total fields: ${extractionResults.counts.total}`);
    console.log(`  - Data attributes: ${extractionResults.counts.dataAttributes}`);
    console.log(`  - Tables: ${extractionResults.counts.tables}`);
    console.log(`  - Definition lists: ${extractionResults.counts.definitionLists}`);
    console.log(`  - Labeled divs: ${extractionResults.counts.labeledDivs}`);
    console.log(`  - Text patterns: ${extractionResults.counts.textPatterns}`);
    console.log(`\nImages:`);
    console.log(`  - PhotoPopup links: ${imageData.photoPopupLinks.length}`);
    console.log(`  - Direct images: ${imageData.directImages.length}`);
    console.log(`  - Thumbnails: ${imageData.thumbnails.length}`);
    console.log(`  - Full-size: ${imageData.fullSizeImages.length}`);
    console.log(`\nAll artifacts saved to: ${SCREENSHOTS_DIR}`);
    console.log('════════════════════════════════════════════════════════\n');

    // Keep browser open for manual inspection
    console.log('⏸️  Browser will remain open for 30 seconds for manual inspection...');
    console.log('   You can manually scroll through the page to see what fields are visible.');
    await new Promise(resolve => setTimeout(resolve, 30000));

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'error_screenshot.png'),
      fullPage: true
    });
    throw error;
  } finally {
    await browser.close();
    console.log('\n✅ Test complete. Check artifacts in:', SCREENSHOTS_DIR);
  }
}

testDetailExtraction().catch(console.error);
