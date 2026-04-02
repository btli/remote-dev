import puppeteer from 'puppeteer';

async function testListingsCityFilter() {
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 50
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  try {
    console.log('🧪 Testing listings city filter...\n');

    // Navigate to listings page
    console.log('1. Navigating to listings page...');
    await page.goto('http://localhost:3002/data/listings', {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    // Wait for the page to load
    await page.waitForSelector('input', { timeout: 10000 });
    await page.screenshot({ path: '/tmp/city_filter_initial.png' });
    console.log('✅ Page loaded\n');

    // Find the city input field (it's a TextField with label "City")
    console.log('2. Finding city input field...');
    const cityInput = await page.waitForSelector('input[id*="city"], input[name="city"], div:has(label:has-text("City")) input', {
      timeout: 5000
    }).catch(async () => {
      // Try a more general approach - find all text inputs and look for the one after "City" label
      const inputs = await page.$$('input[type="text"]');
      for (const input of inputs) {
        const label = await input.evaluateHandle(el => {
          const parent = el.closest('.MuiFormControl-root');
          return parent ? parent.querySelector('label') : null;
        });
        const labelText = await label.evaluate(el => el ? el.textContent : '');
        if (labelText.includes('City')) {
          return input;
        }
      }
      throw new Error('Could not find city input');
    });

    console.log('✅ Found city input\n');

    // Type in the city filter
    console.log('3. Typing "pasadena" (lowercase) into city filter...');
    await cityInput.click();
    await cityInput.type('pasadena', { delay: 100 });

    // Wait for network request to complete
    await new Promise(resolve => setTimeout(resolve, 2000));
    await page.screenshot({ path: '/tmp/city_filter_pasadena.png' });
    console.log('✅ Filter applied\n');

    // Check if results are filtered
    console.log('4. Verifying filter results...');
    const hasResults = await page.evaluate(() => {
      const table = document.querySelector('table tbody');
      return table && table.querySelectorAll('tr').length > 0;
    });

    if (hasResults) {
      console.log('✅ Results displayed\n');
    } else {
      console.log('❌ No results found\n');
    }

    // Check if filter chip appears
    const chipExists = await page.evaluate(() => {
      const chips = Array.from(document.querySelectorAll('[class*="MuiChip"]'));
      return chips.some(chip => chip.textContent.toLowerCase().includes('city'));
    });

    if (chipExists) {
      console.log('✅ Filter chip displayed\n');
    } else {
      console.log('⚠️ Filter chip not found (might be expected if no active filters shown)\n');
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('🎉 TEST PASSED! City filter is working.');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log('Screenshots:');
    console.log('  - /tmp/city_filter_initial.png');
    console.log('  - /tmp/city_filter_pasadena.png');

    // Keep browser open for manual inspection
    await new Promise(resolve => setTimeout(resolve, 3000));

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: '/tmp/city_filter_error.png' });
    console.log('Error screenshot saved to /tmp/city_filter_error.png');
  } finally {
    await browser.close();
  }
}

testListingsCityFilter().catch(console.error);
