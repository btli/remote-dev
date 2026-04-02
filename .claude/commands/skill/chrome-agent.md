---
description: Launch Chrome Testing subagent for autonomous browser testing and validation
---

Launch a specialized Chrome Testing subagent to autonomously handle browser testing, UI validation, and multi-locale testing with context isolation.

**Purpose**: Offload browser testing and Chrome DevTools operations to a dedicated subagent, preserving main conversation context while performing comprehensive UI validation.

## When to Use

- After UI/frontend changes
- Before deploying web applications
- For multi-locale testing
- To validate user flows
- When debugging browser issues

## Subagent Capabilities

The Chrome Testing subagent has access to:
- Browser MCP server (Chrome DevTools Protocol)
- Bash tool for starting/stopping dev servers
- Read tool for checking configuration
- Grep/Glob for finding test files
- Full repository access

## Workflow

### 1. Launch Chrome Testing Subagent

Use the Task tool with specialized Chrome testing prompt:

```
Launch a Chrome Testing subagent to perform comprehensive browser testing and UI validation.

The subagent should:

**Phase 1: Environment Setup**
1. Detect project type (Next.js, React, etc.)
2. Identify dev server command (npm run dev, yarn dev, docker-compose up)
3. Detect port configuration (default: 3000)
4. Check for multi-language support (i18n/locales)
5. Start dev server and wait for ready state

**Phase 2: Browser Initialization**
1. Launch browser via browser MCP
2. Navigate to localhost:[port]
3. Verify page loads successfully
4. Check for immediate console errors
5. Capture initial screenshot

**Phase 3: Route Testing**
For each route in the application:
1. Navigate to route URL
2. Wait for page load complete
3. Check console for errors
4. Verify no 404 responses
5. Check for broken images/assets
6. Validate critical elements present
7. Capture screenshot if errors found

Routes to test (auto-detect):
- Home page (/)
- About page (/about)
- Contact page (/contact)
- Common routes found in navigation
- Dynamic routes (if safe to test)

**Phase 4: Multi-Locale Testing** (if applicable)
For each detected locale:
1. Switch to locale (via URL param or cookie)
2. Test all critical routes
3. Verify translations loaded
4. Check for missing translation keys
5. Verify no hardcoded strings in UI
6. Validate language-specific formatting

Common locales:
- en (English)
- zh-CN (Simplified Chinese)
- zh-TW (Traditional Chinese)
- Other detected locales

**Phase 5: User Flow Testing**
Test critical user interactions:
1. Navigation between pages
2. Form submissions (if forms detected)
3. Button clicks and interactions
4. Modal/dialog operations
5. Dropdown selections
6. Authentication flows (if applicable)

**Phase 6: Error Detection**
Monitor and collect:
- Console errors (JavaScript errors)
- Console warnings
- Network request failures (404, 500, etc.)
- Failed resource loads (images, CSS, JS)
- CORS errors
- Performance warnings

**Phase 7: Auto-Fix Attempts** (Max 3 Iterations)
For detected errors:

**Iteration 1: Client-Side Fixes**
- Fix broken links (update href)
- Fix missing images (check paths)
- Fix JavaScript errors (if simple)
- Add missing translation keys

**Iteration 2: Configuration Fixes**
- Update routing configuration
- Fix environment variables
- Correct API endpoints
- Update locale configurations

**Iteration 3: Code Fixes**
- Fix React component errors
- Correct TypeScript issues
- Update dependencies if needed
- Fix CSS/styling issues

**Phase 8: Cleanup**
1. Capture final screenshots
2. Stop dev server gracefully
3. Verify no hanging processes
4. Clean up test artifacts

**Phase 9: Generate Report**
Return a concise summary containing:

✅ **Successful Tests**:
- Routes tested: [count]
- Locales tested: [count]
- User flows validated: [count]
- Screenshots captured: [count]

❌ **Errors Found**:
- Console errors: [count] - [brief descriptions]
- Network failures: [count] - [URLs]
- Missing translations: [count] - [keys]
- Broken links: [count] - [URLs]

🔧 **Auto-Fixes Applied**:
- Fixed broken links: [count]
- Added missing translations: [count]
- Corrected image paths: [count]
- Iterations used: [X/3]

🌍 **Locale Testing**:
- en: [status]
- zh-CN: [status]
- zh-TW: [status]

📊 **Performance**:
- Average page load: [ms]
- Slowest route: [route] ([ms])
- Failed requests: [count]

⚠️ **Warnings**:
- Deprecated API usage
- Accessibility issues
- Performance concerns
- Security warnings

💡 **Recommendations**:
- [Specific UI improvements]
- [Accessibility enhancements]
- [Performance optimizations]
- [Translation completeness]

📸 **Screenshots**:
- [Only include if errors found]
- [Path to screenshot files]

**IMPORTANT**:
- Do NOT return full console logs (too verbose)
- Do NOT return all screenshots (only error cases)
- Focus on actionable findings
- Keep report under 3000 tokens
```

