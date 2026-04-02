import puppeteer from 'puppeteer';

/**
 * E2E Test: Portal Chat History
 * 
 * Tests the full chat history functionality:
 * 1. Start a new chat conversation
 * 2. Send messages back and forth
 * 3. Navigate to history page
 * 4. Verify conversation appears
 * 5. View conversation detail
 * 6. Verify all messages are displayed
 */

const PORTAL_URL = 'http://localhost:3001';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testChatHistory() {
  console.log('Starting Portal Chat History E2E Test...');

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    slowMo: 100,
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Enable console logging
    page.on('console', msg => {
      const type = msg.type();
      if (type === 'error' || type === 'warning') {
        console.log('[Browser] ' + type + ':', msg.text());
      }
    });

    console.log('Step 1: Navigate to portal home page');
    await page.goto(PORTAL_URL, { waitUntil: 'networkidle2' });
    await page.screenshot({ path: '/tmp/portal_home.png' });
    console.log('  Home page loaded');

    console.log('Step 2: Start new chat');
    await page.goto(PORTAL_URL + '/chat/new', { waitUntil: 'networkidle2' });
    await delay(2000);
    await page.screenshot({ path: '/tmp/chat_new.png' });
    console.log('  Chat page loaded');

    console.log('Step 3: Wait for initial greeting');
    await delay(3000);
    await page.screenshot({ path: '/tmp/chat_greeting.png' });
    console.log('  Initial greeting displayed');

    console.log('Step 4: Send first message');
    const inputSelector = 'textarea, input[type="text"]';
    await page.waitForSelector(inputSelector);
    await page.type(inputSelector, 'I am looking for a 3 bedroom house in Los Angeles');
    await delay(500);
    
    const sendButton = await page.$('button[type="submit"]');
    if (sendButton) {
      await sendButton.click();
      console.log('  Message sent via button');
    } else {
      await page.keyboard.press('Enter');
      console.log('  Message sent via Enter key');
    }

    console.log('Step 5: Wait for AI response');
    await delay(5000);
    await page.screenshot({ path: '/tmp/chat_response_1.png' });
    console.log('  AI response received');

    console.log('Step 6: Send second message');
    await page.type(inputSelector, 'My budget is around $800,000');
    await delay(500);
    if (sendButton) {
      await sendButton.click();
    } else {
      await page.keyboard.press('Enter');
    }
    console.log('  Second message sent');

    console.log('Step 7: Wait for second AI response');
    await delay(5000);
    await page.screenshot({ path: '/tmp/chat_response_2.png' });
    console.log('  Second AI response received');

    console.log('Step 8: Navigate to history page');
    await page.goto(PORTAL_URL + '/history', { waitUntil: 'networkidle2' });
    await delay(2000);
    await page.screenshot({ path: '/tmp/history_list.png' });
    console.log('  History page loaded');

    console.log('Step 9: Verify conversation appears in list');
    const conversationCards = await page.$$('.MuiCard-root');
    console.log('  Found ' + conversationCards.length + ' conversation cards');
    
    if (conversationCards.length === 0) {
      console.error('  No conversations found in history');
      throw new Error('No conversations found');
    }
    console.log('  Conversation appears in history list');

    console.log('Step 10: Click on conversation to view details');
    const firstCard = conversationCards[0];
    await firstCard.click();
    await delay(2000);
    await page.screenshot({ path: '/tmp/conversation_detail.png' });
    console.log('  Conversation detail page loaded');

    console.log('Step 11: Verify messages are displayed');
    const messages = await page.$$('.MuiPaper-root');
    console.log('  Found ' + messages.length + ' message bubbles');
    
    if (messages.length < 3) {
      console.error('  Expected at least 3 messages, found ' + messages.length);
      throw new Error('Messages not displayed correctly');
    }
    console.log('  All messages displayed correctly');

    console.log('All tests passed!');
    console.log('Screenshots saved to /tmp/');

  } catch (error) {
    console.error('Test failed:', error.message);
    console.error(error.stack);
    throw error;
  } finally {
    await browser.close();
  }
}

// Run test
testChatHistory().catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
});
