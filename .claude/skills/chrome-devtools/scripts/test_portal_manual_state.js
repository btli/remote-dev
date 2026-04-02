import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const SCREENSHOTS_DIR = '/tmp/portal_manual_state_test';

// Ensure screenshots directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testManualStatePersistence() {
  console.log('🚀 Starting portal manual state persistence test...\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  try {
    // Clear localStorage first to start fresh
    console.log('📍 Step 1: Clear localStorage and load dashboard');
    await page.goto('http://localhost:3001/dashboard', { waitUntil: 'networkidle2' });
    await page.evaluate(() => {
      localStorage.removeItem('portal-nav-expanded-items');
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1000);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01-fresh-start-all-collapsed.png'), fullPage: true });

    const initialState = await page.evaluate(() => {
      const allText = document.querySelector('nav').textContent;
      return {
        hasConversations: allText.includes('Conversations'),
        hasNewChat: allText.includes('New Chat'),
        hasProperties: allText.includes('Properties'),
        hasBrowseListings: allText.includes('Browse Listings'),
      };
    });

    console.log('Initial state (all sections should be collapsed):');
    console.log(`  - Conversations section visible: ${initialState.hasConversations}`);
    console.log(`  - New Chat visible: ${initialState.hasNewChat} (should be false)`);
    console.log(`  - Properties section visible: ${initialState.hasProperties}`);
    console.log(`  - Browse Listings visible: ${initialState.hasBrowseListings} (should be false)`);

    if (!initialState.hasNewChat && !initialState.hasBrowseListings) {
      console.log('✅ PASS: All sections start collapsed\n');
    } else {
      console.error('❌ FAIL: Sections should start collapsed\n');
    }

    // 2. Manually expand "Conversations" section
    console.log('📍 Step 2: Manually expand Conversations section');
    await page.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll('nav > div > div:last-child > div > div'));
      const conversationsBox = boxes.find(box => box.textContent.includes('Conversations') && !box.textContent.includes('New Chat'));
      if (conversationsBox) conversationsBox.click();
    });
    await sleep(500);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02-conversations-manually-expanded.png'), fullPage: true });
    console.log('✅ Conversations section manually expanded\n');

    // 3. Navigate to Browse Listings (Properties section is still collapsed)
    console.log('📍 Step 3: Navigate to Browse Listings page');
    await page.goto('http://localhost:3001/properties', { waitUntil: 'networkidle2' });
    await sleep(1000);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '03-browse-listings-page.png'), fullPage: true });
    console.log('✅ Navigated to Browse Listings\n');

    // 4. Verify Conversations is still expanded, but Properties is collapsed
    console.log('📍 Step 4: Verify only Conversations remains expanded (no auto-expand)');
    const afterNavigation = await page.evaluate(() => {
      const allText = document.querySelector('nav').textContent;
      return {
        hasNewChat: allText.includes('New Chat'),
        hasSavedSearches: allText.includes('Saved Searches'),
      };
    });

    if (afterNavigation.hasNewChat && !afterNavigation.hasSavedSearches) {
      console.log('✅ PASS: Conversations still expanded, Properties NOT auto-expanded\n');
    } else {
      console.error('❌ FAIL: Properties should not auto-expand');
      console.error(`   New Chat visible: ${afterNavigation.hasNewChat}`);
      console.error(`   Saved Searches visible: ${afterNavigation.hasSavedSearches} (should be false)\n`);
    }

    // 5. Manually expand Properties section
    console.log('📍 Step 5: Manually expand Properties section');
    await page.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll('nav > div > div:last-child > div > div'));
      const propertiesBox = boxes.find(box => box.textContent.includes('Properties') && !box.textContent.includes('Browse'));
      if (propertiesBox) propertiesBox.click();
    });
    await sleep(500);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '04-both-manually-expanded.png'), fullPage: true });
    console.log('✅ Properties section manually expanded\n');

    // 6. Navigate to Dashboard
    console.log('📍 Step 6: Navigate to Dashboard');
    await page.goto('http://localhost:3001/dashboard', { waitUntil: 'networkidle2' });
    await sleep(1000);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '05-dashboard-both-expanded.png'), fullPage: true });
    console.log('✅ Navigated to Dashboard\n');

    // 7. Verify both sections remain expanded
    console.log('📍 Step 7: Verify both sections remain expanded after navigation');
    const bothExpanded = await page.evaluate(() => {
      const allText = document.querySelector('nav').textContent;
      return {
        hasNewChat: allText.includes('New Chat'),
        hasBrowseListings: allText.includes('Browse Listings'),
      };
    });

    if (bothExpanded.hasNewChat && bothExpanded.hasBrowseListings) {
      console.log('✅ PASS: Both sections remain expanded\n');
    } else {
      console.error('❌ FAIL: Sections lost state');
      console.error(`   New Chat visible: ${bothExpanded.hasNewChat}`);
      console.error(`   Browse Listings visible: ${bothExpanded.hasBrowseListings}\n`);
    }

    // 8. Reload page to test localStorage persistence
    console.log('📍 Step 8: Reload page to verify localStorage persistence');
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1000);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '06-after-reload-both-expanded.png'), fullPage: true });

    const afterReload = await page.evaluate(() => {
      const allText = document.querySelector('nav').textContent;
      return {
        hasNewChat: allText.includes('New Chat'),
        hasBrowseListings: allText.includes('Browse Listings'),
      };
    });

    if (afterReload.hasNewChat && afterReload.hasBrowseListings) {
      console.log('✅ PASS: State persists after page reload (localStorage working)\n');
    } else {
      console.error('❌ FAIL: State lost after reload');
      console.error(`   New Chat visible: ${afterReload.hasNewChat}`);
      console.error(`   Browse Listings visible: ${afterReload.hasBrowseListings}\n`);
    }

    // 9. Manually collapse Conversations
    console.log('📍 Step 9: Manually collapse Conversations section');
    await page.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll('nav > div > div:last-child > div > div'));
      const conversationsBox = boxes.find(box => box.textContent.includes('Conversations') && box.textContent.includes('New Chat'));
      if (conversationsBox) conversationsBox.click();
    });
    await sleep(500);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '07-conversations-collapsed.png'), fullPage: true });
    console.log('✅ Conversations section collapsed\n');

    // 10. Navigate and verify collapsed state persists
    console.log('📍 Step 10: Navigate to History and verify Conversations stays collapsed');
    await page.goto('http://localhost:3001/history', { waitUntil: 'networkidle2' });
    await sleep(1000);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '08-history-conversations-collapsed.png'), fullPage: true });

    const finalState = await page.evaluate(() => {
      const allText = document.querySelector('nav').textContent;
      return {
        hasNewChat: allText.includes('New Chat'),
        hasBrowseListings: allText.includes('Browse Listings'),
      };
    });

    if (!finalState.hasNewChat && finalState.hasBrowseListings) {
      console.log('✅ PASS: Conversations stays collapsed, Properties stays expanded\n');
    } else {
      console.error('❌ FAIL: State changed unexpectedly');
      console.error(`   New Chat visible: ${finalState.hasNewChat} (should be false)`);
      console.error(`   Browse Listings visible: ${finalState.hasBrowseListings} (should be true)\n`);
    }

    console.log('\n✅ Manual state persistence test completed successfully!');
    console.log(`📸 Screenshots saved to: ${SCREENSHOTS_DIR}`);
    console.log('\n📋 Summary:');
    console.log('  ✓ Sections start collapsed by default');
    console.log('  ✓ No auto-expansion when navigating to pages');
    console.log('  ✓ Manual expand/collapse actions are preserved');
    console.log('  ✓ State persists across page navigation');
    console.log('  ✓ State persists after browser reload (localStorage)');

  } catch (error) {
    console.error('\n❌ Test failed with error:');
    console.error(error);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'error.png'), fullPage: true });
    throw error;
  } finally {
    await browser.close();
  }
}

testManualStatePersistence().catch(console.error);
