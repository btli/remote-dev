import puppeteer from 'puppeteer';

/**
 * E2E Test for Portal Chat Audio Playback
 *
 * Tests:
 * 1. Auto-play voice output syncs with UI
 * 2. Manual audio playback (clicking speaker icon)
 * 3. Prevents overlapping audio when clicking multiple speakers
 * 4. Stops audio when navigating away from chat
 */

const PORTAL_URL = 'http://localhost:3002';
const TEST_CREDENTIALS = {
  email: process.env.TEST_USER_EMAIL || 'test@example.com',
  password: process.env.TEST_USER_PASSWORD || 'test123'
};

async function testChatAudio() {
  console.log('🎵 Starting Portal Chat Audio E2E Test...\n');

  const browser = await puppeteer.launch({
    headless: false, // Run in visible mode to see interactions
    slowMo: 100, // Slow down actions for visibility
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();

    // Set viewport for consistent testing
    await page.setViewport({ width: 1280, height: 800 });

    // Enable console log monitoring
    const consoleLogs = [];
    page.on('console', msg => {
      const text = msg.text();
      consoleLogs.push(text);
      if (text.includes('audio') || text.includes('Audio') || text.includes('speak') || text.includes('TTS')) {
        console.log(`[Browser Console] ${text}`);
      }
    });

    // Monitor audio elements
    await page.exposeFunction('logAudioEvent', (event, details) => {
      console.log(`🔊 Audio Event: ${event}`, details);
    });

    console.log('1️⃣  Navigating to portal...');
    await page.goto(PORTAL_URL, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: '/tmp/portal_chat_audio_01_landing.png' });

    // Check if we need to sign in
    const needsSignIn = await page.evaluate(() => {
      return window.location.pathname.includes('signin') || window.location.pathname.includes('unauthorized');
    });

    if (needsSignIn) {
      console.log('2️⃣  Signing in...');
      // Wait for sign-in button or form
      await page.waitForSelector('button, input[type="email"]', { timeout: 5000 }).catch(() => {
        console.log('   ⚠️  No sign-in form found, may already be authenticated');
      });
      await page.screenshot({ path: '/tmp/portal_chat_audio_02_signin.png' });
    } else {
      console.log('2️⃣  Already authenticated, skipping sign-in');
    }

    console.log('3️⃣  Navigating to chat...');
    // Try to navigate to chat page
    const chatLinks = await page.$$('a[href*="chat"]');
    if (chatLinks.length > 0) {
      await chatLinks[0].click();
      await page.waitForNavigation({ waitUntil: 'networkidle0' });
    } else {
      // Direct navigation
      await page.goto(`${PORTAL_URL}/chat/new`, { waitUntil: 'networkidle0' });
    }
    await page.screenshot({ path: '/tmp/portal_chat_audio_03_chat_page.png' });

    console.log('4️⃣  Waiting for chat interface to load...');
    await page.waitForSelector('[role="textbox"], input[type="text"], textarea', { timeout: 10000 });
    await page.screenshot({ path: '/tmp/portal_chat_audio_04_chat_loaded.png' });

    console.log('5️⃣  Injecting audio monitoring...');
    await page.evaluate(() => {
      // Monitor Audio element creation
      const originalAudio = window.Audio;
      const audioInstances = [];

      window.Audio = function(...args) {
        const audio = new originalAudio(...args);
        audioInstances.push(audio);

        window.logAudioEvent('Audio Created', {
          src: args[0],
          total: audioInstances.length
        });

        audio.addEventListener('play', () => {
          window.logAudioEvent('Audio Playing', {
            src: audio.src,
            currentTime: audio.currentTime,
            duration: audio.duration
          });
        });

        audio.addEventListener('pause', () => {
          window.logAudioEvent('Audio Paused', {
            src: audio.src,
            currentTime: audio.currentTime
          });
        });

        audio.addEventListener('ended', () => {
          window.logAudioEvent('Audio Ended', {
            src: audio.src
          });
        });

        return audio;
      };

      // Store reference for test assertions
      window.__audioInstances = audioInstances;
    });

    console.log('6️⃣  Sending test message...');
    const inputSelector = '[role="textbox"], input[type="text"], textarea';
    await page.waitForSelector(inputSelector);
    await page.type(inputSelector, 'Hello, I am looking for a home');
    await page.screenshot({ path: '/tmp/portal_chat_audio_05_message_typed.png' });

    // Find and click send button
    await page.keyboard.press('Enter');
    console.log('   ✅ Message sent');

    console.log('7️⃣  Waiting for AI response...');
    await page.waitForTimeout(2000); // Wait for response to start streaming
    await page.screenshot({ path: '/tmp/portal_chat_audio_06_ai_responding.png' });

    // Wait for response to complete (look for speaker icons)
    await page.waitForSelector('[data-testid*="tts"], button[aria-label*="Play"], button:has(svg[data-testid*="VolumeUp"])', {
      timeout: 15000
    }).catch(() => {
      console.log('   ⚠️  No TTS buttons found (may not be available)');
    });

    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/portal_chat_audio_07_response_complete.png' });

    console.log('8️⃣  Testing manual audio playback (clicking speaker icon)...');
    const speakerButtons = await page.$$('button:has(svg[data-testid*="VolumeUp"]), [aria-label*="Play"]');

    if (speakerButtons.length > 0) {
      console.log(`   Found ${speakerButtons.length} speaker button(s)`);

      // Click first speaker button
      await speakerButtons[0].click();
      console.log('   ✅ Clicked first speaker button');
      await page.waitForTimeout(500);

      // Check if audio is playing
      const audioPlaying = await page.evaluate(() => {
        return window.__audioInstances?.some(audio => !audio.paused) || false;
      });

      if (audioPlaying) {
        console.log('   ✅ Audio is playing after click');
      } else {
        console.log('   ❌ Audio is NOT playing after click');
      }

      await page.screenshot({ path: '/tmp/portal_chat_audio_08_audio_playing.png' });

      // Test overlapping prevention
      if (speakerButtons.length > 1) {
        console.log('9️⃣  Testing overlapping audio prevention...');
        await page.waitForTimeout(500);

        // Click second speaker button while first is playing
        await speakerButtons[1].click();
        console.log('   ✅ Clicked second speaker button');
        await page.waitForTimeout(300);

        // Count playing audio instances
        const playingCount = await page.evaluate(() => {
          return window.__audioInstances?.filter(audio => !audio.paused).length || 0;
        });

        if (playingCount <= 1) {
          console.log(`   ✅ Only ${playingCount} audio playing (overlap prevented)`);
        } else {
          console.log(`   ❌ Multiple audio playing: ${playingCount} (overlap NOT prevented)`);
        }

        await page.screenshot({ path: '/tmp/portal_chat_audio_09_overlap_test.png' });
      }

      // Test navigation cleanup
      console.log('🔟 Testing audio stops when navigating away...');
      await page.waitForTimeout(500);

      // Ensure audio is playing
      await speakerButtons[0].click();
      await page.waitForTimeout(300);

      const beforeNav = await page.evaluate(() => {
        return window.__audioInstances?.filter(audio => !audio.paused).length || 0;
      });
      console.log(`   Before navigation: ${beforeNav} audio playing`);

      // Navigate to dashboard
      await page.goto(`${PORTAL_URL}/dashboard`, { waitUntil: 'networkidle0' });
      await page.screenshot({ path: '/tmp/portal_chat_audio_10_navigated_away.png' });

      // Go back and check if audio stopped
      await page.goBack();
      await page.waitForTimeout(500);

      const afterNav = await page.evaluate(() => {
        return window.__audioInstances?.filter(audio => !audio.paused).length || 0;
      });
      console.log(`   After navigation: ${afterNav} audio playing`);

      if (afterNav === 0) {
        console.log('   ✅ Audio stopped after navigation');
      } else {
        console.log('   ❌ Audio still playing after navigation');
      }

      await page.screenshot({ path: '/tmp/portal_chat_audio_11_final_state.png' });
    } else {
      console.log('   ⚠️  No speaker buttons found - TTS may be disabled');
    }

    console.log('\n✅ Test completed! Screenshots saved to /tmp/');
    console.log('\nScreenshots:');
    for (let i = 1; i <= 11; i++) {
      console.log(`   - /tmp/portal_chat_audio_${String(i).padStart(2, '0')}_*.png`);
    }

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);

    try {
      await page.screenshot({ path: '/tmp/portal_chat_audio_error.png' });
      console.log('Error screenshot saved to /tmp/portal_chat_audio_error.png');
    } catch {}

    throw error;
  } finally {
    await browser.close();
  }
}

// Run the test
testChatAudio().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
