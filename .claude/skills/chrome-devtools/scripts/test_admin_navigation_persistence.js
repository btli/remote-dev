import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const SCREENSHOTS_DIR = '/tmp/admin_nav_test';

// Ensure screenshots directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function testNavigationPersistence() {
  console.log('🚀 Starting admin navigation persistence test...\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  try {
    // 1. Navigate to admin dashboard
    console.log('📍 Step 1: Navigate to admin dashboard');
    await page.goto('http://localhost:3002', { waitUntil: 'networkidle2' });
    await page.waitForSelector('nav', { timeout: 10000 });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01-initial-load.png') });
    console.log('✅ Dashboard loaded\n');

    // 2. Expand "User Management" section
    console.log('📍 Step 2: Expand User Management section');
    await page.evaluate(() => {
      const userMgmtSection = Array.from(document.querySelectorAll('nav [role="button"]'))
        .find(el => el.textContent.includes('User Management'));
      if (userMgmtSection) userMgmtSection.click();
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02-user-mgmt-expanded.png') });
    console.log('✅ User Management section expanded\n');

    // 3. Expand "Data Ingestion" section
    console.log('📍 Step 3: Expand Data Ingestion section');
    await page.evaluate(() => {
      const dataIngestionSection = Array.from(document.querySelectorAll('nav [role="button"]'))
        .find(el => el.textContent.includes('Data Ingestion'));
      if (dataIngestionSection) dataIngestionSection.click();
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '03-both-sections-expanded.png') });
    console.log('✅ Both sections expanded\n');

    // 4. Navigate to "All Users" page
    console.log('📍 Step 4: Navigate to All Users page');
    await page.evaluate(() => {
      const allUsersLink = Array.from(document.querySelectorAll('nav a, nav div[role="button"]'))
        .find(el => el.textContent.includes('All Users'));
      if (allUsersLink) allUsersLink.click();
    });
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '04-all-users-page.png') });
    console.log('✅ Navigated to All Users\n');

    // 5. Check if sections are still expanded
    console.log('📍 Step 5: Verify sections remain expanded');
    const isUserMgmtExpanded = await page.evaluate(() => {
      const userMgmtChildren = document.querySelectorAll('nav [role="button"]');
      const userMgmtSection = Array.from(userMgmtChildren)
        .find(el => el.textContent.includes('User Management'));
      if (!userMgmtSection) return false;

      // Check if "All Users" child link is visible
      const allUsersVisible = Array.from(document.querySelectorAll('nav a, nav div[role="button"]'))
        .some(el => el.textContent.includes('All Users') && el.offsetParent !== null);

      return allUsersVisible;
    });

    const isDataIngestionExpanded = await page.evaluate(() => {
      const dataIngestionSection = Array.from(document.querySelectorAll('nav [role="button"]'))
        .find(el => el.textContent.includes('Data Ingestion'));
      if (!dataIngestionSection) return false;

      // Check if "Run History" child link is visible
      const runHistoryVisible = Array.from(document.querySelectorAll('nav a, nav div[role="button"]'))
        .some(el => el.textContent.includes('Run History') && el.offsetParent !== null);

      return runHistoryVisible;
    });

    if (isUserMgmtExpanded && isDataIngestionExpanded) {
      console.log('✅ PASS: Both sections remain expanded after navigation\n');
    } else {
      console.error('❌ FAIL: Sections collapsed after navigation');
      console.error(`   User Management expanded: ${isUserMgmtExpanded}`);
      console.error(`   Data Ingestion expanded: ${isDataIngestionExpanded}\n`);
    }

    // 6. Navigate to "Run History" page
    console.log('📍 Step 6: Navigate to Run History page');
    await page.evaluate(() => {
      const runHistoryLink = Array.from(document.querySelectorAll('nav a, nav div[role="button"]'))
        .find(el => el.textContent.includes('Run History'));
      if (runHistoryLink) runHistoryLink.click();
    });
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '05-run-history-page.png') });
    console.log('✅ Navigated to Run History\n');

    // 7. Verify sections are still expanded
    console.log('📍 Step 7: Verify sections still expanded after second navigation');
    const stillExpanded = await page.evaluate(() => {
      const userMgmtVisible = Array.from(document.querySelectorAll('nav a, nav div[role="button"]'))
        .some(el => el.textContent.includes('All Users') && el.offsetParent !== null);

      const dataIngestionVisible = Array.from(document.querySelectorAll('nav a, nav div[role="button"]'))
        .some(el => el.textContent.includes('Run History') && el.offsetParent !== null);

      return { userMgmtVisible, dataIngestionVisible };
    });

    if (stillExpanded.userMgmtVisible && stillExpanded.dataIngestionVisible) {
      console.log('✅ PASS: Sections persist across multiple navigations\n');
    } else {
      console.error('❌ FAIL: Sections collapsed on second navigation');
      console.error(`   User Management visible: ${stillExpanded.userMgmtVisible}`);
      console.error(`   Data Ingestion visible: ${stillExpanded.dataIngestionVisible}\n`);
    }

    // 8. Test page reload persistence (localStorage)
    console.log('📍 Step 8: Test localStorage persistence after page reload');
    await page.reload({ waitUntil: 'networkidle2' });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '06-after-reload.png') });

    const persistedAfterReload = await page.evaluate(() => {
      const userMgmtVisible = Array.from(document.querySelectorAll('nav a, nav div[role="button"]'))
        .some(el => el.textContent.includes('All Users') && el.offsetParent !== null);

      const dataIngestionVisible = Array.from(document.querySelectorAll('nav a, nav div[role="button"]'))
        .some(el => el.textContent.includes('Run History') && el.offsetParent !== null);

      return { userMgmtVisible, dataIngestionVisible };
    });

    if (persistedAfterReload.userMgmtVisible && persistedAfterReload.dataIngestionVisible) {
      console.log('✅ PASS: Expanded state persists after page reload (localStorage working)\n');
    } else {
      console.error('❌ FAIL: Expanded state lost after reload');
      console.error(`   User Management visible: ${persistedAfterReload.userMgmtVisible}`);
      console.error(`   Data Ingestion visible: ${persistedAfterReload.dataIngestionVisible}\n`);
    }

    // 9. Test collapsing sections
    console.log('📍 Step 9: Test collapsing User Management section');
    await page.evaluate(() => {
      const userMgmtSection = Array.from(document.querySelectorAll('nav [role="button"]'))
        .find(el => el.textContent.includes('User Management'));
      if (userMgmtSection) userMgmtSection.click();
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '07-user-mgmt-collapsed.png') });

    const userMgmtCollapsed = await page.evaluate(() => {
      const allUsersVisible = Array.from(document.querySelectorAll('nav a, nav div[role="button"]'))
        .some(el => el.textContent.includes('All Users') && el.offsetParent !== null);
      return !allUsersVisible;
    });

    if (userMgmtCollapsed) {
      console.log('✅ PASS: Section collapses when clicked\n');
    } else {
      console.error('❌ FAIL: Section did not collapse\n');
    }

    // 10. Navigate and verify collapsed state persists
    console.log('📍 Step 10: Navigate to Dashboard and verify collapsed state persists');
    await page.evaluate(() => {
      const dashboardLink = Array.from(document.querySelectorAll('nav a, nav div[role="button"]'))
        .find(el => el.textContent.includes('Dashboard'));
      if (dashboardLink) dashboardLink.click();
    });
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '08-dashboard-user-mgmt-collapsed.png') });

    const stillCollapsed = await page.evaluate(() => {
      const allUsersVisible = Array.from(document.querySelectorAll('nav a, nav div[role="button"]'))
        .some(el => el.textContent.includes('All Users') && el.offsetParent !== null);
      return !allUsersVisible;
    });

    if (stillCollapsed) {
      console.log('✅ PASS: Collapsed state persists across navigation\n');
    } else {
      console.error('❌ FAIL: Section re-expanded unexpectedly\n');
    }

    console.log('\n✅ Navigation persistence test completed successfully!');
    console.log(`📸 Screenshots saved to: ${SCREENSHOTS_DIR}`);

  } catch (error) {
    console.error('\n❌ Test failed with error:');
    console.error(error);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'error.png') });
    throw error;
  } finally {
    await browser.close();
  }
}

testNavigationPersistence().catch(console.error);
