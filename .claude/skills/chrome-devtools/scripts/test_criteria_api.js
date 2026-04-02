import puppeteer from 'puppeteer';

async function testCriteriaAPI() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Navigate to app
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });

  // Create session cookie
  const sessionData = await page.evaluate(() => {
    const SESSION_COOKIE_NAME = 'kaelyn_session_id';
    const SESSION_STORAGE_KEY = 'kaelyn_session_id';

    let sessionId = localStorage.getItem(SESSION_STORAGE_KEY);

    if (!sessionId) {
      sessionId = 'test-session-' + Date.now() + '-' + Math.random().toString(36).substring(7);
      localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
      document.cookie = `${SESSION_COOKIE_NAME}=${sessionId}; path=/; max-age=31536000; SameSite=Lax`;
    }

    return { sessionId, cookies: document.cookie };
  });

  console.log('✓ Session created:', sessionData.sessionId);

  // Step 1: Create a conversation
  const createConvResponse = await page.evaluate(async () => {
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Test Conversation for Criteria Extraction'
      })
    });

    const data = await res.json();
    return { status: res.status, data };
  });

  console.log('\n✓ Conversation created:', {
    status: createConvResponse.status,
    conversationId: createConvResponse.data?.id || createConvResponse.data?.conversation?.id
  });

  if (createConvResponse.status !== 200 && createConvResponse.status !== 201) {
    console.error('Failed to create conversation:', createConvResponse);
    await browser.close();
    return;
  }

  const conversationId = createConvResponse.data?.id || createConvResponse.data?.conversation?.id;

  // Step 2: Test criteria extraction API
  const testMessage = "I want a 3 bedroom house in Pasadena under $1 million with a pool";

  const extractResponse = await page.evaluate(async (message, convId) => {
    const res = await fetch('/api/criteria/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversationThreadId: convId,
        message: message,
        messageId: 'msg-' + Date.now()
      })
    });

    const data = await res.json();
    return { status: res.status, data };
  }, testMessage, conversationId);

  console.log('\n✓ Criteria Extraction Response:');
  console.log('  Status:', extractResponse.status);
  console.log('  Success:', extractResponse.data?.success);

  if (extractResponse.data?.data) {
    console.log('  Extracted Criteria:', JSON.stringify(extractResponse.data.data.criteria, null, 2));
    console.log('  Changed Fields:', extractResponse.data.data.changedFields);
    console.log('  Version:', extractResponse.data.data.version);
  } else if (extractResponse.data?.error) {
    console.log('  Error:', extractResponse.data.error);
  }

  // Step 3: Get criteria to verify it was saved
  const getCriteriaResponse = await page.evaluate(async (convId) => {
    const res = await fetch(`/api/criteria/extract?conversationThreadId=${convId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    });

    const data = await res.json();
    return { status: res.status, data };
  }, conversationId);

  console.log('\n✓ Get Criteria Response:');
  console.log('  Status:', getCriteriaResponse.status);
  if (getCriteriaResponse.data?.data) {
    console.log('  Saved Criteria:', JSON.stringify(getCriteriaResponse.data.data.criteria, null, 2));
  }

  console.log('\n========================================');
  console.log('Feature 014 Test Complete!');
  console.log('========================================');

  await browser.close();
}

testCriteriaAPI().catch(console.error);
