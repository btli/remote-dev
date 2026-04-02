import subprocess
import json
import time
import websocket
import base64
import os

# Example: Automating interaction with static HTML files using Chrome DevTools Protocol

html_file_path = os.path.abspath('path/to/your/file.html')
file_url = f'file://{html_file_path}'

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

# Navigate to local HTML file
print(f"Loading {file_url}...")
ws.send(json.dumps({'id': 3, 'method': 'Page.navigate', 'params': {'url': file_url}}))
time.sleep(1)  # Wait for page to load

# Take initial screenshot
ws.send(json.dumps({
    'id': 4,
    'method': 'Page.captureScreenshot',
    'params': {'format': 'png', 'captureBeyondViewport': True}
}))

response = json.loads(ws.recv())
screenshot_data = response['result']['data']

with open('/mnt/user-data/outputs/static_page.png', 'wb') as f:
    f.write(base64.b64decode(screenshot_data))

print("Initial screenshot saved to /mnt/user-data/outputs/static_page.png")

# Interact with elements - click a button
print("Clicking button with text 'Click Me'...")
ws.send(json.dumps({
    'id': 5,
    'method': 'Runtime.evaluate',
    'params': {
        'expression': '''
            (function() {
                const buttons = Array.from(document.querySelectorAll('button'));
                const btn = buttons.find(b => b.innerText.includes('Click Me'));
                if (btn) {
                    btn.click();
                    return true;
                }
                return false;
            })()
        ''',
        'returnByValue': True
    }
}))
ws.recv()

# Fill form fields
print("Filling form fields...")
ws.send(json.dumps({
    'id': 6,
    'method': 'Runtime.evaluate',
    'params': {
        'expression': '''
            (function() {
                const nameInput = document.querySelector('#name');
                const emailInput = document.querySelector('#email');
                if (nameInput) nameInput.value = 'John Doe';
                if (emailInput) emailInput.value = 'john@example.com';
                return {
                    nameFilled: !!nameInput,
                    emailFilled: !!emailInput
                };
            })()
        ''',
        'returnByValue': True
    }
}))
ws.recv()

# Submit form
print("Submitting form...")
ws.send(json.dumps({
    'id': 7,
    'method': 'Runtime.evaluate',
    'params': {
        'expression': '''
            (function() {
                const submitBtn = document.querySelector('button[type="submit"]');
                if (submitBtn) {
                    submitBtn.click();
                    return true;
                }
                return false;
            })()
        ''',
        'returnByValue': True
    }
}))
ws.recv()

time.sleep(0.5)  # Wait for any form submission effects

# Take final screenshot
ws.send(json.dumps({
    'id': 8,
    'method': 'Page.captureScreenshot',
    'params': {'format': 'png', 'captureBeyondViewport': True}
}))

response = json.loads(ws.recv())
screenshot_data = response['result']['data']

with open('/mnt/user-data/outputs/after_submit.png', 'wb') as f:
    f.write(base64.b64decode(screenshot_data))

print("Final screenshot saved to /mnt/user-data/outputs/after_submit.png")

# Close connection and terminate Chrome
ws.close()
chrome.terminate()
chrome.wait()

print("\nStatic HTML automation completed!")
