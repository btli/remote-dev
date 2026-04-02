---
description: Launch Documentation Research subagent for library documentation lookup with context isolation
---

Launch a specialized Documentation Research subagent to autonomously research library documentation, best practices, and API references with context isolation.

**Purpose**: Offload documentation research and MCP doc fetches to a dedicated subagent, preserving main conversation context while gathering comprehensive technical information.

## When to Use

- Researching new libraries or frameworks
- Looking up API documentation
- Finding best practices
- Troubleshooting deprecation warnings
- Learning new technologies
- Comparing library options

## Subagent Capabilities

The Documentation Research subagent has access to:
- context7 MCP server (library documentation)
- mui-mcp MCP server (MUI documentation)
- WebFetch tool (for fetching docs)
- WebSearch tool (for finding resources)
- Read tool (for local documentation)

## Workflow

### 1. Launch Documentation Research Subagent

Use the Task tool with specialized documentation prompt:

```
Launch a Documentation Research subagent to research technical documentation and provide a comprehensive summary.

Research topic: [SPECIFIC TOPIC/LIBRARY/QUESTION]

The subagent should:

**Phase 1: Identify Research Scope**
1. Determine what documentation is needed
2. Identify relevant libraries/frameworks
3. Choose appropriate research tools:
   - context7 MCP for general libraries
   - mui-mcp for MUI components
   - WebFetch for official docs
   - WebSearch for finding resources

**Phase 2: Gather Documentation**
1. Fetch relevant documentation pages
2. Search for specific APIs or features
3. Look up code examples
4. Find best practices
5. Check for deprecation notices
6. Review migration guides (if applicable)

**Phase 3: Analyze Information**
1. Extract key concepts
2. Identify important APIs
3. Collect code examples
4. Note common pitfalls
5. Find related resources
6. Check version compatibility

**Phase 4: Synthesize Findings**
1. Summarize core concepts
2. Provide relevant code examples
3. Highlight best practices
4. Note gotchas and warnings
5. Include links to full documentation

**Phase 5: Generate Report**
Return a concise, actionable summary containing:

📚 **Library/Technology Overview**:
- Name and version
- Purpose and use cases
- Key features
- Installation command

💡 **Core Concepts**:
- Main API surfaces
- Key abstractions
- Design patterns used
- Mental models

🔑 **Essential APIs** (top 5-10):
- API name: Brief description
- Usage example (short)
- Important parameters
- Return types

✨ **Best Practices**:
- Do's and Don'ts
- Performance tips
- Common patterns
- Anti-patterns to avoid

⚠️ **Gotchas & Warnings**:
- Common mistakes
- Edge cases
- Browser compatibility
- Version-specific issues
- Deprecation notices

📝 **Code Examples**:
[Include 2-3 concise, practical examples]

```typescript
// Example 1: Basic usage
[code]

// Example 2: Common pattern
[code]

// Example 3: Advanced usage
[code]
```

🔗 **Key Resources**:
- Official documentation: [URL]
- API reference: [URL]
- Best practices guide: [URL]
- Migration guide: [URL] (if applicable)

🎯 **Recommendation** (for the original question):
[Specific answer to the research question]
[Actionable next steps]

**IMPORTANT**:
- Do NOT return full documentation pages (too verbose)
- Focus on answering the specific question
- Provide actionable information
- Include SHORT code examples only
- Keep report under 4000 tokens
- Prioritize relevance over completeness
```

### 2. Subagent Execution

The subagent will:
- Use context7/mui-mcp to fetch documentation
- Search for specific information
- Extract relevant details
- Synthesize findings
- Preserve full docs in its context

### 3. Main Agent Receives Report

The main conversation receives only:
- Concise summary (~1000-4000 tokens)
- Relevant code examples
- Best practices
- Direct answer to question
- Links to full docs

**Context saved**: 30-50k tokens (full documentation stays in subagent)

### 4. Apply Findings

Based on subagent report:
- Implement recommended solution
- Apply best practices
- Avoid identified gotchas
- Reference full docs if needed

## Research Strategies

### Strategy 1: Quick API Lookup
```
User: Launch docs agent to research how to use useState hook

Response:
📚 React useState Hook

Core Concept:
useState is a Hook that lets you add state to functional components.

Essential API:
const [state, setState] = useState(initialValue)
- initialValue: Initial state value
- Returns: [currentState, setStateFunction]

Best Practice:
✅ Use functional updates when new state depends on old state
❌ Don't mutate state directly

Example:
```typescript
const [count, setCount] = useState(0);
// Good: functional update
setCount(c => c + 1);
// Bad: depends on closure
setCount(count + 1);
```

Gotcha:
setState doesn't immediately update state (batched updates)
```

### Strategy 2: Library Comparison
```
User: Launch docs agent to compare React Query vs SWR

Response:
📚 React Query vs SWR Comparison

Both are data fetching libraries with similar goals.

React Query:
✅ More features (mutations, dev tools)
✅ Larger ecosystem
❌ Larger bundle size

SWR:
✅ Simpler API
✅ Smaller bundle size
✅ Built by Vercel (Next.js team)

Recommendation:
- Use SWR for: Simple data fetching, Next.js projects
- Use React Query for: Complex state management, mutations

Code comparison:
[side-by-side examples]
```

### Strategy 3: Migration Guide
```
User: Launch docs agent to research migrating from React 17 to 18

Response:
📚 React 17 → 18 Migration Guide

Breaking Changes:
1. Automatic batching
2. New root API
3. Strict effects in development

Migration Steps:
1. Update dependencies
2. Replace ReactDOM.render with createRoot
3. Test concurrent features
4. Update TypeScript types

Example migration:
[before/after code]

Gotchas:
- useEffect runs twice in StrictMode (dev only)
- SSR hydration changes
```

