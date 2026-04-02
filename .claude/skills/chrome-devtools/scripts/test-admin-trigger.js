/**
 * E2E Test: Trigger job from admin UI
 */

import puppeteer from 'puppeteer';

async function testAdminTrigger() {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  try {
    console.log('\n=== Test 1: Navigate to Ingestion Page ===');
    await page.goto('http://localhost:3002/ingestion', {
      waitUntil: 'networkidle0',
      timeout: 30000
    });
    await page.screenshot({ path: '/tmp/ingestion-page.png', fullPage: true });
    console.log('✅ Ingestion page loaded');

    console.log('\n=== Test 2: Look for Trigger Button ===');
    const triggerButton = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const triggerBtn = buttons.find(btn =>
        btn.textContent && (btn.textContent.toLowerCase().includes('trigger') ||
                           btn.textContent.toLowerCase().includes('start') ||
                           btn.textContent.toLowerCase().includes('new'))
      );
      return {
        found: !!triggerBtn,
        text: triggerBtn?.textContent || null
      };
    });

    console.log('Trigger button found:', triggerButton.found);
    if (triggerButton.text) {
      console.log('Button text:', triggerButton.text);
    }

    console.log('\n=== Test 3: Check for Input Fields ===');
    const formFields = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input, select, textarea');
      return Array.from(inputs).map(el => ({
        type: el.tagName,
        name: el.getAttribute('name'),
        id: el.getAttribute('id'),
        placeholder: el.getAttribute('placeholder'),
        label: el.labels?.[0]?.textContent || null
      }));
    });

    console.log('Form fields found:', formFields.length);
    formFields.forEach(field => {
      console.log('  -', field.type, field.name || field.id || field.placeholder || field.label);
    });

    console.log('\n=== Test 4: Check Page Content ===');
    const pageContent = await page.evaluate(() => {
      return {
        title: document.title,
        headings: Array.from(document.querySelectorAll('h1, h2, h3')).map(h => h.textContent),
        links: Array.from(document.querySelectorAll('a')).slice(0, 10).map(a => ({
          text: a.textContent,
          href: a.getAttribute('href')
        }))
      };
    });

    console.log('Page title:', pageContent.title);
    console.log('Headings:', pageContent.headings);
    console.log('Links:', pageContent.links);

    console.log('\n=== Test Complete ===');
    console.log('Screenshot saved to /tmp/ingestion-page.png');

    console.log('\nBrowser will stay open for 5 seconds...');
    await page.waitForTimeout(5000);

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await page.screenshot({ path: '/tmp/test-trigger-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

testAdminTrigger().catch(console.error);
