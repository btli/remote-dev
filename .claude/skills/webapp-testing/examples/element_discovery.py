import subprocess
import json
import time
import websocket
import base64

# Example: Discovering buttons and other elements using Chrome DevTools Protocol

url = 'http://localhost:3000'  # Replace with your URL

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

# Navigate to page
ws.send(json.dumps({'id': 3, 'method': 'Page.navigate', 'params': {'url': url}}))
time.sleep(3)  # Wait for page to load

print(f"Discovering elements on {url}...\n")

# Discover all buttons
ws.send(json.dumps({
    'id': 4,
    'method': 'Runtime.evaluate',
    'params': {
        'expression': '''
            Array.from(document.querySelectorAll('button')).map((btn, i) => ({
                index: i,
                text: btn.innerText.trim(),
                visible: btn.offsetParent !== null,
                id: btn.id,
                className: btn.className
            }))
        ''',
        'returnByValue': True
    }
}))

response = json.loads(ws.recv())
buttons = response['result']['result']['value']
print(f"Found {len(buttons)} buttons:")
for btn in buttons:
    visibility = "visible" if btn['visible'] else "hidden"
    text = btn['text'] or "[no text]"
    print(f"  [{btn['index']}] {text} ({visibility})")

# Discover links
ws.send(json.dumps({
    'id': 5,
    'method': 'Runtime.evaluate',
    'params': {
        'expression': '''
            Array.from(document.querySelectorAll('a[href]')).slice(0, 5).map(link => ({
                text: link.innerText.trim(),
                href: link.getAttribute('href')
            }))
        ''',
        'returnByValue': True
    }
}))

response = json.loads(ws.recv())
links = response['result']['result']['value']
print(f"\nFound links (showing first 5):")
for link in links:
    text = link['text'] or "[no text]"
    print(f"  - {text} -> {link['href']}")

# Discover input fields
ws.send(json.dumps({
    'id': 6,
    'method': 'Runtime.evaluate',
    'params': {
        'expression': '''
            Array.from(document.querySelectorAll('input, textarea, select')).map(input => ({
                name: input.name || input.id || '[unnamed]',
                type: input.type || input.tagName.toLowerCase(),
                placeholder: input.placeholder || ''
            }))
        ''',
        'returnByValue': True
    }
}))

response = json.loads(ws.recv())
inputs = response['result']['result']['value']
print(f"\nFound {len(inputs)} input fields:")
for inp in inputs:
    placeholder = f" placeholder='{inp['placeholder']}'" if inp['placeholder'] else ""
    print(f"  - {inp['name']} ({inp['type']}){placeholder}")

# Take screenshot for visual reference
ws.send(json.dumps({
    'id': 7,
    'method': 'Page.captureScreenshot',
    'params': {'format': 'png'}
}))

response = json.loads(ws.recv())
screenshot_data = response['result']['data']
screenshot_path = '/tmp/page_discovery.png'

with open(screenshot_path, 'wb') as f:
    f.write(base64.b64decode(screenshot_data))

print(f"\nScreenshot saved to {screenshot_path}")

# Close connection and terminate Chrome
ws.close()
chrome.terminate()
chrome.wait()
