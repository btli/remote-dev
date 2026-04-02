import puppeteer from 'puppeteer';

/**
 * Inspect the Cities column alignment in the run history table
 */

async function inspectCitiesAlignment() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 },
  });

  try {
    const page = await browser.newPage();

    console.log('[Inspect] Navigating to ingestion page...');
    await page.goto('http://localhost:3002/ingestion', { waitUntil: 'networkidle0' });

    // Wait for the DataGrid to load
    console.log('[Inspect] Waiting for DataGrid...');
    await page.waitForSelector('.MuiDataGrid-root', { timeout: 30000 });

    // Wait for data to load (wait for at least one row with targetCities)
    console.log('[Inspect] Waiting for data to load...');
    await page.waitForSelector('[data-field="targetCities"]', { timeout: 30000 });

    // Wait a bit more for rendering to stabilize
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Take initial screenshot
    await page.screenshot({ path: '/tmp/cities_before.png', fullPage: true });
    console.log('[Inspect] Screenshot saved: /tmp/cities_before.png');

    // Find the Cities column DATA cells (not the header)
    const citiesCells = await page.$$('.MuiDataGrid-row [data-field="targetCities"]');

    if (citiesCells.length === 0) {
      console.log('[Inspect] ⚠️ No Cities data cells found');
      return;
    }

    console.log(`[Inspect] Found ${citiesCells.length} Cities data cells`);

    // Inspect the first Cities DATA cell (skip header)
    const firstCell = citiesCells[0];

    const cellInfo = await firstCell.evaluate((el) => {
      const box = el.querySelector('.MuiBox-root');
      const div = el.querySelector('div');
      const computedStyle = box ? window.getComputedStyle(box) : null;
      const divComputedStyle = div ? window.getComputedStyle(div) : null;

      return {
        cellHeight: el.offsetHeight,
        cellDisplay: window.getComputedStyle(el).display,
        cellAlignItems: window.getComputedStyle(el).alignItems,
        cellHTML: el.innerHTML.substring(0, 500), // First 500 chars of HTML
        hasBox: !!box,
        hasDiv: !!div,
        boxHeight: box ? box.offsetHeight : null,
        boxDisplay: computedStyle ? computedStyle.display : null,
        boxAlignItems: computedStyle ? computedStyle.alignItems : null,
        boxJustifyContent: computedStyle ? computedStyle.justifyContent : null,
        boxFlexWrap: computedStyle ? computedStyle.flexWrap : null,
        boxPaddingTop: computedStyle ? computedStyle.paddingTop : null,
        boxPaddingBottom: computedStyle ? computedStyle.paddingBottom : null,
        divDisplay: divComputedStyle ? divComputedStyle.display : null,
        divAlignItems: divComputedStyle ? divComputedStyle.alignItems : null,
        divJustifyContent: divComputedStyle ? divComputedStyle.justifyContent : null,
      };
    });

    console.log('\n[Inspect] Cities Cell Styles:');
    console.log('  Cell height:', cellInfo.cellHeight);
    console.log('  Cell display:', cellInfo.cellDisplay);
    console.log('  Cell alignItems:', cellInfo.cellAlignItems);
    console.log('\n[Inspect] Cell HTML (first 500 chars):');
    console.log(cellInfo.cellHTML);
    console.log('\n[Inspect] Box (Chip container) Styles:');
    console.log('  Has Box:', cellInfo.hasBox);
    console.log('  Has Div:', cellInfo.hasDiv);
    console.log('  Box height:', cellInfo.boxHeight);
    console.log('  Box display:', cellInfo.boxDisplay);
    console.log('  Box alignItems:', cellInfo.boxAlignItems);
    console.log('  Box justifyContent:', cellInfo.boxJustifyContent);
    console.log('  Box flexWrap:', cellInfo.boxFlexWrap);
    console.log('  Box paddingTop:', cellInfo.boxPaddingTop);
    console.log('  Box paddingBottom:', cellInfo.boxPaddingBottom);
    console.log('\n[Inspect] Div (direct child) Styles:');
    console.log('  Div display:', cellInfo.divDisplay);
    console.log('  Div alignItems:', cellInfo.divAlignItems);
    console.log('  Div justifyContent:', cellInfo.divJustifyContent);

    // Check DataGrid cell styling
    const gridCellStyle = await page.evaluate(() => {
      const cell = document.querySelector('[data-field="targetCities"]');
      if (!cell) return null;

      const computed = window.getComputedStyle(cell);
      return {
        padding: computed.padding,
        paddingTop: computed.paddingTop,
        paddingBottom: computed.paddingBottom,
        display: computed.display,
        alignItems: computed.alignItems,
        justifyContent: computed.justifyContent,
        height: computed.height,
      };
    });

    console.log('\n[Inspect] DataGrid Cell Styles:');
    console.log('  Padding:', gridCellStyle.padding);
    console.log('  Display:', gridCellStyle.display);
    console.log('  AlignItems:', gridCellStyle.alignItems);
    console.log('  Height:', gridCellStyle.height);

    // Highlight the Cities DATA cells
    await page.evaluate(() => {
      const cells = document.querySelectorAll('.MuiDataGrid-row [data-field="targetCities"]');
      cells.forEach(cell => {
        cell.style.outline = '2px solid red';
        const box = cell.querySelector('.MuiBox-root');
        if (box) {
          box.style.outline = '2px solid blue';
        }
        const div = cell.querySelector('div');
        if (div) {
          div.style.outline = '2px dashed green';
        }
      });
    });

    await page.screenshot({ path: '/tmp/cities_highlighted.png', fullPage: true });
    console.log('[Inspect] Highlighted screenshot: /tmp/cities_highlighted.png');
    console.log('  Red outline: DataGrid cell');
    console.log('  Blue outline: Box (chip container)');
    console.log('  Green dashed outline: Div (direct child)');

    console.log('\n[Inspect] Waiting 5 seconds for manual inspection...');
    await new Promise(resolve => setTimeout(resolve, 5000));

  } catch (error) {
    console.error('[Inspect] Error:', error);
  } finally {
    await browser.close();
  }
}

inspectCitiesAlignment().catch(console.error);