## MCP Server Selection

### Use context7 MCP for:
- General JavaScript/TypeScript libraries
- Python packages
- Framework documentation
- Build tools
- Testing libraries

**Example libraries**:
- React, Vue, Angular
- Next.js, Nuxt
- pytest, Jest
- Webpack, Vite

### Use mui-mcp for:
- Material-UI components
- MUI X components (DataGrid, DatePicker)
- MUI styling solutions
- MUI theming

**Only use for MUI-specific questions**

### Use WebFetch for:
- Official documentation sites
- GitHub repositories
- Blog posts
- llms.txt files

### Use WebSearch for:
- Finding documentation URLs
- Discovering new libraries
- Reading recent blog posts
- Finding Stack Overflow solutions

## Integration with Commands

### During Implementation
```
# Claude uses docs agent automatically when needed
User: Implement user authentication with NextAuth

Claude: Let me research NextAuth best practices
*Launches Documentation Research subagent*
*Receives concise summary*
*Implements solution based on findings*
```

### When Fixing Deprecation Warnings
```
User: Fix deprecation warnings in the code

Claude: *Identifies deprecated API*
*Launches docs agent to research replacement*
*Receives migration guide*
*Updates code with new API*
```

### When Learning New Library
```
User: Add date picker to the form using MUI

Claude: *Launches docs agent with mui-mcp*
*Receives MUI DatePicker documentation summary*
*Implements DatePicker with best practices*
```

## Performance Benefits

**Context Preservation**:
- Main conversation: ~10k tokens
- Full documentation: ~40k tokens (in subagent)
- MCP doc fetches: Isolated to subagent
- **Savings**: 40k tokens per documentation research

**Selective MCP Loading**:
- MCP servers only loaded in subagent
- Main conversation remains lightweight
- Multiple doc sources without context bloat

**Faster Response**:
- Subagent fetches docs in parallel
- Synthesizes concise summary
- Main agent gets actionable info quickly

## Example Reports

### Quick API Lookup
```
📚 axios GET Request

Essential API:
axios.get(url, config)

Example:
```typescript
const response = await axios.get('/api/users', {
  params: { id: 123 },
  headers: { 'Authorization': 'Bearer token' }
});
```

Best Practice:
✅ Use interceptors for auth
✅ Handle errors with try/catch
❌ Don't forget to handle errors

Gotcha: GET requests with body are non-standard
```

### Best Practices Research
```
📚 React useEffect Best Practices

Do's:
✅ Add all dependencies to array
✅ Use cleanup function for subscriptions
✅ Keep effects focused and simple

Don'ts:
❌ Don't use objects/functions as dependencies
❌ Don't forget cleanup
❌ Don't put too much logic in one effect

Example:
```typescript
useEffect(() => {
  const subscription = api.subscribe(userId);
  return () => subscription.unsubscribe();
}, [userId]); // userId is the dependency
```
```

### Troubleshooting
```
📚 "Cannot read property 'map' of undefined"

Common Causes:
1. Data not loaded yet
2. API returned null/undefined
3. Wrong property access

Solutions:
1. Add loading state
2. Use optional chaining (?.)
3. Provide default value ([])

Example fix:
```typescript
// Before
{users.map(user => ...)}

// After
{users?.map(user => ...) || []}
// or
{(users || []).map(user => ...)}
```
```

## Auto-Selection Strategy

Claude automatically chooses the right tool:

**For specific libraries**:
- React/Vue/Angular → context7
- MUI components → mui-mcp
- Python packages → context7

**For general questions**:
- Start with context7
- Fall back to WebSearch
- Fetch specific docs with WebFetch

**For comparisons**:
- Use context7 for both libraries
- Synthesize comparison
- Provide recommendation

## Best Practices

### DO
- Use docs agent for unfamiliar libraries
- Trust the synthesized summary
- Reference full docs if needed
- Apply recommended patterns

### DON'T
- Fetch docs manually in main conversation
- Load multiple MCP servers simultaneously
- Request full documentation (too verbose)
- Ignore best practice recommendations

## Success Metrics

Track Documentation Research subagent effectiveness:
- Time to find relevant docs (target: <30s)
- Accuracy of recommendations (target: >95%)
- Context tokens saved (target: 30k+)
- Relevance of examples (subjective)

## Advanced Configuration

### Custom Documentation Sources
Add to project CLAUDE.md:
```markdown
## Documentation Research Configuration

Preferred sources:
- Internal wiki: https://wiki.company.com
- Company libraries: npm @company/*
- Style guide: /docs/style-guide.md

Research depth:
- Quick lookup: 1-2 sources
- Thorough research: 3-5 sources
- Comparison: All relevant sources
```

### Domain-Specific Research
```markdown
Research focus areas:
- Accessibility (WCAG compliance)
- Performance (Core Web Vitals)
- Security (OWASP guidelines)
- Testing (coverage requirements)
```

## Troubleshooting

### MCP Server Not Responding
- Check MCP server status
- Try alternative research method (WebFetch)
- Fall back to WebSearch

### Documentation Not Found
- Verify library name and version
- Check spelling
- Search with WebSearch first

### Summary Too Generic
- Make question more specific
- Provide context about use case
- Ask for specific API details

---

**Status**: Production Ready
**Context Isolation**: ✅ Yes
**MCP Servers**: context7, mui-mcp (selective)
**Token Savings**: ~30-50k per use
**Research Tools**: MCP, WebFetch, WebSearch
