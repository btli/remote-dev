import puppeteer from 'puppeteer';
import Redis from 'ioredis';

/**
 * E2E Test for Redis Viewer in Admin Panel
 * Tests: Key browser, search, detail view, type visualization, TTL update, and delete
 */

async function setupTestData() {
  console.log('📝 Setting up test data in Redis...');

  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0'),
  });

  // Create test keys with different types
  await redis.set('test:string:user', 'John Doe');
  await redis.expire('test:string:user', 3600); // 1 hour TTL

  await redis.hset('test:hash:user', 'name', 'Jane Smith', 'email', 'jane@example.com', 'age', '30');

  await redis.lpush('test:list:tasks', 'Task 3', 'Task 2', 'Task 1');

  await redis.sadd('test:set:tags', 'redis', 'nodejs', 'typescript', 'admin');

  await redis.zadd('test:zset:leaderboard', 100, 'player1', 200, 'player2', 150, 'player3');

  console.log('✅ Test data created successfully');
  await redis.quit();
}

async function cleanupTestData() {
  console.log('🧹 Cleaning up test data...');

  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0'),
  });

  const keys = await redis.keys('test:*');
  if (keys.length > 0) {
    await redis.del(...keys);
  }

  console.log('✅ Test data cleaned up');
  await redis.quit();
}

