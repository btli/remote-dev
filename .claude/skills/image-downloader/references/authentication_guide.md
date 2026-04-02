# Authentication Guide - Extracting Session Data from Chrome DevTools

This guide explains how to extract cookies and session data from Chrome DevTools to download images from authenticated/login-protected websites.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Method 1: Export Cookies as JSON](#method-1-export-cookies-as-json)
3. [Method 2: Copy Cookie String](#method-2-copy-cookie-string)
4. [Method 3: Extract Bearer Tokens](#method-3-extract-bearer-tokens)
5. [Method 4: Custom Headers](#method-4-custom-headers)
6. [Common Authentication Patterns](#common-authentication-patterns)
7. [Troubleshooting](#troubleshooting)

## Quick Start

**Goal**: Download an image from a website that requires login

**Steps**:
1. Log into the website in Chrome
2. Open DevTools (F12 or Right-click → Inspect)
3. Navigate to the image you want to download
4. Extract cookies using one of the methods below
5. Use the extracted data with the download script

## Method 1: Export Cookies as JSON

### Step-by-Step Instructions

1. **Open Chrome DevTools**
   - Press `F12` or `Ctrl+Shift+I` (Windows/Linux)
   - Press `Cmd+Option+I` (Mac)
   - Or Right-click → Inspect

2. **Navigate to Application Tab**
   - Click on the "Application" tab in DevTools
   - If you don't see it, click the `>>` button to show more tabs

3. **Access Cookies**
   - In the left sidebar, expand "Storage" → "Cookies"
   - Click on the domain (e.g., `https://example.com`)

4. **View All Cookies**
   - You'll see a table with all cookies for that domain
   - Columns: Name, Value, Domain, Path, Expires, etc.

5. **Export Cookies**

   **Option A: Use Browser Console (Recommended)**
   
   Switch to the "Console" tab and run this JavaScript:
   
   ```javascript
   // Export all cookies for current domain as JSON
   copy(JSON.stringify(
     document.cookie.split('; ').reduce((acc, cookie) => {
       const [name, value] = cookie.split('=');
       acc.push({name: name, value: decodeURIComponent(value)});
       return acc;
     }, []),
     null, 2
   ))
   ```
   
   This copies the JSON to your clipboard. Paste into a file called `cookies.json`

   **Option B: Manual Copy (Alternative)**
   
   Create a `cookies.json` file manually:
   ```json
   [
     {
       "name": "session_id",
       "value": "abc123def456"
     },
     {
       "name": "auth_token", 
       "value": "xyz789"
     },
     {
       "name": "user_id",
       "value": "12345"
     }
   ]
   ```

6. **Use with Download Script**
   ```bash
   python scripts/download_image.py \
     https://example.com/protected/image.jpg \
     --cookies cookies.json
   ```

### Alternative JSON Format

The script also accepts simple key-value format:

```json
{
  "session_id": "abc123def456",
  "auth_token": "xyz789",
  "user_id": "12345"
}
```

## Method 2: Copy Cookie String

### Step-by-Step Instructions

1. **Open Chrome DevTools** (F12)

2. **Go to Network Tab**
   - Click on the "Network" tab
   - Refresh the page (F5) if needed to see requests

3. **Find a Request to the Domain**
   - Look for any request to the target domain
   - Click on it to see details

4. **Copy Cookie Header**
   - In the "Headers" section, scroll to "Request Headers"
   - Find the "Cookie:" header
   - Right-click the cookie value → Copy

   Example cookie string:
   ```
   session_id=abc123def456; auth_token=xyz789; user_id=12345
   ```

5. **Use with Download Script**
   ```bash
   python scripts/download_image.py \
     https://example.com/protected/image.jpg \
     --cookie "session_id=abc123def456; auth_token=xyz789; user_id=12345"
   ```

## Method 3: Extract Bearer Tokens

Many modern APIs use Bearer tokens in the Authorization header.

### Step-by-Step Instructions

1. **Open Chrome DevTools** (F12) → **Network tab**

2. **Perform the Action**
   - Navigate to the page or perform an action that loads the image
   - Watch for API requests in the Network tab

3. **Find the API Request**
   - Look for requests to image endpoints
   - Click on a request that successfully loads an image

4. **Copy Authorization Header**
   - In "Headers" section → "Request Headers"
   - Find "Authorization:" header
   - Copy the value (usually starts with "Bearer ")

   Example:
   ```
   Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

5. **Use with Download Script**
   ```bash
   python scripts/download_image.py \
     https://api.example.com/images/12345.jpg \
     --header "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
   ```

## Method 4: Custom Headers

Some sites require additional custom headers.

### Extracting All Request Headers

1. **Open DevTools** (F12) → **Network tab**

2. **Find the Image Request**
   - Navigate to the image or refresh the page
   - Click on the image request in the Network tab

3. **Copy All Request Headers**

   **Option A: Copy as cURL (Recommended)**
   - Right-click on the request → "Copy" → "Copy as cURL (bash)"
   - This gives you the complete request with all headers
   
   **Option B: Manual Extraction**
   - In "Headers" section, note all relevant headers
   - Common important headers:
     - `Authorization`
     - `X-API-Key`
     - `X-CSRF-Token`
     - `Referer`
     - `Origin`

4. **Create headers.json**
   
   ```json
   {
     "Authorization": "Bearer eyJhbGciOiJIUzI1NiIs...",
     "X-API-Key": "your-api-key-here",
     "X-CSRF-Token": "csrf-token-value",
     "Referer": "https://example.com/page"
   }
   ```

5. **Use with Download Script**
   ```bash
   python scripts/download_image.py \
     https://example.com/api/image.jpg \
     --headers headers.json
   ```

   Or inline:
   ```bash
   python scripts/download_image.py \
     https://example.com/api/image.jpg \
     --header "Authorization: Bearer TOKEN" \
     --header "X-API-Key: KEY" \
     --header "Referer: https://example.com"
   ```

## Common Authentication Patterns

### Pattern 1: Session Cookies (Traditional Web Apps)

**Indicators:**
- Login form on website
- Cookies set after login
- Cookie names like `session_id`, `PHPSESSID`, `connect.sid`

**Solution:**
```bash
# Extract cookies using Method 1 or 2
python scripts/download_image.py URL --cookies cookies.json
```

### Pattern 2: JWT Bearer Tokens (Modern APIs)

**Indicators:**
- API endpoints (e.g., `/api/v1/images/`)
- Authorization header with Bearer token
- Token looks like: `eyJhbGc...` (Base64-encoded JWT)

**Solution:**
```bash
python scripts/download_image.py URL \
  --header "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Pattern 3: API Keys

**Indicators:**
- Custom header like `X-API-Key`
- Key in query parameter (e.g., `?api_key=xxx`)

**Solution:**
```bash
# Header-based
python scripts/download_image.py URL \
  --header "X-API-Key: YOUR_API_KEY"

# Query parameter (add to URL)
python scripts/download_image.py \
  "https://example.com/image.jpg?api_key=YOUR_KEY"
```

### Pattern 4: CSRF Tokens + Cookies

**Indicators:**
- Requires both cookies AND CSRF token header
- Common in frameworks like Django, Rails

**Solution:**
```bash
python scripts/download_image.py URL \
  --cookies cookies.json \
  --header "X-CSRF-Token: YOUR_CSRF_TOKEN"
```

### Pattern 5: OAuth 2.0

**Indicators:**
- Login via third-party (Google, GitHub, etc.)
- Access token in Authorization header

**Solution:**
```bash
python scripts/download_image.py URL \
  --header "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Troubleshooting

### Problem: "401 Unauthorized" Error

**Causes:**
- Expired session/token
- Missing required cookies
- Missing required headers

**Solutions:**
1. Re-login and extract fresh cookies/tokens
2. Check if all required cookies were exported
3. Verify header names are correct (case-sensitive)
4. Check if additional headers are needed (Referer, Origin)

### Problem: "403 Forbidden" Error

**Causes:**
- Missing CSRF token
- Missing Referer/Origin header
- IP-based restrictions
- Rate limiting

**Solutions:**
1. Add CSRF token if required
2. Add Referer header: `--header "Referer: https://example.com"`
3. Add Origin header: `--header "Origin: https://example.com"`
4. Wait and retry (rate limiting)

### Problem: Cookies Not Working

**Causes:**
- Copied incomplete cookie string
- Cookies expired
- Wrong domain

**Solutions:**
1. Use JSON export method instead of copy-paste
2. Check cookie expiration in DevTools
3. Ensure you're extracting cookies for the correct domain
4. Try extracting cookies immediately after login

### Problem: Headers Not Being Sent

**Solutions:**
1. Verify JSON format in headers file
2. Check for typos in header names
3. Use multiple `--header` flags for multiple headers
4. Ensure no extra whitespace in header values

## Security Best Practices

⚠️ **Important Security Notes:**

1. **Never share cookie/token files** - They provide access to your account
2. **Delete cookie files after use** - Don't leave them lying around
3. **Tokens expire** - You may need to re-extract periodically
4. **Use environment variables** - For sensitive tokens:
   ```bash
   export AUTH_TOKEN="your-token"
   python scripts/download_image.py URL --header "Authorization: Bearer $AUTH_TOKEN"
   ```

## Advanced: Automatic Cookie Extraction Script

For convenience, here's a helper script to extract cookies:

```javascript
// Run in Chrome DevTools Console
// Exports cookies as downloadable JSON file

const cookies = document.cookie.split('; ').reduce((acc, cookie) => {
  const [name, value] = cookie.split('=');
  acc[name] = decodeURIComponent(value);
  return acc;
}, {});

const blob = new Blob([JSON.stringify(cookies, null, 2)], {type: 'application/json'});
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'cookies.json';
a.click();
```

This automatically downloads a `cookies.json` file you can use directly.

## Quick Reference

| Authentication Type | Method | Script Usage |
|-------------------|---------|--------------|
| Session Cookies | Export from Application tab | `--cookies cookies.json` |
| Cookie String | Copy from Network tab | `--cookie "name=value; name2=value2"` |
| Bearer Token | Copy Authorization header | `--header "Authorization: Bearer TOKEN"` |
| API Key (header) | Copy custom header | `--header "X-API-Key: KEY"` |
| API Key (query) | Add to URL | Include in URL: `?api_key=KEY` |
| CSRF + Cookies | Both cookies and header | `--cookies cookies.json --header "X-CSRF-Token: TOKEN"` |
| Multiple Headers | Multiple headers needed | Multiple `--header` flags or `--headers file.json` |
