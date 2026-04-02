import puppeteer from 'puppeteer';

async function testComprehensiveListingDetail() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 1024 }
  });

  const page = await browser.newPage();

  const errors = [];

  page.on('console', msg => {
    const text = msg.text();
    if (text.toLowerCase().includes('error') && !text.includes('DevTools')) {
      errors.push(text);
    }
  });

  page.on('pageerror', error => {
    errors.push(error.message);
  });

  try {
    console.log('✨ Testing comprehensive listing details page...\n');

    await page.goto('http://localhost:3002/data/listings/cmhda5riq002wsb6w0adpmpd7', {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    // Wait for content to render
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check for main sections
    const sections = await page.evaluate(() => {
      const getAccordionCount = () => document.querySelectorAll('[role="button"]').length;
      const hasBackButton = !!document.querySelector('a[href="/data/listings"]');
      const hasAddress = document.body.textContent.includes('565 Sierra Madre Boulevard');
      const hasPrice = document.body.textContent.includes('$1,650,000');
      const hasStatusBadge = !!document.querySelector('[class*="MuiChip"]');

      // Check for section headings
      const sectionTexts = Array.from(document.querySelectorAll('h6')).map(h => h.textContent);

      return {
        accordionCount: getAccordionCount(),
        hasBackButton,
        hasAddress,
        hasPrice,
        hasStatusBadge,
        sections: sectionTexts,
        hasBasicInfo: sectionTexts.some(t => t.includes('Basic Property')),
        hasConstruction: sectionTexts.some(t => t.includes('Construction')),
        hasInterior: sectionTexts.some(t => t.includes('Interior')),
        hasParking: sectionTexts.some(t => t.includes('Parking')),
        hasOutdoor: sectionTexts.some(t => t.includes('Outdoor')),
        hasSchools: sectionTexts.some(t => t.includes('School')),
        hasHOA: sectionTexts.some(t => t.includes('HOA')),
        hasLand: sectionTexts.some(t => t.includes('Land')),
        hasFinancial: sectionTexts.some(t => t.includes('Financial')),
        hasListing: sectionTexts.some(t => t.includes('Listing Details')),
        hasAgent: sectionTexts.some(t => t.includes('Agent')),
        hasDisclosures: sectionTexts.some(t => t.includes('Disclosures')),
        hasAccessibility: sectionTexts.some(t => t.includes('Accessibility')),
        hasMetadata: sectionTexts.some(t => t.includes('Metadata')),
        hasAdditionalFields: sectionTexts.some(t => t.includes('Additional Fields'))
      };
    });

    // Expand a few accordions to test
    console.log('📂 Expanding accordions...\n');
    const accordionButtons = await page.$$('[role="button"]');

    // Expand first 3 accordions
    for (let i = 0; i < Math.min(3, accordionButtons.length); i++) {
      await accordionButtons[i].click();
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // Take screenshot
    await page.screenshot({
      path: '/tmp/listing_comprehensive.png',
      fullPage: true
    });

    // Print results
    console.log('📊 Test Results:');
    console.log('================\n');

    console.log('✅ Core Elements:');
    console.log(`  ${sections.hasBackButton ? '✅' : '❌'} Back button`);
    console.log(`  ${sections.hasAddress ? '✅' : '❌'} Address`);
    console.log(`  ${sections.hasPrice ? '✅' : '❌'} Price`);
    console.log(`  ${sections.hasStatusBadge ? '✅' : '❌'} Status badge`);

    console.log(`\n📋 Sections Found: ${sections.accordionCount} accordions\n`);

    console.log('✅ Data Sections:');
    console.log(`  ${sections.hasBasicInfo ? '✅' : '❌'} Basic Property Information`);
    console.log(`  ${sections.hasConstruction ? '✅' : '❌'} Construction & Systems`);
    console.log(`  ${sections.hasInterior ? '✅' : '❌'} Interior Features`);
    console.log(`  ${sections.hasParking ? '✅' : '❌'} Parking & Garage`);
    console.log(`  ${sections.hasOutdoor ? '✅' : '❌'} Outdoor Amenities & Pool`);
    console.log(`  ${sections.hasSchools ? '✅' : '❌'} School Information`);
    console.log(`  ${sections.hasHOA ? '✅' : '❌'} HOA & Community`);
    console.log(`  ${sections.hasLand ? '✅' : '❌'} Land & Zoning`);
    console.log(`  ${sections.hasFinancial ? '✅' : '❌'} Financial Details`);
    console.log(`  ${sections.hasListing ? '✅' : '❌'} Listing Details`);
    console.log(`  ${sections.hasAgent ? '✅' : '❌'} Agent & Office Information`);
    console.log(`  ${sections.hasDisclosures ? '✅' : '❌'} Disclosures & Compliance`);
    console.log(`  ${sections.hasAccessibility ? '✅' : '❌'} Accessibility Features`);
    console.log(`  ${sections.hasMetadata ? '✅' : '❌'} Metadata`);
    console.log(`  ${sections.hasAdditionalFields ? '✅' : '❌'} Additional Fields (JSONB)`);

    console.log('\n📷 Screenshot: /tmp/listing_comprehensive.png');

    if (errors.length > 0) {
      console.log('\n⚠️  Errors detected:');
      errors.forEach(err => console.log(`  - ${err.substring(0, 100)}`));
    } else {
      console.log('\n✅ No JavaScript errors detected!');
    }

    // Check if all major sections are present
    const requiredSections = [
      sections.hasBasicInfo,
      sections.hasConstruction,
      sections.hasInterior,
      sections.hasParking,
      sections.hasOutdoor,
      sections.hasSchools,
      sections.hasHOA,
      sections.hasLand,
      sections.hasFinancial,
      sections.hasListing,
      sections.hasAgent,
      sections.hasDisclosures,
      sections.hasAccessibility,
      sections.hasMetadata,
      sections.hasAdditionalFields
    ];

    const allPresent = requiredSections.every(v => v);
    const presentCount = requiredSections.filter(v => v).length;

    console.log(`\n${allPresent ? '🎉' : '⚠️'} Overall: ${presentCount}/${requiredSections.length} sections present\n`);

    if (allPresent) {
      console.log('🎉 SUCCESS: All data sections are displayed!\n');
    } else {
      console.log('⚠️  Some sections are missing. Check the implementation.\n');
    }

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

testComprehensiveListingDetail().catch(console.error);
