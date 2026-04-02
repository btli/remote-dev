Validate web application with Chrome DevTools using browser MCP server.

**Purpose**: Autonomous browser testing to verify web application functionality.

**Prerequisites**:
- Detect dev server configuration (npm/yarn/docker)
- Identify application type (Next.js, React, etc.)
- Check for multi-language support (i18n)

**Workflow**:

1. **Start Dev Server**
   - Auto-detect: npm run dev, yarn dev, or docker-compose up
   - Wait for server ready (check localhost:3000 or configured port)
   - Verify server is responding

2. **Use Browser MCP for Testing**
   - Navigate to home page
   - Check console for errors
   - Verify page loads without 404s
   - Test navigation between routes

3. **Route Testing**
   - Test all major routes (/, /about, /contact, etc.)
   - Verify each page loads successfully
   - Check for console errors on each page
   - Validate no broken links

4. **Multi-Language Testing** (if applicable)
   - Detect available locales
   - Test each locale variant
   - Verify translations load correctly
   - Check for missing translation keys
   - Ensure no hardcoded strings in UI

5. **Error Detection**
   - Capture console errors
   - Screenshot failures
   - Log network request failures
   - Identify 404 errors

6. **Generate Test Report**
   - ✅ Routes tested successfully
   - ❌ Console errors found
   - 🔗 404s detected
   - 🌍 Locales tested
   - 🚨 Critical issues
   - 📸 Screenshots of failures

7. **Stop Dev Server**
   - Clean shutdown of server
   - Verify no processes left running

**Auto-Fix Mode**: Attempt to fix errors found (max 3 iterations):
- Fix console errors if source is clear
- Fix routing issues
- Fix missing translations
- Re-test after fixes

**Subagent Usage**: Run tests using a subagent to isolate browser MCP context and preserve main conversation context.

**Use TodoWrite**: Track testing progress through each route and locale.

**Continue automatically** through all testing steps without asking for confirmation. Only report back a concise summary of results.

**Error Recovery**: If tests fail, attempt automatic fixes and re-test (max 3 iterations).