### 2. Subagent Execution

The subagent will:
- Start dev server automatically
- Test all routes and locales autonomously
- Capture errors without asking
- Attempt fixes without confirmation
- Stop server and clean up

### 3. Main Agent Receives Report

The main conversation receives only:
- Test summary (~500-3000 tokens)
- Error descriptions and counts
- Auto-fix results
- Screenshots (only if errors)
- Actionable recommendations

**Context saved**: 40-50k tokens (browser MCP output, screenshots, logs stay in subagent)

### 4. Act on Report

Based on subagent report:
- If all passed → ready to deploy
- If minor issues fixed → review and deploy
- If errors remain → investigate issues
- If critical issues → fix before deployment

## Server Detection & Management

### Auto-Detect Server Command

**Next.js**:
```bash
npm run dev
# or
yarn dev
# Port: 3000 (or from next.config.js)
```

**React (CRA)**:
```bash
npm start
# Port: 3000
```

**Docker Compose**:
```bash
docker-compose up -d
# Port: from docker-compose.yml
```

### Verify Server Ready

Poll localhost:[port] until:
- HTTP 200 response received
- Page content loaded
- Maximum wait: 60 seconds

### Graceful Shutdown

```bash
# For npm/yarn
Ctrl+C (SIGINT)
kill [pid]

# For Docker
docker-compose down
```

## Multi-Locale Testing Strategy

### Locale Detection

Check for:
- `i18n` configuration files
- `locales/` or `translations/` directories
- `next-intl` or `react-intl` packages
- URL patterns (/en/, /zh-CN/, etc.)

### Locale Switching Methods

**URL-based**:
```
/en/about
/zh-CN/about
/zh-TW/about
```

**Cookie-based**:
```javascript
document.cookie = "NEXT_LOCALE=zh-CN"
```

**Query param**:
```
/?lang=zh-CN
```

### Translation Validation

Check for:
- Missing translation keys (console warnings)
- Hardcoded English strings in UI
- Proper Chinese character rendering
- Date/number formatting per locale
- Currency formatting (if applicable)

## Error Categories & Auto-Fixes

### Category 1: Routing Errors (404)
**Detection**: Network tab shows 404 responses
**Auto-fix**:
- Check if route exists in routing configuration
- Add route if missing
- Fix typos in route paths

### Category 2: Asset Loading Errors
**Detection**: Failed image/CSS/JS loads
**Auto-fix**:
- Correct asset paths
- Check public directory structure
- Update import statements

### Category 3: JavaScript Errors
**Detection**: Console errors
**Auto-fix**:
- Fix undefined variables (add checks)
- Fix null reference errors (add guards)
- Correct API response handling

### Category 4: Translation Errors
**Detection**: Missing translation keys
**Auto-fix**:
- Add missing keys to translation files
- Use English as fallback if key missing
- Update locale files

### Category 5: Accessibility Issues
**Detection**: Missing alt text, ARIA labels
**Auto-fix**:
- Add alt text to images
- Add ARIA labels to buttons
- Improve keyboard navigation

