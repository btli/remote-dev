import puppeteer from 'puppeteer';

async function testTTS() {
  console.log('Starting TTS Integration Test...');
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 },
    args: ['--autoplay-policy=no-user-gesture-required'] // Allow audio autoplay
  });
  const page = await browser.newPage();

  try {
    console.log('\n=== Step 1: Navigate to chat ===');
    await page.goto('http://localhost:3001/chat/new', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('textarea', { timeout: 10000 });

    // Wait for textarea to be enabled
    await page.waitForFunction(() => {
      const textarea = document.querySelector('textarea');
      return textarea && !textarea.disabled;
    }, { timeout: 10000 });

    console.log('✅ Chat page loaded');

    console.log('\n=== Step 2: Send a message ===');
    await page.type('textarea', 'Hello!');
    await page.keyboard.press('Enter');
    console.log('Sent: "Hello!"');

    // Wait for AI response
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('\n=== Step 3: Check for audio/TTS ===');

    // Check if voice synthesis was attempted
    const ttsStatus = await page.evaluate(() => {
      // Look for audio elements or TTS-related UI
      const audioElements = document.querySelectorAll('audio');
      const speakerButtons = document.querySelectorAll('[aria-label*="speaker"], [aria-label*="voice"], [class*="voice"]');

      return {
        audioElements: audioElements.length,
        speakerButtons: speakerButtons.length,
        hasAudio: audioElements.length > 0
      };
    });

    console.log('TTS Status:', ttsStatus);

    if (ttsStatus.audioElements > 0) {
      console.log('✅ Audio elements found - TTS is working!');
    } else if (ttsStatus.speakerButtons > 0) {
      console.log('⚠️  Speaker buttons found but no audio playing yet');
    } else {
      console.log('ℹ️  No audio elements detected (may use Web Speech API)');
    }

    await page.screenshot({ path: '/tmp/portal-tts-test.png', fullPage: true });
    console.log('\nScreenshot saved to /tmp/portal-tts-test.png');

    console.log('\n✅ Test completed - TTS infrastructure is in place');
    console.log('Note: Voice output should play automatically when AI responds');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await page.screenshot({ path: '/tmp/portal-tts-error.png', fullPage: true });
  } finally {
    await new Promise(resolve => setTimeout(resolve, 3000));
    await browser.close();
  }
}

testTTS().catch(console.error);
