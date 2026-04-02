import puppeteer from 'puppeteer';

async function testConversationHistoryClick() {
  const browser = await puppeteer.launch({ 
    headless: false,
    slowMo: 100 
  });
  
  const page = await browser.newPage();
  
  // Enable console logging from the browser
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', error => console.error('PAGE ERROR:', error.message));
  
  try {
    console.log('🔍 Step 1: Navigate to sign-in page...');
    await page.goto('http://localhost:3002/signin', { waitUntil: 'networkidle2' });
    await page.screenshot({ path: '/tmp/conv_test_1_signin.png', fullPage: true });
    
    console.log('🔍 Step 2: Check if already signed in (redirect to dashboard)...');
    await page.waitForTimeout(2000);
    const currentUrl = page.url();
    console.log('Current URL:', currentUrl);
    
    if (currentUrl.includes('/signin')) {
      console.log('Not signed in, need to authenticate first');
      console.log('❌ Please sign in manually and re-run the test');
      return;
    }
    
    console.log('✅ Already signed in, continuing...');
    
    console.log('🔍 Step 3: Navigate to history page...');
    await page.goto('http://localhost:3002/history', { waitUntil: 'networkidle2' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/conv_test_2_history_page.png', fullPage: true });
    
    console.log('🔍 Step 4: Check if conversations are loaded...');
    const conversations = await page.$$('[data-testid="conversation-card"], .MuiCard-root');
    console.log(`Found ${conversations.length} conversation cards`);
    
    if (conversations.length === 0) {
      console.log('No conversations found - checking for empty state');
      const emptyState = await page.$('text=No conversations yet');
      if (emptyState) {
        console.log('Empty state displayed - no conversations to test with');
        return;
      }
    }
    
    console.log('🔍 Step 5: Click on first conversation...');
    const firstConversation = conversations[0];
    
    // Get conversation details before clicking
    const conversationText = await firstConversation.evaluate(el => el.textContent);
    console.log('First conversation text:', conversationText?.substring(0, 100));
    
    // Try to find the CardActionArea
    const actionArea = await firstConversation.$('.MuiCardActionArea-root');
    if (actionArea) {
      console.log('Found CardActionArea, clicking...');
      await actionArea.click();
    } else {
      console.log('CardActionArea not found, clicking card directly...');
      await firstConversation.click();
    }
    
    console.log('🔍 Step 6: Wait for navigation...');
    await page.waitForTimeout(3000);
    
    const newUrl = page.url();
    console.log('URL after click:', newUrl);
    
    if (newUrl.includes('/history/')) {
      console.log('✅ Successfully navigated to conversation detail page');
      await page.screenshot({ path: '/tmp/conv_test_3_detail_page.png', fullPage: true });
      
      // Check if messages are loaded
      const messages = await page.$$('.MuiPaper-root');
      console.log(`Found ${messages.length} message elements on detail page`);
    } else {
      console.log('❌ Did not navigate to detail page');
      console.log('Current URL:', newUrl);
      await page.screenshot({ path: '/tmp/conv_test_3_failed_navigation.png', fullPage: true });
    }
    
    console.log('\n📊 Test Summary:');
    console.log('- Screenshots saved to /tmp/conv_test_*.png');
    console.log('- Check browser console logs above for errors');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: '/tmp/conv_test_error.png', fullPage: true });
  } finally {
    console.log('\n⏳ Keeping browser open for 5 seconds for inspection...');
    await page.waitForTimeout(5000);
    await browser.close();
  }
}

testConversationHistoryClick().catch(console.error);