## Integration with Commands

### With /chrome-test
```
/chrome-test
→ Internally uses Chrome Testing subagent
→ Returns concise summary to main agent
→ Preserves context
```

### With /test-fix-deploy
```
/test-fix-deploy
→ Optional: Run Chrome Testing subagent before deploy
→ Validate UI before production
→ Ensure no regressions
```

### With /git:feature
```
/git:feature "UI improvement"
→ After implementation: Chrome Testing subagent
→ Validate UI changes
→ Check all locales
→ Include in PR validation
```

## Performance Benefits

**Context Preservation**:
- Main conversation: ~15k tokens
- Browser logs: ~35k tokens (in subagent)
- Screenshots: ~10k tokens (in subagent)
- **Savings**: 45k tokens per browser test session

**Parallel Testing**:
- Test multiple routes concurrently
- Test all locales in parallel
- Faster overall execution

**Cost Reduction**:
- Browser MCP context isolated
- Screenshot data stays in subagent
- Fewer tokens in main conversation

## Example Reports

### All Tests Pass
```
✅ Browser Testing Complete

Routes tested: 8/8 passed
- / ✅
- /about ✅
- /contact ✅
- /features ✅

Locales tested: 3/3 passed
- en ✅
- zh-CN ✅
- zh-TW ✅

No errors found. Ready to deploy!
```

### Errors with Auto-Fixes
```
✅ Browser Testing Complete (after fixes)

Routes tested: 8/8 passed
Locales tested: 3/3 passed

Auto-fixes applied:
- Fixed 2 broken links
- Added 3 missing translation keys
- Corrected 1 image path

Final status: All tests passing
```

### Errors Requiring Attention
```
❌ Browser Testing Found Issues

Routes tested: 8 routes
- 6 passed ✅
- 2 failed ❌

Errors found:
1. /contact page:
   - Form submission error: API endpoint 404
   - Location: ContactForm.tsx:45

2. zh-CN locale:
   - 5 missing translation keys
   - Keys: contact.title, contact.description, ...

Attempted 3 fix iterations:
- Fixed 2 broken links ✅
- Unable to fix API endpoint (needs manual review)

Recommendation: Review API endpoint configuration
File: pages/api/contact.ts
```

## Best Practices

### DO
- Use Chrome Testing subagent for UI changes
- Test all locales before deployment
- Trust auto-fix for simple issues
- Review screenshots for visual verification

### DON'T
- Skip browser testing for UI changes
- Ignore translation warnings
- Deploy with console errors
- Disable locale testing

## Troubleshooting

### Server Won't Start
- Check port not already in use
- Verify dependencies installed
- Check environment variables
- Review server logs in subagent

### Browser MCP Connection Failed
- Verify browser MCP server running
- Check network connectivity
- Restart Claude Code session

### Tests Timing Out
- Increase page load timeout
- Check for infinite loading states
- Review network request delays

### Locale Switching Not Working
- Verify locale detection method
- Check i18n configuration
- Review URL patterns

## Advanced Configuration

### Custom Test Routes
Add to project CLAUDE.md:
```markdown
## Chrome Testing Configuration

Routes to test:
- /
- /about
- /pricing
- /docs
- /api-reference

Locales to test:
- en, zh-CN, zh-TW, ja, ko

Critical user flows:
- Login flow
- Checkout flow
- Search functionality
```

### Performance Budgets
```markdown
Performance thresholds:
- Page load: <2s
- First Contentful Paint: <1s
- Time to Interactive: <3s
- Failed requests: 0
```

## Success Metrics

Track Chrome Testing subagent effectiveness:
- Error detection rate (target: 100%)
- Auto-fix success rate (target: >70%)
- Context tokens saved (target: 40k+)
- Time saved per test session (target: 10+ min)

---

**Status**: Production Ready
**Context Isolation**: ✅ Yes
**Browser MCP**: ✅ Required
**Token Savings**: ~40-50k per use
**Auto-Fix**: ✅ Up to 3 iterations
