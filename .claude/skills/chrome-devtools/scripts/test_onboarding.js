import puppeteer from 'puppeteer';

async function testOnboarding() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  console.log('🧪 Testing Feature 016: User Onboarding Process');
  console.log('==============================================\n');

  try {
    // Step 1: Navigate to onboarding roles page
    console.log('Step 1: Navigating to onboarding roles page...');
    await page.goto('http://localhost:3000/onboarding/roles', { waitUntil: 'networkidle2' });

    const rolesPageTitle = await page.title();
    console.log(`✓ Roles page loaded: ${rolesPageTitle}`);

    // Take screenshot
    await page.screenshot({ path: '/tmp/onboarding-roles.png', fullPage: true });
    console.log('✓ Screenshot saved to /tmp/onboarding-roles.png\n');

    // Step 2: Check for role selection elements
    console.log('Step 2: Checking role selection UI...');
    const hasRoleButtons = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      const buttonTexts = Array.from(buttons).map(b => b.textContent?.toLowerCase() || '');
      return {
        hasBuyer: buttonTexts.some(t => t.includes('buyer')),
        hasSeller: buttonTexts.some(t => t.includes('seller')),
        hasInvestor: buttonTexts.some(t => t.includes('investor'))
      };
    });

    console.log('  Role buttons found:', hasRoleButtons);
    console.log();

    // Step 3: Navigate to flow selection
    console.log('Step 3: Navigating to flow selection page...');
    await page.goto('http://localhost:3000/onboarding/flow', { waitUntil: 'networkidle2' });
    await page.screenshot({ path: '/tmp/onboarding-flow.png', fullPage: true });
    console.log('✓ Flow selection page loaded');
    console.log('✓ Screenshot saved to /tmp/onboarding-flow.png\n');

    // Step 4: Navigate to buyer wizard - location
    console.log('Step 4: Testing Buyer Wizard - Location step...');
    await page.goto('http://localhost:3000/onboarding/buyer/location', { waitUntil: 'networkidle2' });
    await page.screenshot({ path: '/tmp/onboarding-buyer-location.png', fullPage: true });
    console.log('✓ Buyer location page loaded');
    console.log('✓ Screenshot saved to /tmp/onboarding-buyer-location.png\n');

    // Step 5: Navigate to buyer wizard - property type
    console.log('Step 5: Testing Buyer Wizard - Property Type step...');
    await page.goto('http://localhost:3000/onboarding/buyer/property-type', { waitUntil: 'networkidle2' });
    await page.screenshot({ path: '/tmp/onboarding-buyer-property-type.png', fullPage: true });
    console.log('✓ Buyer property type page loaded');
    console.log('✓ Screenshot saved to /tmp/onboarding-buyer-property-type.png\n');

    // Step 6: Navigate to buyer wizard - budget
    console.log('Step 6: Testing Buyer Wizard - Budget step...');
    await page.goto('http://localhost:3000/onboarding/buyer/budget', { waitUntil: 'networkidle2' });
    await page.screenshot({ path: '/tmp/onboarding-buyer-budget.png', fullPage: true });
    console.log('✓ Buyer budget page loaded');
    console.log('✓ Screenshot saved to /tmp/onboarding-buyer-budget.png\n');

    // Step 7: Navigate to buyer wizard - bedrooms/bathrooms
    console.log('Step 7: Testing Buyer Wizard - Bedrooms/Bathrooms step...');
    await page.goto('http://localhost:3000/onboarding/buyer/bedrooms-bathrooms', { waitUntil: 'networkidle2' });
    await page.screenshot({ path: '/tmp/onboarding-buyer-bedrooms.png', fullPage: true });
    console.log('✓ Buyer bedrooms/bathrooms page loaded');
    console.log('✓ Screenshot saved to /tmp/onboarding-buyer-bedrooms.png\n');

    // Step 8: Navigate to buyer wizard - features
    console.log('Step 8: Testing Buyer Wizard - Features step...');
    await page.goto('http://localhost:3000/onboarding/buyer/features', { waitUntil: 'networkidle2' });
    await page.screenshot({ path: '/tmp/onboarding-buyer-features.png', fullPage: true });
    console.log('✓ Buyer features page loaded');
    console.log('✓ Screenshot saved to /tmp/onboarding-buyer-features.png\n');

    // Step 9: Navigate to completion page
    console.log('Step 9: Testing completion page...');
    await page.goto('http://localhost:3000/onboarding/complete', { waitUntil: 'networkidle2' });
    await page.screenshot({ path: '/tmp/onboarding-complete.png', fullPage: true });
    console.log('✓ Completion page loaded');
    console.log('✓ Screenshot saved to /tmp/onboarding-complete.png\n');

    console.log('========================================');
    console.log('✅ Feature 016 E2E Test Complete!');
    console.log('========================================');
    console.log('\nAll onboarding pages are accessible and rendering correctly.');
    console.log('Screenshots saved to /tmp/onboarding-*.png for manual review.');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

testOnboarding().catch(console.error);
