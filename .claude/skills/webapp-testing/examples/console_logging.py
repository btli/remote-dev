import subprocess
import json
import time
import websocket
import base64

# Example: Capturing console logs using Chrome DevTools Protocol

url = 'http://localhost:3000'  # Replace with your URL

console_logs = []

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

# Enable Console domain to receive console messages
ws.send(json.dumps({'id': 1, 'method': 'Console.enable'}))
ws.recv()  # Wait for response

# Enable Runtime domain
ws.send(json.dumps({'id': 2, 'method': 'Runtime.enable'}))
ws.recv()

# Navigate to page
ws.send(json.dumps({'id': 3, 'method': 'Page.navigate', 'params': {'url': url}}))

# Collect console messages for a few seconds
print(f"Navigating to {url}...")
start_time = time.time()

# Listen for console messages
while time.time() - start_time < 5:  # Collect logs for 5 seconds
    try:
        ws.settimeout(0.5)
        response = ws.recv()
        msg = json.loads(response)

        # Check if this is a console message
        if 'method' in msg and msg['method'] == 'Runtime.consoleAPICalled':
            params = msg['params']
            log_type = params['type']
            args = params['args']

            # Extract message text from args
            message_parts = []
            for arg in args:
                if 'value' in arg:
                    message_parts.append(str(arg['value']))
                elif 'description' in arg:
                    message_parts.append(arg['description'])

            message = ' '.join(message_parts)
            log_entry = f"[{log_type}] {message}"
            console_logs.append(log_entry)
            print(f"Console: {log_entry}")

    except websocket.WebSocketTimeoutException:
        continue
    except Exception as e:
        break

# Close connection and terminate Chrome
ws.close()
chrome.terminate()
chrome.wait()

# Save console logs to file
output_path = '/mnt/user-data/outputs/console.log'
with open(output_path, 'w') as f:
    f.write('\n'.join(console_logs))

print(f"\nCaptured {len(console_logs)} console messages")
print(f"Logs saved to: {output_path}")
