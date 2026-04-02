import puppeteer from 'puppeteer';

const listingId = 'cmhe2roji0056sb0daqtqce24';
const adminUrl = 'http://localhost:3002';

async function testListingDetailFields() {
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 100
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  try {
    console.log('\n🚀 Starting E2E test for listing detail fields...\n');

    // Navigate to listing detail page
    console.log(`📍 Navigating to listing detail page for ${listingId}...`);
    await page.goto(`${adminUrl}/data/listings/${listingId}`, {
      waitUntil: 'networkidle2'
    });

    // Wait for the page to load
    await page.waitForSelector('h4', { timeout: 10000 });
    console.log('✅ Page loaded successfully\n');

    // Take screenshot of the top of the page
    await page.screenshot({
      path: '/tmp/listing_detail_top.png',
      fullPage: false
    });
    console.log('📸 Screenshot saved: /tmp/listing_detail_top.png');

    // Check for MLS System Fields accordion
    console.log('\n🔍 Looking for "MLS System Fields" accordion...');
    const mlsAccordionFound = await page.evaluate(() => {
      const accordions = Array.from(document.querySelectorAll('h6'));
      return accordions.some(h6 => h6.textContent.includes('MLS System Fields'));
    });

    if (mlsAccordionFound) {
      console.log('✅ "MLS System Fields" accordion found!');

      // Click to expand the MLS System Fields accordion
      console.log('   Expanding accordion...');
      await page.evaluate(() => {
        const accordions = Array.from(document.querySelectorAll('h6'));
        const mlsAccordion = accordions.find(h6 => h6.textContent.includes('MLS System Fields'));
        if (mlsAccordion) {
          mlsAccordion.closest('div[role="button"]').click();
        }
      });

      await page.waitForTimeout(500);

      // Scroll to MLS System Fields section
      await page.evaluate(() => {
        const accordions = Array.from(document.querySelectorAll('h6'));
        const mlsAccordion = accordions.find(h6 => h6.textContent.includes('MLS System Fields'));
        if (mlsAccordion) {
          mlsAccordion.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });

      await page.waitForTimeout(1000);

      // Take screenshot of MLS System Fields
      await page.screenshot({
        path: '/tmp/mls_system_fields.png',
        fullPage: false
      });
      console.log('📸 Screenshot saved: /tmp/mls_system_fields.png');

      // Count visible fields in MLS System Fields section
      const mlsFieldCount = await page.evaluate(() => {
        const accordions = Array.from(document.querySelectorAll('h6'));
        const mlsAccordion = accordions.find(h6 => h6.textContent.includes('MLS System Fields'));
        if (!mlsAccordion) return 0;

        const accordionContent = mlsAccordion.closest('[role="button"]').nextElementSibling;
        if (!accordionContent) return 0;

        const gridItems = accordionContent.querySelectorAll('[class*="MuiGrid-root"]');
        return gridItems.length;
      });

      console.log(`   Found ${mlsFieldCount} grid items in MLS System Fields section`);

    } else {
      console.log('❌ "MLS System Fields" accordion NOT found!');
    }

    // Check for Construction & Systems accordion (Feature 015 fields)
    console.log('\n🔍 Looking for "Construction & Systems" accordion...');
    const constructionAccordionFound = await page.evaluate(() => {
      const accordions = Array.from(document.querySelectorAll('h6'));
      return accordions.some(h6 => h6.textContent.includes('Construction & Systems'));
    });

    if (constructionAccordionFound) {
      console.log('✅ "Construction & Systems" accordion found!');

      // Click to expand the Construction & Systems accordion
      console.log('   Expanding accordion...');
      await page.evaluate(() => {
        const accordions = Array.from(document.querySelectorAll('h6'));
        const constructionAccordion = accordions.find(h6 => h6.textContent.includes('Construction & Systems'));
        if (constructionAccordion) {
          constructionAccordion.closest('div[role="button"]').click();
        }
      });

      await page.waitForTimeout(500);

      // Scroll to Construction & Systems section
      await page.evaluate(() => {
        const accordions = Array.from(document.querySelectorAll('h6'));
        const constructionAccordion = accordions.find(h6 => h6.textContent.includes('Construction & Systems'));
        if (constructionAccordion) {
          constructionAccordion.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });

      await page.waitForTimeout(1000);

      // Take screenshot
      await page.screenshot({
        path: '/tmp/construction_systems.png',
        fullPage: false
      });
      console.log('📸 Screenshot saved: /tmp/construction_systems.png');

    } else {
      console.log('❌ "Construction & Systems" accordion NOT found!');
    }

    // List all accordion sections
    console.log('\n📋 All accordion sections found:');
    const allSections = await page.evaluate(() => {
      const accordions = Array.from(document.querySelectorAll('h6'));
      return accordions.map(h6 => h6.textContent.trim());
    });

    allSections.forEach((section, index) => {
      console.log(`   ${index + 1}. ${section}`);
    });

    // Check for specific MLS fields by querying the API response
    console.log('\n🔍 Checking API response for specific MLS fields...');
    const apiResponse = await page.evaluate(async (url) => {
      const response = await fetch(url);
      return await response.json();
    }, `${adminUrl}/api/data/listings/${listingId}`);

    const mlsFields = [
      'listingOfficeCode',
      'saleLeaseClassification',
      'areaCode',
      'occupantType',
      'architecturalStyle',
      'roofType',
      'foundationType'
    ];

    console.log('\nSample field values from API:');
    mlsFields.forEach(field => {
      const value = apiResponse[field];
      if (value !== null && value !== undefined && value !== '') {
        console.log(`   ✅ ${field}: ${value}`);
      } else {
        console.log(`   ⚠️  ${field}: (empty/null)`);
      }
    });

    console.log('\n✅ Test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: '/tmp/test_error.png' });
    console.log('📸 Error screenshot saved: /tmp/test_error.png');
  } finally {
    console.log('\n🔄 Keeping browser open for 5 seconds...');
    await page.waitForTimeout(5000);
    await browser.close();
  }
}

testListingDetailFields().catch(console.error);
