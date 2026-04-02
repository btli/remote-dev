---
name: webapp-testing
description: Toolkit for interacting with and testing local web applications using Chrome DevTools Protocol. Supports modern tools (pnpm, turborepo, Next.js/React), verifying frontend functionality, debugging UI behavior, capturing browser screenshots, and viewing browser logs.
license: Complete terms in LICENSE.txt
---

# Web Application Testing

To test local web applications, write native Python scripts using Chrome DevTools Protocol (CDP). This approach provides direct browser control without heavy dependencies like Playwright or Puppeteer.

**Helper Scripts Available**:
- `scripts/with_server.py` - Manages server lifecycle (supports pnpm, npm, yarn, turborepo, Next.js)

**Always run scripts with `--help` first** to see usage. DO NOT read the source until you try running the script first and find that a customized solution is absolutely necessary. These scripts can be very large and thus pollute your context window. They exist to be called directly as black-box scripts rather than ingested into your context window.

## Modern Tooling Support

This skill supports modern JavaScript/TypeScript ecosystems:
- **Package Managers**: npm, pnpm, yarn
- **Monorepos**: turborepo workspaces
- **Frameworks**: Next.js, React, Vite, and more
- **Dev Servers**: Automatically detects when servers are ready

## Decision Tree: Choosing Your Approach

```
User task → Is it static HTML?
    ├─ Yes → Read HTML file directly to identify selectors
    │         ├─ Success → Write CDP script using selectors
    │         └─ Fails/Incomplete → Treat as dynamic (below)
    │
    └─ No (dynamic webapp) → Is the server already running?
        ├─ No → Run: python scripts/with_server.py --help
        │        Then use helper with pnpm/npm/yarn + write CDP script
        │
        └─ Yes → Reconnaissance-then-action:
            1. Connect to Chrome via CDP
            2. Navigate and wait for load completion
            3. Take screenshot or inspect DOM
            4. Identify selectors from rendered state
            5. Execute actions with discovered selectors
```

## Example: Using with_server.py

To start a server, run `--help` first, then use the helper:

**Single server (npm/pnpm/yarn):**
```bash
# npm
python scripts/with_server.py --server "npm run dev" --port 5173 -- python your_automation.py

# pnpm
python scripts/with_server.py --server "pnpm dev" --port 3000 -- python your_automation.py

# Next.js
python scripts/with_server.py --server "pnpm next dev" --port 3000 -- python your_automation.py
```

**Turborepo monorepo:**
```bash
# Run specific workspace
python scripts/with_server.py --server "pnpm --filter web dev" --port 3000 -- python your_automation.py

# Run multiple workspaces
python scripts/with_server.py \
  --server "pnpm --filter api dev" --port 3001 \
  --server "pnpm --filter web dev" --port 3000 \
  -- python your_automation.py
```

**Multiple servers (e.g., backend + frontend):**
```bash
python scripts/with_server.py \
  --server "cd backend && python server.py" --port 3001 \
  --server "cd frontend && pnpm dev" --port 3000 \
  -- python your_automation.py
```

To create an automation script, use Chrome DevTools Protocol (servers are managed automatically):
```python
import subprocess
import json
import time
import websocket

# Launch Chrome with remote debugging
chrome = subprocess.Popen([
    'google-chrome', '--headless', '--remote-debugging-port=9222',
    '--disable-gpu', '--no-sandbox'
])
time.sleep(2)  # Wait for Chrome to start

# Connect to Chrome DevTools
ws_url = json.loads(subprocess.check_output(
    ['curl', '-s', 'http://localhost:9222/json']
))['0']['webSocketDebuggerUrl']

ws = websocket.create_connection(ws_url)

# Navigate to page
ws.send(json.dumps({'id': 1, 'method': 'Page.navigate', 'params': {'url': 'http://localhost:3000'}}))
time.sleep(2)  # Wait for page load

# ... your automation logic

ws.close()
chrome.terminate()
```

## Reconnaissance-Then-Action Pattern

1. **Inspect rendered DOM**:
   ```python
   # Take screenshot
   ws.send(json.dumps({'id': 2, 'method': 'Page.captureScreenshot'}))

   # Get DOM content
   ws.send(json.dumps({'id': 3, 'method': 'Runtime.evaluate',
                       'params': {'expression': 'document.documentElement.outerHTML'}}))

   # Query elements
   ws.send(json.dumps({'id': 4, 'method': 'Runtime.evaluate',
                       'params': {'expression': 'document.querySelectorAll("button").length'}}))
   ```

2. **Identify selectors** from inspection results

3. **Execute actions** using discovered selectors via Runtime.evaluate

## Common Pitfall

❌ **Don't** inspect the DOM immediately after navigation on dynamic apps
✅ **Do** wait for page load events or use appropriate timeouts before inspection

## Best Practices

- **Use bundled scripts as black boxes** - To accomplish a task, consider whether one of the scripts available in `scripts/` can help. These scripts handle common, complex workflows reliably without cluttering the context window. Use `--help` to see usage, then invoke directly.
- Always terminate Chrome processes when done
- Use CSS selectors or XPath for element selection
- Add appropriate waits: explicit timeouts or load event listeners
- Handle CDP responses asynchronously - wait for responses before next command
- For React/Next.js apps, wait for hydration before interacting with components

## Reference Files

- **examples/** - Examples showing common patterns:
  - `element_discovery.py` - Discovering buttons, links, and inputs using CDP
  - `static_html_automation.py` - Testing static HTML files with CDP
  - `console_logging.py` - Capturing console logs via Chrome DevTools
  - `nextjs_testing.py` - Testing Next.js/React applications with hydration handling