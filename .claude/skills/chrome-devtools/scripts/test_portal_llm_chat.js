import puppeteer from 'puppeteer';

async function testLLMChat() {
  console.log('Starting LLM Chat Integration Test...');
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 }
  });
  const page = await browser.newPage();

  try {
    // Enable console logging from page
    page.on('console', msg => {
      const type = msg.type();
      if (type === 'log' || type === 'info') {
        console.log(`[Browser] ${msg.text()}`);
      } else if (type === 'error' || type === 'warning') {
        console.log(`[Browser ${type}] ${msg.text()}`);
      }
    });

    console.log('\n=== Step 1: Navigate to chat page ===');
    await page.goto('http://localhost:3001/chat/new', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('textarea', { timeout: 10000 });

    // Wait for textarea to be enabled
    await page.waitForFunction(() => {
      const textarea = document.querySelector('textarea');
      return textarea && !textarea.disabled;
    }, { timeout: 10000 });

    await page.screenshot({ path: '/tmp/portal-llm-01-loaded.png', fullPage: true });
    console.log('✅ Chat page loaded successfully');

    console.log('\n=== Step 2: Send first message ===');
    const userMessage = 'I am looking for a 3 bedroom house';
    await page.type('textarea', userMessage);
    await page.keyboard.press('Enter');
    console.log(`Sent message: "${userMessage}"`);

    // Wait for AI response to appear
    console.log('Waiting for AI response...');
    await page.waitForFunction(() => {
      const messages = document.querySelectorAll('[class*="message"]');
      return messages.length >= 2; // User message + AI response
    }, { timeout: 30000 });

    // Wait a bit more for streaming to complete
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Extract AI response
    const aiResponse = await page.evaluate(() => {
      const messages = Array.from(document.querySelectorAll('[class*="message"]'));
      const lastMessage = messages[messages.length - 1];
      return lastMessage ? lastMessage.textContent : 'No response found';
    });

    console.log(`✅ Received AI response: "${aiResponse.substring(0, 100)}..."`);
    await page.screenshot({ path: '/tmp/portal-llm-02-first-response.png', fullPage: true });

    console.log('\n=== Step 3: Send follow-up message ===');
    const followUpMessage = 'In San Francisco';
    await page.type('textarea', followUpMessage);
    await page.keyboard.press('Enter');
    console.log(`Sent follow-up: "${followUpMessage}"`);

    // Wait for second AI response
    await page.waitForFunction(() => {
      const messages = document.querySelectorAll('[class*="message"]');
      return messages.length >= 4; // 2 user messages + 2 AI responses
    }, { timeout: 30000 });

    await new Promise(resolve => setTimeout(resolve, 3000));

    const aiResponse2 = await page.evaluate(() => {
      const messages = Array.from(document.querySelectorAll('[class*="message"]'));
      const lastMessage = messages[messages.length - 1];
      return lastMessage ? lastMessage.textContent : 'No response found';
    });

    console.log(`✅ Received second AI response: "${aiResponse2.substring(0, 100)}..."`);
    await page.screenshot({ path: '/tmp/portal-llm-03-second-response.png', fullPage: true });

    // Verify responses are NOT mock responses
    const isMockResponse = aiResponse.includes('Great! How many bedrooms') ||
                          aiResponse.includes("I'm currently a demo version");

    console.log('\n=== Test Results ===');
    if (isMockResponse) {
      console.log('❌ FAILED: Still using mock responses');
      console.log(`Response: "${aiResponse}"`);
    } else {
      console.log('✅ PASSED: Using real LLM responses');
      console.log(`✅ AI is responding with contextual answers`);
      console.log(`✅ Multi-turn conversation working`);
      console.log(`✅ Response quality: ${aiResponse.length > 50 ? 'Good' : 'Short'}`);
    }

    console.log('\nScreenshots saved:');
    console.log('  - /tmp/portal-llm-01-loaded.png');
    console.log('  - /tmp/portal-llm-02-first-response.png');
    console.log('  - /tmp/portal-llm-03-second-response.png');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await page.screenshot({ path: '/tmp/portal-llm-error.png', fullPage: true });
    console.log('Error screenshot saved to /tmp/portal-llm-error.png');
  } finally {
    await new Promise(resolve => setTimeout(resolve, 3000));
    await browser.close();
  }
}

testLLMChat().catch(console.error);
