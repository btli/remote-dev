#!/usr/bin/env node
/**
 * Trigger San Marino ingestion via admin portal and monitor backend API logs
 */
import puppeteer from 'puppeteer';
import { spawn } from 'child_process';

async function main() {
  console.error('🚀 Starting San Marino ingestion trigger...\n');

  // Start monitoring backend API logs in the background
  console.error('📡 Starting backend API log monitor...\n');
  const logMonitor = spawn('bash', ['-c',
    'tail -f /Users/bryanli/Projects/joyfulhouse/websites/kaelyn.ai/backend/logs/*.log 2>/dev/null || echo "No log files found"'
  ]);

  logMonitor.stdout.on('data', (data) => {
    const line = data.toString();
    // Filter for relevant log lines
    if (line.includes('query:') ||
        line.includes('Target URL') ||
        line.includes('target') ||
        line.includes('San Marino') ||
        line.includes('listings') ||
        line.includes('searchQuery')) {
      console.error('📋 LOG:', line.trim());
    }
  });

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 }
  });

  const page = await browser.newPage();

  try {
    // Step 1: Navigate to admin portal
    console.error('[1/3] Navigating to admin portal...');
    await page.goto('http://localhost:3002', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait for ingestion page to load
    await page.waitForSelector('body', { timeout: 10000 });

    // Take screenshot of current page
    await page.screenshot({ path: '/tmp/admin-portal-home.png', fullPage: true });
    console.error('📸 Screenshot saved: /tmp/admin-portal-home.png');

    // Step 2: Find and click the "Trigger Ingestion" or similar button
    console.error('[2/3] Looking for ingestion controls...');

    // Check page title and URL
    const pageTitle = await page.title();
    const currentUrl = page.url();
    console.error(`Page title: ${pageTitle}`);
    console.error(`Current URL: ${currentUrl}`);

    // Look for navigation links or buttons related to ingestion
    const navigationInfo = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a, button')).filter(el => {
        const text = el.textContent.toLowerCase();
        return text.includes('ingest') || text.includes('import') || text.includes('sync');
      });

      return links.map(link => ({
        tagName: link.tagName,
        text: link.textContent.trim(),
        href: link.getAttribute('href'),
        className: link.className
      }));
    });

    console.error('\nIngestion-related elements found:');
    console.error(JSON.stringify(navigationInfo, null, 2));

    // If we find an ingestion page link, click it
    if (navigationInfo.length > 0) {
      console.error('\n[3/3] Triggering San Marino ingestion...');

      // Click the first ingestion-related link
      await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a, button')).filter(el => {
          const text = el.textContent.toLowerCase();
          return text.includes('ingest') || text.includes('import') || text.includes('sync');
        });
        if (links[0]) {
          links[0].click();
        }
      });

      // Wait for navigation
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});

      // Take screenshot of ingestion page
      await page.screenshot({ path: '/tmp/admin-ingestion-page.png', fullPage: true });
      console.error('📸 Screenshot saved: /tmp/admin-ingestion-page.png');

      // Look for San Marino or city selection
      const cityControls = await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('button, select, input, [role="combobox"]'));
        return elements.map(el => ({
          tagName: el.tagName,
          type: el.getAttribute('type'),
          text: el.textContent?.trim().substring(0, 100),
          placeholder: el.getAttribute('placeholder'),
          value: el.value,
          id: el.id,
          name: el.name
        })).filter(el =>
          el.text?.toLowerCase().includes('san marino') ||
          el.text?.toLowerCase().includes('city') ||
          el.placeholder?.toLowerCase().includes('city')
        );
      });

      console.error('\nCity/San Marino controls found:');
      console.error(JSON.stringify(cityControls, null, 2));

      // Look for any "Run" or "Start" buttons
      const actionButtons = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button')).filter(el => {
          const text = el.textContent.toLowerCase();
          return text.includes('run') || text.includes('start') || text.includes('trigger');
        });

        return buttons.map(btn => ({
          text: btn.textContent.trim(),
          disabled: btn.disabled,
          className: btn.className
        }));
      });

      console.error('\nAction buttons found:');
      console.error(JSON.stringify(actionButtons, null, 2));

      // Wait for logs to appear (give ingestion some time to start)
      console.error('\n⏳ Waiting for backend API logs (30 seconds)...\n');
      await page.waitForTimeout(30000);

    } else {
      console.error('\n❌ No ingestion-related controls found');

      // Print all page content for debugging
      const pageHTML = await page.evaluate(() => document.body.innerHTML);
      console.error('\nPage HTML preview (first 1000 chars):');
      console.error(pageHTML.substring(0, 1000));
    }

    // Final screenshot
    await page.screenshot({ path: '/tmp/admin-final.png', fullPage: true });
    console.error('\n📸 Final screenshot saved: /tmp/admin-final.png');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    await page.screenshot({ path: '/tmp/admin-error.png', fullPage: true });
    console.error('📸 Error screenshot saved: /tmp/admin-error.png');
  } finally {
    // Keep browser open for inspection
    console.error('\n\n🔍 Browser will stay open for 30 seconds for manual inspection...');
    await page.waitForTimeout(30000);

    logMonitor.kill();
    await browser.close();
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
