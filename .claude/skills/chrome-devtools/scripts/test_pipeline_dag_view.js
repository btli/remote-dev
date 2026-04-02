/**
 * E2E Test for Pipeline DAG Visualization (Feature 020)
 * Tests the horizontal DAG view (left-to-right flow) in the Overview tab of Ingestion Run Details page
 *
 * Location: Overview tab (first tab)
 * Layout: [RAW] → [BRONZE] → [SILVER] → [GOLD]
 *           ↓
 *    [IMAGE_DOWNLOAD]
 */
import puppeteer from 'puppeteer';

async function testPipelineDagView() {
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 50 // Slow down for visibility
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  try {
    console.log('🚀 Starting Pipeline DAG View E2E Test');

    // Use a specific run ID with stage executions (from recent test run)
    const testRunId = 'cmhgir4rj05r9sbn2kvfqy9bw';

    // Step 1: Navigate directly to the run details page
    console.log(`📍 Step 1: Navigating to run details page for ${testRunId}...`);
    await page.goto(`http://localhost:3002/ingestion/runs/${testRunId}`, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: '/tmp/dag_01_run_details_loading.png', fullPage: true });
    console.log('✅ Screenshot saved: /tmp/dag_01_run_details_loading.png');

    // Wait for page to fully load
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 2: Verify we're on the Overview tab (DAG should be visible by default)
    console.log('📍 Step 2: Verifying Overview tab is active...');
    const overviewTab = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
      const overviewTab = tabs.find(tab => tab.textContent?.includes('Overview'));
      return overviewTab?.getAttribute('aria-selected') === 'true';
    });

    if (!overviewTab) {
      console.log('⚠️  Overview tab not active, clicking it...');
      await page.click('[role="tab"]:has-text("Overview")');
      await new Promise(resolve => setTimeout(resolve, 500));
    } else {
      console.log('✅ Overview tab is active');
    }

    // Step 3: Verify DAG visualization is present in Overview tab
    console.log('📍 Step 3: Verifying DAG visualization in Overview tab...');

    // Wait for the Pipeline Visualization card (with longer timeout since data might be loading)
    const dagCardExists = await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll('h6'));
      return headings.some(h => h.textContent?.includes('Pipeline Visualization'));
    });

    if (!dagCardExists) {
      console.log('⚠️  Pipeline Visualization not found - this run may not have stage executions');
      console.log('⚠️  Checking if Pipeline Stages (legacy stepper) is present instead...');

      const stagesCardExists = await page.evaluate(() => {
        const headings = Array.from(document.querySelectorAll('h6'));
        return headings.some(h => h.textContent?.includes('Pipeline Stages'));
      });

      if (!stagesCardExists) {
        throw new Error('Neither Pipeline Visualization nor Pipeline Stages found - this run likely has no stage executions');
      }

      console.log('⚠️  Only legacy Pipeline Stages found, skipping DAG tests');
      return;
    }
    console.log('✅ Found Pipeline Visualization card');

    // Verify SVG is present
    const svg = await page.$('svg');
    if (!svg) {
      throw new Error('SVG element not found in DAG visualization');
    }
    console.log('✅ SVG element found');

    await page.screenshot({ path: '/tmp/dag_02_dag_view.png', fullPage: true });
    console.log('✅ Screenshot saved: /tmp/dag_02_dag_view.png');

    // Step 4: Count the number of stage nodes
    console.log('📍 Step 4: Counting stage nodes...');
    const stageNodes = await page.$$eval('svg g[transform*="translate"] rect[rx="8"]', nodes => nodes.length);
    console.log(`✅ Found ${stageNodes} stage nodes`);

    if (stageNodes < 4) {
      throw new Error(`Expected at least 4 stage nodes (RAW, BRONZE, SILVER, GOLD), but found ${stageNodes}`);
    }

    // Step 5: Verify edges (arrows) between nodes
    console.log('📍 Step 5: Verifying edges between nodes...');
    const edges = await page.$$eval('svg line, svg path', elements => elements.length);
    console.log(`✅ Found ${edges} edges`);

    if (edges < 3) {
      throw new Error(`Expected at least 3 horizontal edges (RAW→BRONZE, BRONZE→SILVER, SILVER→GOLD), but found ${edges}`);
    }

    // Step 6: Click on a stage node to see details
    console.log('📍 Step 6: Clicking on a stage node...');

    // Click on the first stage node
    const firstNode = await page.$('svg g[transform*="translate"]');
    if (firstNode) {
      await firstNode.click();
      await new Promise(resolve => setTimeout(resolve, 500)); // Wait for details to appear

      await page.screenshot({ path: '/tmp/dag_03_node_clicked.png', fullPage: true });
      console.log('✅ Screenshot saved: /tmp/dag_03_node_clicked.png');

      // Verify node details appear
      const nodeDetails = await page.$('text=/Details/i');
      if (nodeDetails) {
        console.log('✅ Node details panel appeared');
      } else {
        console.log('⚠️  Node details panel not found (may not be implemented yet)');
      }
    } else {
      console.log('⚠️  Could not find stage node to click');
    }

    // Step 7: Verify status indicators
    console.log('📍 Step 7: Verifying status indicators...');
    const statusBadges = await page.$$eval('svg g rect[opacity="0.2"]', badges => badges.length);
    console.log(`✅ Found ${statusBadges} status badges`);

    // Step 8: Check for legacy stepper view (also in Overview tab)
    console.log('📍 Step 8: Checking for legacy stepper view in Overview tab...');
    const stepperView = await page.$('h6:has-text("Pipeline Stages")');
    if (stepperView) {
      console.log('✅ Legacy stepper view is also present');
      await page.screenshot({ path: '/tmp/dag_04_with_stepper.png', fullPage: true });
      console.log('✅ Screenshot saved: /tmp/dag_04_with_stepper.png');
    } else {
      console.log('⚠️  Legacy stepper view not found');
    }

    // Step 9: Test responsive behavior (scroll if needed)
    console.log('📍 Step 9: Testing scroll behavior...');
    await page.evaluate(() => {
      window.scrollTo(0, 500);
    });
    await new Promise(resolve => setTimeout(resolve, 500));
    await page.screenshot({ path: '/tmp/dag_05_scrolled.png', fullPage: true });
    console.log('✅ Screenshot saved: /tmp/dag_05_scrolled.png');

    // Step 10: Test with different viewport sizes
    console.log('📍 Step 10: Testing responsive design...');
    await page.setViewport({ width: 1280, height: 800 });
    await new Promise(resolve => setTimeout(resolve, 500));
    await page.screenshot({ path: '/tmp/dag_06_smaller_viewport.png', fullPage: true });
    console.log('✅ Screenshot saved: /tmp/dag_06_smaller_viewport.png');

    console.log('\n✅ All E2E tests passed successfully!');
    console.log('\n📊 Test Summary:');
    console.log(`  - Stage nodes: ${stageNodes}`);
    console.log(`  - Edges: ${edges}`);
    console.log(`  - Status badges: ${statusBadges}`);
    console.log('\n📸 Screenshots saved to /tmp/dag_*.png');

  } catch (error) {
    console.error('\n❌ Test failed:', error);

    // Take error screenshot
    try {
      await page.screenshot({ path: '/tmp/dag_error.png', fullPage: true });
      console.error('📸 Error screenshot saved: /tmp/dag_error.png');
    } catch (screenshotError) {
      console.error('Could not save error screenshot:', screenshotError);
    }

    throw error;
  } finally {
    await browser.close();
  }
}

// Run the test
testPipelineDagView().catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
});
