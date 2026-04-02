import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '/Users/bryanli/Projects/joyfulhouse/websites/kaelyn.ai/backend/.env' });

/**
 * CRMLS Ingestion Workflow Test
 *
 * This script traces through the entire CRMLS ingestion process to identify
 * what fields are being extracted (or not extracted) from listing detail pages.
 *
 * Test flow:
 * 1. Authenticate with CRMLS Matrix
 * 2. Perform a search for listings
 * 3. Click into a listing detail page (via ToFull URL)
 * 4. Capture the DisplayITQPopup.aspx page structure
 * 5. Extract all visible fields and compare with expected fields
 * 6. Take screenshots and save HTML for analysis
 */

const SCREENSHOTS_DIR = '/tmp/crmls_ingestion_test';

// Create screenshots directory
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function testCRMLSIngestion() {
  console.log('🚀 Starting CRMLS Ingestion Test...\n');

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

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '01_login_page.png'),
      fullPage: true
    });

    // Check if we need to log in
    const needsLogin = await page.$('input[name="L"]') !== null;

    if (needsLogin) {
      const username = process.env.CRMLS_USERNAME;
      const password = process.env.CRMLS_PASSWORD;

      if (username && password) {
        console.log('   Logging in with credentials from .env...');

        await page.type('input[name="L"]', username);
        await page.type('input[name="P"]', password);

        await page.screenshot({
          path: path.join(SCREENSHOTS_DIR, '01b_credentials_entered.png'),
          fullPage: true
        });

        // Click login button
        await page.click('input[type="submit"], button[type="submit"]');
        await page.waitForNavigation({
          waitUntil: 'networkidle2',
          timeout: 30000
        });

        console.log('   ✅ Logged in successfully');
      } else {
        console.log('⚠️  CRMLS_USERNAME or CRMLS_PASSWORD not found in environment variables.');
        console.log('   Please log in manually within 30 seconds...');

        await page.waitForNavigation({
          waitUntil: 'networkidle2',
          timeout: 30000
        }).catch(() => {
          console.log('⏱️  Timeout waiting for login. Continuing...');
        });
      }
    }

    console.log('✅ Authentication complete\n');

    // ============================================
    // STEP 2: Perform Search
    // ============================================
    console.log('🔍 STEP 2: Performing search for San Marino listings...');

    // Navigate to SpeedBar search
    await page.goto('https://matrix.crmls.org/Matrix/s/LoadFromSpeedbar', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Type search query
    await page.waitForSelector('input[name="sb"]', { timeout: 10000 });
    await page.type('input[name="sb"]', 'resi San Marino');

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '02_search_query.png'),
      fullPage: true
    });

    // Submit search
    await page.keyboard.press('Enter');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '03_search_results.png'),
      fullPage: true
    });

    console.log('✅ Search complete\n');

    // ============================================
    // STEP 3: Extract ToFull URLs from Search Results
    // ============================================
    console.log('📋 STEP 3: Extracting ToFull URLs from search results...');

    const searchResultsHTML = await page.content();
    fs.writeFileSync(
      path.join(SCREENSHOTS_DIR, 'search_results.html'),
      searchResultsHTML
    );

    const toFullLinks = await page.evaluate(() => {
      const links = [];
      const anchors = document.querySelectorAll('a[href*="/Matrix/s/ToFull?recordId="]');

      anchors.forEach(anchor => {
        const href = anchor.getAttribute('href');
        const mlsNumber = anchor.textContent.trim();
        links.push({ href, mlsNumber });
      });

      return links;
    });

    console.log(`   Found ${toFullLinks.length} listings with ToFull URLs`);

    if (toFullLinks.length === 0) {
      console.log('❌ No ToFull links found in search results!');
      console.log('   This might indicate a problem with the search or authentication.');
      await browser.close();
      return;
    }

    // Pick the first listing for detailed analysis
    const firstListing = toFullLinks[0];
    console.log(`   Selected listing: MLS ${firstListing.mlsNumber}`);
    console.log(`   ToFull URL: ${firstListing.href}\n`);

    // ============================================
    // STEP 4: Navigate to Detail Page (ToFull → DisplayITQPopup)
    // ============================================
    console.log('🔗 STEP 4: Navigating to detail page...');

    const toFullUrl = firstListing.href.startsWith('http')
      ? firstListing.href
      : `https://matrix.crmls.org${firstListing.href}`;

    console.log(`   Full URL: ${toFullUrl}`);

    // Monitor redirects
    page.on('response', response => {
      if (response.status() >= 300 && response.status() < 400) {
        console.log(`   ↪️  Redirect: ${response.status()} → ${response.headers()['location']}`);
      }
    });

    await page.goto(toFullUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    const finalUrl = page.url();
    console.log(`   Final URL: ${finalUrl}`);
    console.log(`   Is DisplayITQPopup: ${finalUrl.includes('DisplayITQPopup')}`);

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '04_detail_page.png'),
      fullPage: true
    });

    console.log('✅ Navigation complete\n');

    // ============================================
    // STEP 5: Analyze Page Structure
    // ============================================
    console.log('🔬 STEP 5: Analyzing page structure...');

    const detailPageHTML = await page.content();
    fs.writeFileSync(
      path.join(SCREENSHOTS_DIR, 'detail_page.html'),
      detailPageHTML
    );

    // Extract all fields using multiple strategies
    const extractedFields = await page.evaluate(() => {
      const fields = {};
      const strategies = [];

      // Strategy 1: Data attributes
      const dataFieldElements = document.querySelectorAll('[data-field]');
      if (dataFieldElements.length > 0) {
        strategies.push('data-field attributes');
        dataFieldElements.forEach(el => {
          const fieldName = el.getAttribute('data-field');
          const value = el.textContent.trim();
          if (fieldName && value) {
            fields[fieldName] = value;
          }
        });
      }

      // Strategy 2: Detail tables
      const detailTables = document.querySelectorAll('table.details-table tr, table[class*="detail"] tr');
      if (detailTables.length > 0) {
        strategies.push('detail tables');
        detailTables.forEach(row => {
          const cells = row.querySelectorAll('td, th');
          if (cells.length >= 2) {
            const label = cells[0].textContent.trim().replace(/[:\s]+$/, '');
            const value = cells[1].textContent.trim();
            if (label && value) {
              fields[label] = value;
            }
          }
        });
      }

      // Strategy 3: Definition lists
      const dls = document.querySelectorAll('dl');
      if (dls.length > 0) {
        strategies.push('definition lists');
        dls.forEach(dl => {
          const dts = dl.querySelectorAll('dt');
          const dds = dl.querySelectorAll('dd');
          dts.forEach((dt, idx) => {
            if (dds[idx]) {
              const label = dt.textContent.trim().replace(/[:\s]+$/, '');
              const value = dds[idx].textContent.trim();
              if (label && value) {
                fields[label] = value;
              }
            }
          });
        });
      }

      // Strategy 4: Labeled divs
      const labeledDivs = document.querySelectorAll('[class*="detail"], [class*="field"]');
      if (labeledDivs.length > 0) {
        strategies.push('labeled divs');
        labeledDivs.forEach(container => {
          const label = container.querySelector('.label, [class*="label"]');
          const value = container.querySelector('.value, [class*="value"]');
          if (label && value) {
            const labelText = label.textContent.trim().replace(/[:\s]+$/, '');
            const valueText = value.textContent.trim();
            if (labelText && valueText) {
              fields[labelText] = valueText;
            }
          }
        });
      }

      // Strategy 5: ITQ Popup specific structure
      const itqRows = document.querySelectorAll('.d-mega-row, .row[class*="detail"]');
      if (itqRows.length > 0) {
        strategies.push('ITQ popup rows');
        itqRows.forEach(row => {
          const label = row.querySelector('.col-label, .label, [class*="label"]');
          const value = row.querySelector('.col-value, .value, [class*="value"]');
          if (label && value) {
            const labelText = label.textContent.trim().replace(/[:\s]+$/, '');
            const valueText = value.textContent.trim();
            if (labelText && valueText) {
              fields[labelText] = valueText;
            }
          }
        });
      }

      return {
        fields,
        strategies,
        fieldCount: Object.keys(fields).length
      };
    });

    console.log(`   Extraction strategies used: ${extractedFields.strategies.join(', ')}`);
    console.log(`   Total fields extracted: ${extractedFields.fieldCount}`);

    // Save extracted fields to JSON
    fs.writeFileSync(
      path.join(SCREENSHOTS_DIR, 'extracted_fields.json'),
      JSON.stringify(extractedFields.fields, null, 2)
    );

    console.log('✅ Field extraction complete\n');

    // ============================================
    // STEP 6: Check for Image URLs
    // ============================================
    console.log('🖼️  STEP 6: Checking for image URLs...');

    const imageData = await page.evaluate(() => {
      const images = [];

      // Find PhotoPopup links
      const photoPopupLinks = document.querySelectorAll('a[href*="PhotoPopup.aspx"]');
      const photoPopupUrls = Array.from(photoPopupLinks).map(a => a.href);

      // Find direct image URLs
      const imgElements = document.querySelectorAll('img[src*="GetMedia.ashx"], img[src*="matrixmedia"]');
      const imageUrls = Array.from(imgElements).map(img => ({
        src: img.src,
        alt: img.alt || '',
        width: img.width,
        height: img.height
      }));

      return {
        photoPopupUrls,
        imageUrls,
        photoPopupCount: photoPopupUrls.length,
        imageCount: imageUrls.length
      };
    });

    console.log(`   PhotoPopup links found: ${imageData.photoPopupCount}`);
    console.log(`   Direct image URLs found: ${imageData.imageCount}`);

    if (imageData.photoPopupCount > 0) {
      console.log(`   First PhotoPopup URL: ${imageData.photoPopupUrls[0]}`);
    }

    fs.writeFileSync(
      path.join(SCREENSHOTS_DIR, 'image_data.json'),
      JSON.stringify(imageData, null, 2)
    );

    console.log('✅ Image extraction complete\n');

    // ============================================
    // STEP 7: Compare with Expected Fields
    // ============================================
    console.log('📊 STEP 7: Comparing with expected fields...');

    const expectedFields = [
      'MLS Number', 'ListPrice', 'Address', 'City', 'State', 'ZipCode',
      'Bedrooms', 'Bathrooms', 'SquareFeet', 'LotSize', 'YearBuilt',
      'PropertyType', 'Status', 'ListingDate', 'CloseDate',
      'ArchitecturalStyle', 'RoofType', 'FoundationType', 'ExteriorFinish',
      'CoolingTypes', 'HeatingTypes', 'WaterSource', 'SewerType',
      'Appliances', 'SmartHomeFeatures', 'FlooringTypes',
      'ParkingSpaces', 'CarportSpaces', 'GarageSpaces', 'ParkingFeatures',
      'Pool', 'PoolType', 'PoolFeatures', 'PatioAndPorchFeatures',
      'SchoolDistrict', 'ElementarySchool', 'MiddleSchool', 'HighSchool',
      'AssociationName', 'AssociationFee', 'AssociationAmenities',
      'Zoning', 'ZoningDescription', 'LegalDescription',
      'TaxAssessedValue', 'TaxYear', 'AnnualTaxAmount',
      'Disclosures', 'PropertyCondition', 'KnownDefects'
    ];

    const extractedFieldNames = Object.keys(extractedFields.fields);
    const missingFields = expectedFields.filter(field =>
      !extractedFieldNames.some(extracted =>
        extracted.toLowerCase().includes(field.toLowerCase()) ||
        field.toLowerCase().includes(extracted.toLowerCase())
      )
    );

    console.log(`   Expected fields: ${expectedFields.length}`);
    console.log(`   Extracted fields: ${extractedFieldNames.length}`);
    console.log(`   Missing fields: ${missingFields.length}`);

    if (missingFields.length > 0) {
      console.log('\n   ⚠️  Missing fields:');
      missingFields.forEach(field => console.log(`      - ${field}`));
    }

    // Sample some extracted fields
    console.log('\n   📝 Sample extracted fields:');
    const sampleFields = extractedFieldNames.slice(0, 10);
    sampleFields.forEach(field => {
      const value = extractedFields.fields[field];
      const displayValue = value.length > 50 ? value.substring(0, 47) + '...' : value;
      console.log(`      ${field}: ${displayValue}`);
    });

    console.log('✅ Comparison complete\n');

    // ============================================
    // STEP 8: Generate Report
    // ============================================
    console.log('📄 STEP 8: Generating report...');

    const report = {
      timestamp: new Date().toISOString(),
      mlsNumber: firstListing.mlsNumber,
      toFullUrl,
      finalUrl,
      isDisplayITQPopup: finalUrl.includes('DisplayITQPopup'),
      extraction: {
        strategies: extractedFields.strategies,
        totalFields: extractedFields.fieldCount,
        expectedFields: expectedFields.length,
        missingFields: missingFields.length,
        missingFieldsList: missingFields
      },
      images: {
        photoPopupCount: imageData.photoPopupCount,
        directImageCount: imageData.imageCount
      },
      screenshots: [
        '01_login_page.png',
        '02_search_query.png',
        '03_search_results.png',
        '04_detail_page.png'
      ],
      artifacts: [
        'search_results.html',
        'detail_page.html',
        'extracted_fields.json',
        'image_data.json',
        'test_report.json'
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
    console.log(`MLS Number: ${firstListing.mlsNumber}`);
    console.log(`Final URL: ${finalUrl}`);
    console.log(`Is DisplayITQPopup: ${finalUrl.includes('DisplayITQPopup') ? '✅' : '❌'}`);
    console.log(`\nExtraction:`);
    console.log(`  - Strategies: ${extractedFields.strategies.join(', ')}`);
    console.log(`  - Fields extracted: ${extractedFields.fieldCount}`);
    console.log(`  - Expected fields: ${expectedFields.length}`);
    console.log(`  - Missing fields: ${missingFields.length}`);
    console.log(`\nImages:`);
    console.log(`  - PhotoPopup links: ${imageData.photoPopupCount}`);
    console.log(`  - Direct images: ${imageData.imageCount}`);
    console.log(`\nArtifacts saved to: ${SCREENSHOTS_DIR}`);
    console.log('════════════════════════════════════════════════════════\n');

    // Keep browser open for manual inspection
    console.log('⏸️  Browser will remain open for 60 seconds for manual inspection...');
    await new Promise(resolve => setTimeout(resolve, 60000));

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'error_screenshot.png'),
      fullPage: true
    });
  } finally {
    await browser.close();
    console.log('✅ Test complete. Check screenshots in:', SCREENSHOTS_DIR);
  }
}

testCRMLSIngestion().catch(console.error);
