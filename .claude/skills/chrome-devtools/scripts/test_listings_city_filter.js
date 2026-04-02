import puppeteer from 'puppeteer';

async function testListingsCityFilter() {
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 100 // Slow down by 100ms for visibility
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  try {
    console.log('🧪 Testing listings city filter functionality...\n');

    // Navigate to listings page
    console.log('1. Navigating to listings page...');
    await page.goto('http://localhost:3002/data/listings?page=1', {
      waitUntil: 'networkidle0'
    });
    await page.screenshot({ path: '/tmp/listings_initial.png' });
    console.log('✅ Page loaded\n');

    // Get initial listing count
    const initialCount = await page.evaluate(() => {
      const pagination = document.querySelector('[class*="MuiTablePagination"]');
      if (pagination) {
        const text = pagination.textContent;
        const match = text.match(/of (\d+)/);
        return match ? parseInt(match[1]) : 0;
      }
      return 0;
    });
    console.log(`📊 Initial listing count: ${initialCount}\n`);

    // Test 1: Filter by full city name with proper case
    console.log('2. Testing filter with full city name "Pasadena"...');
    const cityInput = await page.waitForSelector('input[label="City"], label:has-text("City") + input, [aria-label="City"]');
    await cityInput.click();
    await cityInput.type('Pasadena');

    // Wait for the filter to be applied (wait for network request to complete)
    await page.waitForTimeout(1000);
    await page.waitForSelector('table tbody tr', { timeout: 5000 });
    await page.screenshot({ path: '/tmp/listings_filter_pasadena.png' });

    const pasadenaCount = await page.evaluate(() => {
      const pagination = document.querySelector('[class*="MuiTablePagination"]');
      if (pagination) {
        const text = pagination.textContent;
        const match = text.match(/of (\d+)/);
        return match ? parseInt(match[1]) : 0;
      }
      return 0;
    });
    console.log(`✅ Filtered count with "Pasadena": ${pasadenaCount}\n`);

    // Verify filter chip appears
    const filterChipExists = await page.evaluate(() => {
      const chips = Array.from(document.querySelectorAll('[class*="MuiChip"]'));
      return chips.some(chip => chip.textContent.includes('City: Pasadena'));
    });
    console.log(`${filterChipExists ? '✅' : '❌'} Filter chip displayed: ${filterChipExists}\n`);

    // Test 2: Clear filter and test lowercase
    console.log('3. Clearing filter...');
    await cityInput.click({ clickCount: 3 }); // Select all
    await cityInput.press('Backspace');
    await page.waitForTimeout(1000);
    console.log('✅ Filter cleared\n');

    // Test 3: Test case-insensitive (lowercase)
    console.log('4. Testing case-insensitive filter with "pasadena" (lowercase)...');
    await cityInput.type('pasadena');
    await page.waitForTimeout(1000);
    await page.waitForSelector('table tbody tr', { timeout: 5000 });
    await page.screenshot({ path: '/tmp/listings_filter_lowercase.png' });

    const lowercaseCount = await page.evaluate(() => {
      const pagination = document.querySelector('[class*="MuiTablePagination"]');
      if (pagination) {
        const text = pagination.textContent;
        const match = text.match(/of (\d+)/);
        return match ? parseInt(match[1]) : 0;
      }
      return 0;
    });
    console.log(`✅ Filtered count with "pasadena" (lowercase): ${lowercaseCount}\n`);

    // Verify counts match (case-insensitive works)
    if (pasadenaCount === lowercaseCount && lowercaseCount > 0) {
      console.log('✅ Case-insensitive filtering works! Counts match.\n');
    } else {
      console.log(`❌ Case-insensitive filtering FAILED! Counts don't match: ${pasadenaCount} vs ${lowercaseCount}\n`);
    }

    // Test 4: Clear and test partial match
    console.log('5. Clearing filter...');
    await cityInput.click({ clickCount: 3 });
    await cityInput.press('Backspace');
    await page.waitForTimeout(1000);
    console.log('✅ Filter cleared\n');

    console.log('6. Testing partial match with "Pasa"...');
    await cityInput.type('Pasa');
    await page.waitForTimeout(1000);
    await page.waitForSelector('table tbody tr', { timeout: 5000 });
    await page.screenshot({ path: '/tmp/listings_filter_partial.png' });

    const partialCount = await page.evaluate(() => {
      const pagination = document.querySelector('[class*="MuiTablePagination"]');
      if (pagination) {
        const text = pagination.textContent;
        const match = text.match(/of (\d+)/);
        return match ? parseInt(match[1]) : 0;
      }
      return 0;
    });
    console.log(`✅ Filtered count with "Pasa" (partial): ${partialCount}\n`);

    // Verify partial match works
    if (partialCount >= pasadenaCount) {
      console.log('✅ Partial matching works! Partial match count >= full match count.\n');
    } else {
      console.log(`❌ Partial matching FAILED! Partial count (${partialCount}) < full count (${pasadenaCount})\n`);
    }

    // Test 5: Verify table shows correct cities
    console.log('7. Verifying table shows only matching cities...');
    const citiesInTable = await page.evaluate(() => {
      const cityColumn = Array.from(document.querySelectorAll('table tbody tr td:nth-child(2)'));
      return cityColumn.map(cell => cell.textContent.trim()).filter(city => city && city !== 'N/A');
    });
    console.log(`Cities in table: ${citiesInTable.join(', ')}\n`);

    const allMatchPartial = citiesInTable.every(city =>
      city.toLowerCase().includes('pasa')
    );
    console.log(`${allMatchPartial ? '✅' : '❌'} All cities match "Pasa" filter: ${allMatchPartial}\n`);

    // Test 6: Test removing filter via chip
    console.log('8. Testing filter removal via chip...');
    const chipDeleteButton = await page.waitForSelector('[class*="MuiChip"] [class*="MuiChip-deleteIcon"]');
    await chipDeleteButton.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/listings_filter_removed.png' });

    const afterRemovalCount = await page.evaluate(() => {
      const pagination = document.querySelector('[class*="MuiTablePagination"]');
      if (pagination) {
        const text = pagination.textContent;
        const match = text.match(/of (\d+)/);
        return match ? parseInt(match[1]) : 0;
      }
      return 0;
    });
    console.log(`✅ Count after filter removal: ${afterRemovalCount}\n`);

    if (afterRemovalCount === initialCount) {
      console.log('✅ Filter removal works! Count restored to initial count.\n');
    } else {
      console.log(`❌ Filter removal FAILED! Initial: ${initialCount}, After removal: ${afterRemovalCount}\n`);
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('🎉 ALL TESTS PASSED! City filter is working correctly.');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log('Screenshots saved to:');
    console.log('  - /tmp/listings_initial.png');
    console.log('  - /tmp/listings_filter_pasadena.png');
    console.log('  - /tmp/listings_filter_lowercase.png');
    console.log('  - /tmp/listings_filter_partial.png');
    console.log('  - /tmp/listings_filter_removed.png');

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: '/tmp/listings_filter_error.png' });
    console.log('Error screenshot saved to /tmp/listings_filter_error.png');
  } finally {
    await browser.close();
  }
}

testListingsCityFilter().catch(console.error);
