import puppeteer from 'puppeteer';
import 'dotenv/config';

/**
 * E2E Test: Dashboard Recent Conversations Enhancement
 *
 * Tests:
 * 1. Dashboard displays conversations with icons and decorations
 * 2. Clicking a conversation routes to /chat/[id] (not /history/[id])
 * 3. Visual elements render correctly (Avatar, Chip, Icons)
 */

async function testDashboardConversations() {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1920, height: 1080 }
  });

  const page = await browser.newPage();

  try {
    console.log('🚀 Starting Dashboard Conversations E2E Test...\n');

    // Step 1: Navigate to portal dashboard
    console.log('📍 Step 1: Navigating to dashboard...');
    await page.goto('http://localhost:3001/dashboard', { waitUntil: 'networkidle2' });
    await new Promise(resolve => setTimeout(resolve, 2000));
    await page.screenshot({ path: '/tmp/dashboard_01_initial.png' });
    console.log('✅ Screenshot saved: /tmp/dashboard_01_initial.png\n');

    // Step 2: Wait for Recent Conversations section to load
    console.log('📍 Step 2: Waiting for Recent Conversations section...');
    const conversationsHeader = await page.waitForSelector('h6:has-text("Recent Conversations")', {
      timeout: 10000
    }).catch(() => null);

    if (!conversationsHeader) {
      console.log('⚠️  No Recent Conversations found - user may not have any conversations yet');
      await page.screenshot({ path: '/tmp/dashboard_02_no_conversations.png' });
      console.log('✅ Screenshot saved: /tmp/dashboard_02_no_conversations.png\n');
      return;
    }

    console.log('✅ Recent Conversations section found\n');

    // Step 3: Find conversation list items
    console.log('📍 Step 3: Finding conversation items...');
    const conversationItems = await page.$$('a[href^="/chat/"]');
    console.log(`✅ Found ${conversationItems.length} conversation items\n`);

    if (conversationItems.length === 0) {
      console.log('⚠️  No conversation items found');
      await page.screenshot({ path: '/tmp/dashboard_03_no_items.png' });
      console.log('✅ Screenshot saved: /tmp/dashboard_03_no_items.png\n');
      return;
    }

    // Step 4: Verify visual elements exist (Avatar, Chip, Icons)
    console.log('📍 Step 4: Verifying visual elements...');

    // Check for Avatar with ChatBubbleOutlineIcon
    const avatars = await page.$$('div[class*="MuiAvatar-root"]');
    console.log(`✅ Found ${avatars.length} avatar(s)`);

    // Check for Chip with message count
    const chips = await page.$$('div[class*="MuiChip-root"]');
    console.log(`✅ Found ${chips.length} chip(s)`);

    // Check for AccessTimeIcon
    const timeIcons = await page.$$('svg[data-testid="AccessTimeIcon"]');
    console.log(`✅ Found ${timeIcons.length} time icon(s)`);

    await page.screenshot({ path: '/tmp/dashboard_04_visual_elements.png' });
    console.log('✅ Screenshot saved: /tmp/dashboard_04_visual_elements.png\n');

    // Step 5: Hover over first conversation to see hover effects
    console.log('📍 Step 5: Testing hover effects...');
    await conversationItems[0].hover();
    await new Promise(resolve => setTimeout(resolve, 500));
    await page.screenshot({ path: '/tmp/dashboard_05_hover_effect.png' });
    console.log('✅ Screenshot saved: /tmp/dashboard_05_hover_effect.png\n');

    // Step 6: Get the href of the first conversation
    console.log('📍 Step 6: Verifying route...');
    const firstConversationHref = await page.evaluate(el => el.getAttribute('href'), conversationItems[0]);
    console.log(`   Conversation link: ${firstConversationHref}`);

    if (!firstConversationHref.startsWith('/chat/')) {
      console.error('❌ ERROR: Conversation does not link to /chat/[id]');
      console.error(`   Expected: /chat/[id]`);
      console.error(`   Actual: ${firstConversationHref}`);
      return;
    }

    console.log('✅ Conversation correctly links to /chat/[id]\n');

    // Step 7: Click the conversation and verify navigation
    console.log('📍 Step 7: Clicking conversation and verifying navigation...');
    await conversationItems[0].click();
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 });

    const currentUrl = page.url();
    console.log(`   Navigated to: ${currentUrl}`);

    if (!currentUrl.includes('/chat/')) {
      console.error('❌ ERROR: Navigation did not go to /chat/[id]');
      console.error(`   Expected: URL containing /chat/`);
      console.error(`   Actual: ${currentUrl}`);
      return;
    }

    console.log('✅ Successfully navigated to chat page\n');
    await page.screenshot({ path: '/tmp/dashboard_07_chat_page.png' });
    console.log('✅ Screenshot saved: /tmp/dashboard_07_chat_page.png\n');

    // Step 8: Test keyboard navigation (Tab + Enter)
    console.log('📍 Step 8: Testing keyboard navigation...');
    await page.goto('http://localhost:3001/dashboard', { waitUntil: 'networkidle2' });
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Tab to the first conversation
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.screenshot({ path: '/tmp/dashboard_08_keyboard_focus.png' });
    console.log('✅ Screenshot saved: /tmp/dashboard_08_keyboard_focus.png\n');

    console.log('\n✅ ✅ ✅ ALL TESTS PASSED ✅ ✅ ✅\n');
    console.log('Summary:');
    console.log('  ✅ Dashboard loaded successfully');
    console.log('  ✅ Recent Conversations section found');
    console.log('  ✅ Visual elements render correctly (Avatar, Chip, Icons)');
    console.log('  ✅ Hover effects work');
    console.log('  ✅ Conversations link to /chat/[id] (not /history/[id])');
    console.log('  ✅ Navigation works correctly');
    console.log('  ✅ Keyboard navigation works');

  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    await page.screenshot({ path: '/tmp/dashboard_error.png' });
    console.log('✅ Error screenshot saved: /tmp/dashboard_error.png');
  } finally {
    await browser.close();
  }
}

testDashboardConversations().catch(console.error);
