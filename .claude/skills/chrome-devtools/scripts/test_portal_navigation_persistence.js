import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const SCREENSHOTS_DIR = '/tmp/portal_nav_test';

// Ensure screenshots directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testNavigationPersistence() {
  console.log('🚀 Starting portal navigation persistence test...\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  try {
    // 1. Navigate to portal dashboard
    console.log('📍 Step 1: Navigate to portal dashboard');
    await page.goto('http://localhost:3001/dashboard', { waitUntil: 'networkidle2' });
    await page.waitForSelector('nav', { timeout: 10000 });
    await sleep(1000);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01-initial-load.png'), fullPage: true });
    console.log('✅ Dashboard loaded\n');

    // 2. Expand "Conversations" section
    console.log('📍 Step 2: Expand Conversations section');
    await page.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll('nav > div > div:last-child > div > div'));
      const conversationsBox = boxes.find(box => box.textContent.includes('Conversations'));
      if (conversationsBox) conversationsBox.click();
    });
    await sleep(500);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02-conversations-expanded.png'), fullPage: true });
    console.log('✅ Conversations section expanded\n');

    // 3. Expand "Properties" section
    console.log('📍 Step 3: Expand Properties section');
    await page.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll('nav > div > div:last-child > div > div'));
      const propertiesBox = boxes.find(box => box.textContent.includes('Properties') && !box.textContent.includes('Browse'));
      if (propertiesBox) propertiesBox.click();
    });
    await sleep(500);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '03-both-sections-expanded.png'), fullPage: true });
    console.log('✅ Both sections expanded\n');

    // 4. Navigate to "History" page
    console.log('📍 Step 4: Navigate to History page');
    await page.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll('nav div, nav a'));
      const historyBox = boxes.find(box => box.textContent.trim() === 'History');
      if (historyBox) historyBox.click();
    });
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    await sleep(1000);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '04-history-page.png'), fullPage: true });
    console.log('✅ Navigated to History\n');

    // 5. Check if sections are still expanded
    console.log('📍 Step 5: Verify sections remain expanded after navigation');
    const sectionsExpanded = await page.evaluate(() => {
      const allText = document.querySelector('nav').textContent;
      const hasNewChat = allText.includes('New Chat');
      const hasBrowseListings = allText.includes('Browse Listings');
      return { hasNewChat, hasBrowseListings };
    });

    if (sectionsExpanded.hasNewChat && sectionsExpanded.hasBrowseListings) {
      console.log('✅ PASS: Both sections remain expanded after navigation\n');
    } else {
      console.error('❌ FAIL: Sections collapsed after navigation');
      console.error(`   Conversations visible: ${sectionsExpanded.hasNewChat}`);
      console.error(`   Properties visible: ${sectionsExpanded.hasBrowseListings}\n`);
    }

    // 6. Navigate to "Browse Listings" page
    console.log('📍 Step 6: Navigate to Browse Listings page');
    await page.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll('nav div, nav a'));
      const browseListingsBox = boxes.find(box => box.textContent.includes('Browse Listings'));
      if (browseListingsBox) browseListingsBox.click();
    });
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    await sleep(1000);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '05-browse-listings-page.png'), fullPage: true });
    console.log('✅ Navigated to Browse Listings\n');

    // 7. Verify sections are still expanded
    console.log('📍 Step 7: Verify sections still expanded after second navigation');
    const stillExpanded = await page.evaluate(() => {
      const allText = document.querySelector('nav').textContent;
      return {
        conversationsVisible: allText.includes('New Chat'),
        propertiesVisible: allText.includes('Saved Searches'),
      };
    });

    if (stillExpanded.conversationsVisible && stillExpanded.propertiesVisible) {
      console.log('✅ PASS: Sections persist across multiple navigations\n');
    } else {
      console.error('❌ FAIL: Sections collapsed on second navigation');
      console.error(`   Conversations visible: ${stillExpanded.conversationsVisible}`);
      console.error(`   Properties visible: ${stillExpanded.propertiesVisible}\n`);
    }

    // 8. Test page reload persistence (localStorage)
    console.log('📍 Step 8: Test localStorage persistence after page reload');
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1000);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '06-after-reload.png'), fullPage: true });

    const persistedAfterReload = await page.evaluate(() => {
      const allText = document.querySelector('nav').textContent;
      return {
        conversationsVisible: allText.includes('New Chat'),
        propertiesVisible: allText.includes('Saved Searches'),
      };
    });

    if (persistedAfterReload.conversationsVisible && persistedAfterReload.propertiesVisible) {
      console.log('✅ PASS: Expanded state persists after page reload (localStorage working)\n');
    } else {
      console.error('❌ FAIL: Expanded state lost after reload');
      console.error(`   Conversations visible: ${persistedAfterReload.conversationsVisible}`);
      console.error(`   Properties visible: ${persistedAfterReload.propertiesVisible}\n`);
    }

    // 9. Test collapsing Conversations section
    console.log('📍 Step 9: Test collapsing Conversations section');
    await page.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll('nav > div > div:last-child > div > div'));
      const conversationsBox = boxes.find(box => box.textContent.includes('Conversations') && box.textContent.includes('New Chat'));
      if (conversationsBox) conversationsBox.click();
    });
    await sleep(500);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '07-conversations-collapsed.png'), fullPage: true });

    const conversationsCollapsed = await page.evaluate(() => {
      const allText = document.querySelector('nav').textContent;
      return !allText.includes('New Chat');
    });

    if (conversationsCollapsed) {
      console.log('✅ PASS: Section collapses when clicked\n');
    } else {
      console.error('❌ FAIL: Section did not collapse\n');
    }

    // 10. Navigate to Dashboard and verify collapsed state persists
    console.log('📍 Step 10: Navigate to Dashboard and verify collapsed state persists');
    await page.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll('nav div, nav a'));
      const dashboardBox = boxes.find(box => box.textContent.trim() === 'Dashboard');
      if (dashboardBox) dashboardBox.click();
    });
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    await sleep(1000);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '08-dashboard-conversations-collapsed.png'), fullPage: true });

    const stillCollapsed = await page.evaluate(() => {
      const allText = document.querySelector('nav').textContent;
      return !allText.includes('New Chat');
    });

    if (stillCollapsed) {
      console.log('✅ PASS: Collapsed state persists across navigation\n');
    } else {
      console.error('❌ FAIL: Section re-expanded unexpectedly\n');
    }

    // 11. Verify Properties section is still expanded
    console.log('📍 Step 11: Verify Properties section remains expanded');
    const propertiesStillExpanded = await page.evaluate(() => {
      const allText = document.querySelector('nav').textContent;
      return allText.includes('Browse Listings');
    });

    if (propertiesStillExpanded) {
      console.log('✅ PASS: Properties section remains expanded independently\n');
    } else {
      console.error('❌ FAIL: Properties section collapsed unexpectedly\n');
    }

    console.log('\n✅ Navigation persistence test completed successfully!');
    console.log(`📸 Screenshots saved to: ${SCREENSHOTS_DIR}`);

  } catch (error) {
    console.error('\n❌ Test failed with error:');
    console.error(error);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'error.png'), fullPage: true });
    throw error;
  } finally {
    await browser.close();
  }
}

testNavigationPersistence().catch(console.error);