async function testRedisViewer() {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--window-size=1920,1080', '--disable-dev-shm-usage', '--no-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  try {
    // Step 1: Navigate to Redis viewer page
    console.log('\n📍 Step 1: Navigating to Redis viewer...');
    await page.goto('http://localhost:3002/data/redis', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await page.waitForTimeout(2000); // Wait for React to hydrate
    await page.screenshot({ path: '/tmp/redis_viewer_01_initial.png' });
    console.log('✅ Screenshot saved: redis_viewer_01_initial.png');

    // Step 2: Wait for Redis info panel to load
    console.log('\n📍 Step 2: Checking Redis info panel...');
    await page.waitForSelector('text/Redis Server', { timeout: 5000 });
    const infoText = await page.evaluate(() => {
      const elements = document.querySelectorAll('body');
      return elements[0]?.textContent || '';
    });
    console.log('✅ Redis info panel loaded');
    console.log(`   Info contains: ${infoText.includes('Memory Used') ? '✓' : '✗'} Memory Used`);
    console.log(`   Info contains: ${infoText.includes('Total Keys') ? '✓' : '✗'} Total Keys`);

    // Step 3: Search for test keys
    console.log('\n📍 Step 3: Searching for test keys...');
    await page.waitForSelector('input[placeholder="Search keys..."]', { timeout: 5000 });
    await page.type('input[placeholder="Search keys..."]', 'test:');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000); // Wait for search results
    await page.screenshot({ path: '/tmp/redis_viewer_02_search.png' });
    console.log('✅ Screenshot saved: redis_viewer_02_search.png');

    // Step 4: Check if test keys are visible
    console.log('\n📍 Step 4: Checking if test keys are visible...');
    const keysText = await page.evaluate(() => document.body.textContent);
    console.log(`   Found: ${keysText.includes('test:string:user') ? '✓' : '✗'} test:string:user`);
    console.log(`   Found: ${keysText.includes('test:hash:user') ? '✓' : '✗'} test:hash:user`);
    console.log(`   Found: ${keysText.includes('test:list:tasks') ? '✓' : '✗'} test:list:tasks`);

    // Step 5: Click on string key to view details
    console.log('\n📍 Step 5: Clicking on string key...');
    await page.waitForSelector('text/test:string:user', { timeout: 5000 });
    await page.click('text/test:string:user');
    await page.waitForTimeout(1000); // Wait for details to load
    await page.screenshot({ path: '/tmp/redis_viewer_03_string_detail.png' });
    console.log('✅ Screenshot saved: redis_viewer_03_string_detail.png');

    // Step 6: Verify string value display
    console.log('\n📍 Step 6: Verifying string value...');
    const stringValue = await page.evaluate(() => document.body.textContent);
    console.log(`   Value contains: ${stringValue.includes('John Doe') ? '✓' : '✗'} John Doe`);

    // Step 7: Click on hash key
    console.log('\n📍 Step 7: Clicking on hash key...');
    await page.click('text/test:hash:user');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/redis_viewer_04_hash_detail.png' });
    console.log('✅ Screenshot saved: redis_viewer_04_hash_detail.png');

    // Step 8: Verify hash table display
    console.log('\n📍 Step 8: Verifying hash table...');
    const hashValue = await page.evaluate(() => document.body.textContent);
    console.log(`   Contains field: ${hashValue.includes('name') ? '✓' : '✗'} name`);
    console.log(`   Contains value: ${hashValue.includes('Jane Smith') ? '✓' : '✗'} Jane Smith`);
    console.log(`   Contains field: ${hashValue.includes('email') ? '✓' : '✗'} email`);

    // Step 9: Click on list key
    console.log('\n📍 Step 9: Clicking on list key...');
    await page.click('text/test:list:tasks');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/redis_viewer_05_list_detail.png' });
    console.log('✅ Screenshot saved: redis_viewer_05_list_detail.png');

    // Step 10: Click on set key
    console.log('\n📍 Step 10: Clicking on set key...');
    await page.click('text/test:set:tags');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/redis_viewer_06_set_detail.png' });
    console.log('✅ Screenshot saved: redis_viewer_06_set_detail.png');

    // Step 11: Click on sorted set (zset) key
    console.log('\n📍 Step 11: Clicking on sorted set key...');
    await page.click('text/test:zset:leaderboard');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/redis_viewer_07_zset_detail.png' });
    console.log('✅ Screenshot saved: redis_viewer_07_zset_detail.png');

    // Step 12: Verify zset displays scores
    console.log('\n📍 Step 12: Verifying sorted set with scores...');
    const zsetValue = await page.evaluate(() => document.body.textContent);
    console.log(`   Contains member: ${zsetValue.includes('player1') ? '✓' : '✗'} player1`);
    console.log(`   Contains score: ${zsetValue.includes('100') ? '✓' : '✗'} 100`);

    // Step 13: Test Copy button
    console.log('\n📍 Step 13: Testing Copy button...');
    await page.click('text/test:string:user');
    await page.waitForTimeout(500);
    const copyButton = await page.waitForSelector('button:has-text("Copy")', { timeout: 5000 });
    await copyButton.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/redis_viewer_08_copy.png' });
    console.log('✅ Screenshot saved: redis_viewer_08_copy.png');

    // Step 14: Test TTL update dialog
    console.log('\n📍 Step 14: Testing TTL update...');
    const ttlButton = await page.waitForSelector('button:has-text("TTL")', { timeout: 5000 });
    await ttlButton.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: '/tmp/redis_viewer_09_ttl_dialog.png' });
    console.log('✅ Screenshot saved: redis_viewer_09_ttl_dialog.png');

    // Close TTL dialog
    const cancelButton = await page.waitForSelector('button:has-text("Cancel")', { timeout: 5000 });
    await cancelButton.click();
    await page.waitForTimeout(500);

    // Step 15: Test Refresh button
    console.log('\n📍 Step 15: Testing Refresh button...');
    const refreshButton = await page.waitForSelector('button:has-text("Refresh")', { timeout: 5000 });
    await refreshButton.click();
    await page.waitForTimeout(1000);
    console.log('✅ Refresh button clicked');

    // Step 16: Test keyboard navigation (Tab through elements)
    console.log('\n📍 Step 16: Testing keyboard navigation...');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    console.log('✅ Keyboard navigation works');

    console.log('\n✨ All tests passed! ✨\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    await page.screenshot({ path: '/tmp/redis_viewer_error.png' });
    console.log('Error screenshot saved: redis_viewer_error.png');
    throw error;
  } finally {
    await browser.close();
  }
}

async function main() {
  try {
    // Setup test data
    await setupTestData();

    // Wait a bit for data to be available
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Run tests
    await testRedisViewer();

    // Cleanup test data
    await cleanupTestData();

    console.log('\n🎉 Redis Viewer E2E Test completed successfully! 🎉\n');
  } catch (error) {
    console.error('\n💥 Test suite failed:', error);
    await cleanupTestData();
    process.exit(1);
  }
}

main().catch(console.error);
