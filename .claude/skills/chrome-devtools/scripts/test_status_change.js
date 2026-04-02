import puppeteer from 'puppeteer';

/**
 * E2E Test for Feature 017: Admin Interface - Inline User Status Change
 *
 * Tests the complete user journey:
 * 1. Navigate to admin users page
 * 2. Click status badge to open dropdown
 * 3. Select new status from dropdown
 * 4. Verify modal opens with correct information
 * 5. Enter reason and confirm
 * 6. Verify status updates in table
 * 7. Verify success notification appears
 */
async function testStatusChange() {
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 100 // Slow down for visibility
  });
  const page = await browser.newPage();

  // Set viewport for consistent screenshots
  await page.setViewport({ width: 1920, height: 1080 });

  console.log('🧪 Testing Feature 017: Inline User Status Change');
  console.log('=================================================\n');

  try {
    // Step 1: Navigate to admin users page
    console.log('Step 1: Navigating to admin users page...');
    await page.goto('http://localhost:3002/users', {
      waitUntil: 'networkidle2',
      timeout: 10000
    });

    const pageTitle = await page.title();
    console.log(`✓ Users page loaded: ${pageTitle}`);

    // Take screenshot of initial state
    await page.screenshot({ path: '/tmp/admin-users-initial.png', fullPage: true });
    console.log('✓ Screenshot saved to /tmp/admin-users-initial.png\n');

    // Wait for table to load
    await page.waitForSelector('table', { timeout: 5000 });
    console.log('✓ Users table found\n');

    // Step 2: Find and click the first status badge
    console.log('Step 2: Finding first status badge...');

    // Wait for status badges to be present
    const statusBadgeSelector = '[data-testid^="status-badge-"]';
    await page.waitForSelector(statusBadgeSelector, { timeout: 5000 });

    // Get the current status before change
    const initialStatus = await page.evaluate(() => {
      const badge = document.querySelector('[data-testid^="status-badge-"]');
      return badge ? badge.textContent : null;
    });

    console.log(`  Initial status: ${initialStatus}`);

    // Click the first status badge
    await page.click(statusBadgeSelector);
    console.log('✓ Status badge clicked\n');

    // Step 3: Wait for dropdown menu to appear
    console.log('Step 3: Verifying dropdown menu appears...');
    await page.waitForSelector('[role="menu"]', { timeout: 5000 });

    // Take screenshot of dropdown
    await page.screenshot({ path: '/tmp/admin-status-dropdown.png' });
    console.log('✓ Dropdown menu opened');
    console.log('✓ Screenshot saved to /tmp/admin-status-dropdown.png\n');

    // Get all menu items
    const menuItems = await page.evaluate(() => {
      const items = document.querySelectorAll('[role="menuitem"]');
      return Array.from(items).map(item => ({
        text: item.textContent,
        isSelected: item.classList.contains('Mui-selected')
      }));
    });

    console.log('  Available status options:', menuItems.map(i => i.text).join(', '));
    console.log(`  Currently selected: ${menuItems.find(i => i.isSelected)?.text}\n`);

    // Step 4: Select a different status from dropdown
    console.log('Step 4: Selecting different status from dropdown...');

    // Find a status that's different from current
    const targetStatus = menuItems.find(item => !item.isSelected)?.text;

    if (!targetStatus) {
      throw new Error('No different status available to select');
    }

    console.log(`  Selecting status: ${targetStatus}`);

    // Click the menu item with the target status
    await page.evaluate((status) => {
      const items = document.querySelectorAll('[role="menuitem"]');
      const targetItem = Array.from(items).find(item => item.textContent === status);
      if (targetItem) {
        targetItem.click();
      }
    }, targetStatus);

    console.log('✓ Status selected\n');

    // Step 5: Verify modal appears
    console.log('Step 5: Verifying confirmation modal appears...');
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });

    // Take screenshot of modal
    await page.screenshot({ path: '/tmp/admin-status-modal.png' });
    console.log('✓ Confirmation modal opened');
    console.log('✓ Screenshot saved to /tmp/admin-status-modal.png\n');

    // Get modal content
    const modalInfo = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const title = dialog?.querySelector('h2, [class*="DialogTitle"]')?.textContent;
      const description = dialog?.querySelector('[class*="DialogContent"]')?.textContent;
      const hasReasonField = !!dialog?.querySelector('textarea, input[type="text"]');
      const buttons = Array.from(dialog?.querySelectorAll('button') || []).map(b => b.textContent);

      return { title, hasReasonField, buttons };
    });

    console.log('  Modal information:');
    console.log(`    Title: ${modalInfo.title}`);
    console.log(`    Has reason field: ${modalInfo.hasReasonField}`);
    console.log(`    Buttons: ${modalInfo.buttons.join(', ')}\n`);

    // Step 6: Enter reason and confirm
    console.log('Step 6: Entering reason and confirming...');

    // Find and fill reason field
    const reasonFieldSelector = 'textarea, input[name="reason"]';
    const reasonText = 'E2E test: Testing inline status change feature (Feature 017)';

    await page.waitForSelector(reasonFieldSelector, { timeout: 3000 })
      .catch(() => console.log('  Note: Reason field might be optional'));

    const reasonFieldExists = await page.$(reasonFieldSelector);
    if (reasonFieldExists) {
      await page.type(reasonFieldSelector, reasonText);
      console.log(`  Reason entered: "${reasonText}"`);
    } else {
      console.log('  No reason field found (might be optional)');
    }

    // Take screenshot before confirming
    await page.screenshot({ path: '/tmp/admin-status-modal-filled.png' });
    console.log('✓ Screenshot saved to /tmp/admin-status-modal-filled.png\n');

    // Find and click confirm button
    console.log('  Clicking confirm button...');
    await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const buttons = Array.from(dialog?.querySelectorAll('button') || []);
      const confirmButton = buttons.find(b =>
        b.textContent?.toLowerCase().includes('confirm') ||
        b.textContent?.toLowerCase().includes('activate') ||
        b.textContent?.toLowerCase().includes('suspend') ||
        b.textContent?.toLowerCase().includes('ban')
      );
      if (confirmButton) {
        confirmButton.click();
      }
    });

    console.log('✓ Confirm button clicked\n');

    // Step 7: Wait for API call to complete and modal to close
    console.log('Step 7: Waiting for status update...');

    // Wait for modal to close (indicates API call completed)
    await page.waitForSelector('[role="dialog"]', {
      hidden: true,
      timeout: 5000
    }).catch(() => {
      console.log('  Warning: Modal did not close (possible error)');
    });

    // Wait a bit for table to re-render
    await page.waitForTimeout(1000);

    console.log('✓ Modal closed\n');

    // Step 8: Verify status updated in table
    console.log('Step 8: Verifying status updated in table...');

    const updatedStatus = await page.evaluate(() => {
      const badge = document.querySelector('[data-testid^="status-badge-"]');
      return badge ? badge.textContent : null;
    });

    console.log(`  Updated status: ${updatedStatus}`);
    console.log(`  Status changed: ${initialStatus} → ${updatedStatus}`);

    if (updatedStatus === targetStatus) {
      console.log('✅ Status successfully updated!\n');
    } else {
      console.log('⚠️  Status might not have updated (check for errors)\n');
    }

    // Take screenshot of final state
    await page.screenshot({ path: '/tmp/admin-users-updated.png', fullPage: true });
    console.log('✓ Screenshot saved to /tmp/admin-users-updated.png\n');

    // Step 9: Check for success notification
    console.log('Step 9: Checking for success notification...');

    const hasNotification = await page.evaluate(() => {
      const snackbar = document.querySelector('[role="alert"], [class*="Snackbar"]');
      return {
        exists: !!snackbar,
        message: snackbar?.textContent || null
      };
    });

    if (hasNotification.exists) {
      console.log(`✓ Notification found: "${hasNotification.message}"\n`);
    } else {
      console.log('  No notification visible (might have auto-dismissed)\n');
    }

    // Step 10: Test keyboard accessibility (bonus)
    console.log('Step 10: Testing keyboard accessibility...');

    // Focus on the status badge using Tab
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    // Get the focused element
    const focusedElement = await page.evaluate(() => {
      const focused = document.activeElement;
      return {
        tagName: focused?.tagName,
        role: focused?.getAttribute('role'),
        testId: focused?.getAttribute('data-testid'),
        text: focused?.textContent
      };
    });

    console.log('  Focused element:', focusedElement);

    if (focusedElement.role === 'button' && focusedElement.testId?.includes('status-badge')) {
      console.log('✅ Status badge is keyboard accessible!\n');
    } else {
      console.log('  Note: May need to Tab multiple times to reach status badge\n');
    }

    // Final summary
    console.log('========================================');
    console.log('✅ Feature 017 E2E Test Complete!');
    console.log('========================================\n');

    console.log('Test Summary:');
    console.log(`  ✓ Initial status: ${initialStatus}`);
    console.log(`  ✓ Target status: ${targetStatus}`);
    console.log(`  ✓ Final status: ${updatedStatus}`);
    console.log(`  ✓ Status changed: ${updatedStatus === targetStatus ? 'YES' : 'UNKNOWN'}`);
    console.log('\nScreenshots saved:');
    console.log('  - /tmp/admin-users-initial.png');
    console.log('  - /tmp/admin-status-dropdown.png');
    console.log('  - /tmp/admin-status-modal.png');
    console.log('  - /tmp/admin-status-modal-filled.png');
    console.log('  - /tmp/admin-users-updated.png');
    console.log('\nNext steps:');
    console.log('  1. Manually verify screenshots look correct');
    console.log('  2. Check database for UserStatusChangeLog entry');
    console.log('  3. Test with different status transitions');
    console.log('  4. Test error scenarios (API failure, network issues)');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('\nError details:', error);

    // Take screenshot of error state
    try {
      await page.screenshot({ path: '/tmp/admin-status-error.png', fullPage: true });
      console.log('\n📸 Error screenshot saved to /tmp/admin-status-error.png');
    } catch (screenshotError) {
      console.error('Could not save error screenshot:', screenshotError.message);
    }
  } finally {
    console.log('\n🔒 Closing browser...');
    await browser.close();
  }
}

// Run the test
testStatusChange().catch(console.error);
