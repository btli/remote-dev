import subprocess
import json
import time
import websocket
import base64

# Example: Testing Next.js/React applications with proper hydration handling

url = 'http://localhost:3000'  # Default Next.js dev server port

# Launch Chrome with remote debugging
chrome = subprocess.Popen([
    'google-chrome', '--headless', '--remote-debugging-port=9222',
    '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'
], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

time.sleep(2)  # Wait for Chrome to start

# Get WebSocket URL
ws_url_response = subprocess.check_output(['curl', '-s', 'http://localhost:9222/json'])
targets = json.loads(ws_url_response)
ws_url = targets[0]['webSocketDebuggerUrl']

# Connect to Chrome DevTools
ws = websocket.create_connection(ws_url)

# Enable necessary domains
ws.send(json.dumps({'id': 1, 'method': 'Runtime.enable'}))
ws.recv()

ws.send(json.dumps({'id': 2, 'method': 'Page.enable'}))
ws.recv()

ws.send(json.dumps({'id': 3, 'method': 'Network.enable'}))
ws.recv()

print(f"Navigating to {url}...")

# Navigate to Next.js page
ws.send(json.dumps({'id': 4, 'method': 'Page.navigate', 'params': {'url': url}}))

# Wait for initial page load
time.sleep(2)

# Wait for React hydration to complete
# This is critical for Next.js/React apps that use SSR/SSG
print("Waiting for React hydration...")
ws.send(json.dumps({
    'id': 5,
    'method': 'Runtime.evaluate',
    'params': {
        'expression': '''
            new Promise((resolve) => {
                // Check if React has hydrated by looking for common indicators
                const checkHydration = () => {
                    // Check if React DevTools hook exists (indicates React is running)
                    if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
                        return true;
                    }
                    // Alternative: check if Next.js router is ready
                    if (window.next && window.next.router) {
                        return true;
                    }
                    return false;
                };

                if (checkHydration()) {
                    resolve(true);
                } else {
                    // Wait up to 5 seconds for hydration
                    let attempts = 0;
                    const interval = setInterval(() => {
                        attempts++;
                        if (checkHydration() || attempts > 50) {
                            clearInterval(interval);
                            resolve(true);
                        }
                    }, 100);
                }
            })
        ''',
        'awaitPromise': True
    }
}))
ws.recv()

print("React hydration complete")

# Take screenshot after hydration
ws.send(json.dumps({
    'id': 6,
    'method': 'Page.captureScreenshot',
    'params': {'format': 'png'}
}))

response = json.loads(ws.recv())
screenshot_data = response['result']['data']

with open('/mnt/user-data/outputs/nextjs_initial.png', 'wb') as f:
    f.write(base64.b64decode(screenshot_data))

print("Initial screenshot saved")

# Example: Interact with React components
# Click a button and wait for state update
print("\nInteracting with React components...")

ws.send(json.dumps({
    'id': 7,
    'method': 'Runtime.evaluate',
    'params': {
        'expression': '''
            (function() {
                // Find and click a button
                const buttons = Array.from(document.querySelectorAll('button'));
                if (buttons.length > 0) {
                    buttons[0].click();
                    return {
                        clicked: true,
                        buttonText: buttons[0].innerText
                    };
                }
                return { clicked: false };
            })()
        ''',
        'returnByValue': True
    }
}))

response = json.loads(ws.recv())
result = response['result']['result']['value']
if result['clicked']:
    print(f"Clicked button: {result['buttonText']}")

# Wait for React state update and re-render
time.sleep(0.5)

# Example: Navigate using Next.js Link components
print("\nTesting Next.js routing...")

ws.send(json.dumps({
    'id': 8,
    'method': 'Runtime.evaluate',
    'params': {
        'expression': '''
            (function() {
                // Find Next.js Link components (rendered as <a> tags)
                const links = Array.from(document.querySelectorAll('a[href^="/"]'));
                if (links.length > 0) {
                    const link = links[0];
                    link.click();
                    return {
                        navigated: true,
                        href: link.getAttribute('href')
                    };
                }
                return { navigated: false };
            })()
        ''',
        'returnByValue': True
    }
}))

response = json.loads(ws.recv())
result = response['result']['result']['value']
if result['navigated']:
    print(f"Navigated to: {result['href']}")
    time.sleep(1)  # Wait for client-side navigation

# Example: Check for hydration errors
print("\nChecking for React hydration errors...")

ws.send(json.dumps({
    'id': 9,
    'method': 'Runtime.evaluate',
    'params': {
        'expression': '''
            (function() {
                // Check console for hydration warnings
                const logs = window.__CONSOLE_LOGS__ || [];
                const hydrationErrors = logs.filter(log =>
                    log.includes('Hydration') || log.includes('hydration')
                );
                return {
                    hasErrors: hydrationErrors.length > 0,
                    errors: hydrationErrors
                };
            })()
        ''',
        'returnByValue': True
    }
}))

response = json.loads(ws.recv())
result = response['result']['result']['value']
if result['hasErrors']:
    print(f"⚠️ Hydration errors detected: {result['errors']}")
else:
    print("✓ No hydration errors detected")

# Take final screenshot
ws.send(json.dumps({
    'id': 10,
    'method': 'Page.captureScreenshot',
    'params': {'format': 'png'}
}))

response = json.loads(ws.recv())
screenshot_data = response['result']['data']

with open('/mnt/user-data/outputs/nextjs_final.png', 'wb') as f:
    f.write(base64.b64decode(screenshot_data))

print("\nFinal screenshot saved to /mnt/user-data/outputs/nextjs_final.png")

# Get page performance metrics
print("\nGathering performance metrics...")

ws.send(json.dumps({
    'id': 11,
    'method': 'Runtime.evaluate',
    'params': {
        'expression': '''
            (function() {
                const perf = performance.getEntriesByType('navigation')[0];
                return {
                    domContentLoaded: Math.round(perf.domContentLoadedEventEnd - perf.fetchStart),
                    loadComplete: Math.round(perf.loadEventEnd - perf.fetchStart)
                };
            })()
        ''',
        'returnByValue': True
    }
}))

response = json.loads(ws.recv())
metrics = response['result']['result']['value']
print(f"DOM Content Loaded: {metrics['domContentLoaded']}ms")
print(f"Load Complete: {metrics['loadComplete']}ms")

# Close connection and terminate Chrome
ws.close()
chrome.terminate()
chrome.wait()

print("\nNext.js/React testing completed!")
