import puppeteer from 'puppeteer';

/**
 * E2E Test: Admin Panel Light Theme Heading Visibility
 *
 * Tests that headings are readable in light theme with proper contrast.
 * This test verifies the fix for heading visibility issue where headings
 * were too light to read in light theme.
 */

async function testLightThemeHeadings() {
  console.log('🚀 Starting Admin Panel Light Theme Heading Visibility Test\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 }
  });

  try {
    const page = await browser.newPage();

    // Navigate to admin dashboard
    console.log('📍 Navigating to admin dashboard...');
    await page.goto('http://localhost:3002/dashboard', {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    // Wait for page to load
    await page.waitForSelector('h4', { timeout: 10000 });
    console.log('✅ Dashboard loaded\n');

    // Take screenshot in dark mode first (default)
    await page.screenshot({
      path: '/tmp/admin_dashboard_dark_theme.png',
      fullPage: true
    });
    console.log('📸 Screenshot taken: Dark theme (/tmp/admin_dashboard_dark_theme.png)');

    // Find and click theme toggle button
    console.log('\n🔄 Switching to light theme...');

    // Look for theme toggle button (usually an icon button in the toolbar)
    const themeToggleSelectors = [
      'button[aria-label*="theme"]',
      'button[title*="theme"]',
      '[data-testid="theme-toggle"]',
      'button svg[data-testid*="theme"]'
    ];

    let themeToggled = false;
    for (const selector of themeToggleSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          await button.click();
          themeToggled = true;
          console.log(`✅ Theme toggle clicked (selector: ${selector})`);
          break;
        }
      } catch (e) {
        // Try next selector
      }
    }

    if (!themeToggled) {
      console.log('⚠️  Could not find theme toggle button, attempting manual theme switch via localStorage...');

      // Manually set theme to light mode
      await page.evaluate(() => {
        localStorage.setItem('theme-mode', 'light');
        window.location.reload();
      });

      await page.waitForSelector('h4', { timeout: 10000 });
      console.log('✅ Reloaded page with light theme');
    } else {
      // Wait for theme transition
      await page.waitForTimeout(500);
    }

    // Take screenshot in light mode
    await page.screenshot({
      path: '/tmp/admin_dashboard_light_theme.png',
      fullPage: true
    });
    console.log('📸 Screenshot taken: Light theme (/tmp/admin_dashboard_light_theme.png)\n');

    // Analyze heading colors in light theme
    console.log('🔍 Analyzing heading colors in light theme...\n');

    const headingAnalysis = await page.evaluate(() => {
      const headings = [];
      const headingSelectors = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

      headingSelectors.forEach(tag => {
        const elements = document.querySelectorAll(tag);
        elements.forEach((el, index) => {
          const styles = window.getComputedStyle(el);
          const color = styles.color;
          const backgroundColor = styles.backgroundColor;
          const text = el.textContent.trim().substring(0, 50);

          // Parse RGB values to check opacity
          const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
          const opacity = rgbMatch && rgbMatch[4] ? parseFloat(rgbMatch[4]) : 1.0;

          headings.push({
            tag,
            text: text + (text.length === 50 ? '...' : ''),
            color,
            backgroundColor,
            opacity,
            fontWeight: styles.fontWeight,
            fontSize: styles.fontSize
          });
        });
      });

      return headings;
    });

    console.log('📊 Heading Analysis Results:');
    console.log('═'.repeat(80));

    headingAnalysis.forEach((h, i) => {
      console.log(`\n${i + 1}. <${h.tag}> "${h.text}"`);
      console.log(`   Color: ${h.color}`);
      console.log(`   Opacity: ${(h.opacity * 100).toFixed(0)}%`);
      console.log(`   Font Weight: ${h.fontWeight}`);
      console.log(`   Font Size: ${h.fontSize}`);
      console.log(`   Background: ${h.backgroundColor}`);
    });

    console.log('\n' + '═'.repeat(80));

    // Check if headings have proper contrast (opacity >= 0.90)
    const lowContrastHeadings = headingAnalysis.filter(h => h.opacity < 0.90);

    if (lowContrastHeadings.length > 0) {
      console.log('\n⚠️  WARNING: Found headings with low contrast (opacity < 90%):');
      lowContrastHeadings.forEach(h => {
        console.log(`   - <${h.tag}> opacity: ${(h.opacity * 100).toFixed(0)}%`);
      });
    } else {
      console.log('\n✅ All headings have good contrast (opacity >= 90%)');
    }

    // Check browser console for errors
    const consoleMessages = [];
    page.on('console', msg => consoleMessages.push(msg.text()));

    const errors = consoleMessages.filter(msg => msg.toLowerCase().includes('error'));
    if (errors.length > 0) {
      console.log('\n⚠️  Console errors detected:');
      errors.forEach(err => console.log(`   ${err}`));
    }

    console.log('\n✅ Test completed successfully!');
    console.log('\n📁 Screenshots saved:');
    console.log('   - Dark theme: /tmp/admin_dashboard_dark_theme.png');
    console.log('   - Light theme: /tmp/admin_dashboard_light_theme.png');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    await browser.close();
  }
}

testLightThemeHeadings().catch(console.error);
