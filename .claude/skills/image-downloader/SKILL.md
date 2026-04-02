---
name: image-downloader
description: Download images from websites to local directory with intelligent renaming and metadata insertion. Supports authenticated downloads using cookies and session tokens from Chrome DevTools. Use when users need to save images from URLs (including login-protected sites), rename downloaded files systematically, or embed metadata (title, author, copyright, source URL) into image files. Supports JPEG, PNG, TIFF, WebP with EXIF/PNG metadata standards.
---

# Image Downloader

Download images from URLs with intelligent naming strategies and comprehensive metadata support.

## Quick Start

Basic download from URL:
```bash
python scripts/download_image.py https://example.com/image.jpg
```

Download with metadata:
```bash
python scripts/download_image.py https://example.com/photo.jpg \
  --title "Mountain Landscape" \
  --author "Jane Smith" \
  --source-url
```

## Core Operations

### Download Single Image

Download to current directory:
```bash
python scripts/download_image.py <url>
```

Download to specific directory:
```bash
python scripts/download_image.py <url> --output-dir ./images
```

### Download Multiple Images

Batch download from multiple URLs:
```bash
python scripts/download_image.py <url1> <url2> <url3> --output-dir ./downloads
```

### Naming Strategies

**Strategy 1: URL-based (default)**
Extracts filename from URL, sanitizes characters:
```bash
python scripts/download_image.py https://example.com/sunset.jpg
# Output: sunset.jpg
```

**Strategy 2: Timestamp**
Uses current timestamp for unique filenames:
```bash
python scripts/download_image.py <url> --filename-strategy timestamp
# Output: image_20250124_143022_123.jpg
```

**Strategy 3: Hash**
Uses URL hash for consistent, deduplicated filenames:
```bash
python scripts/download_image.py <url> --filename-strategy hash
# Output: d41d8cd98f00b204e9800998ecf8427e.jpg
```

**Strategy 4: Custom**
User-specified filename:
```bash
python scripts/download_image.py <url> --filename custom_name.jpg --filename-strategy custom
```

### Adding Metadata

Embed metadata into downloaded images:
```bash
python scripts/download_image.py <url> \
  --title "Image Title" \
  --author "Photographer Name" \
  --description "Detailed description" \
  --copyright "© 2025 Copyright Holder" \
  --source-url
```

**Supported metadata fields:**
- `--title`: Image title/name
- `--author`: Creator/photographer
- `--description`: Detailed description
- `--copyright`: Copyright notice
- `--source-url`: Stores original URL in metadata

**Format support:**
- JPEG/TIFF: Full EXIF metadata
- PNG: PNG text chunks
- WebP: Limited EXIF support
- GIF/BMP: No metadata support

### Additional Options

Display image information after download:
```bash
python scripts/download_image.py <url> --info
```

Set download timeout:
```bash
python scripts/download_image.py <url> --timeout 60
```

## Authentication & Session Support

Download images from login-protected or authenticated websites using cookies and custom headers.

### Using Cookies from Chrome DevTools

**Method 1: Cookie File (Recommended)**

Export cookies as JSON and use with `--cookies`:
```bash
python scripts/download_image.py <url> --cookies cookies.json
```

**Method 2: Inline Cookie String**

Copy cookie string from DevTools and use with `--cookie`:
```bash
python scripts/download_image.py <url> \
  --cookie "session_id=abc123; auth_token=xyz789"
```

### Using Bearer Tokens

For API authentication with Bearer tokens:
```bash
python scripts/download_image.py <url> \
  --header "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

### Using Custom Headers

**Method 1: Headers File**

Create `headers.json`:
```json
{
  "Authorization": "Bearer YOUR_TOKEN",
  "X-API-Key": "your-api-key",
  "X-CSRF-Token": "csrf-token"
}
```

Use with `--headers`:
```bash
python scripts/download_image.py <url> --headers headers.json
```

**Method 2: Inline Headers**

Add individual headers with `--header` (can be used multiple times):
```bash
python scripts/download_image.py <url> \
  --header "Authorization: Bearer TOKEN" \
  --header "X-API-Key: KEY"
```

### Combined Authentication

Use cookies and headers together:
```bash
python scripts/download_image.py <url> \
  --cookies cookies.json \
  --header "X-CSRF-Token: TOKEN"
```

### Extracting Session Data from Chrome DevTools

For detailed step-by-step instructions on extracting cookies, bearer tokens, and headers from Chrome DevTools:

```bash
cat references/authentication_guide.md
```

This guide covers:
- Exporting cookies as JSON from Application tab
- Copying cookie strings from Network tab
- Extracting Bearer tokens from Authorization headers
- Creating custom header files
- Common authentication patterns (Session, JWT, API Keys, OAuth)
- Troubleshooting authentication issues

### Additional Options

Display image information after download:
```bash
python scripts/download_image.py <url> --info
```

Set download timeout:
```bash
python scripts/download_image.py <url> --timeout 60
```

## Common Workflows

### Archiving Web Images
Download images with timestamp naming for archival:
```bash
python scripts/download_image.py <url> \
  --filename-strategy timestamp \
  --output-dir ./archive \
  --source-url \
  --info
```

### Building Image Library
Download with descriptive metadata:
```bash
python scripts/download_image.py <url> \
  --title "Project Screenshot" \
  --author "Team Name" \
  --description "Feature X implementation" \
  --output-dir ./library
```

### Batch Collection
Download multiple images to organized directory:
```bash
python scripts/download_image.py \
  https://example.com/img1.jpg \
  https://example.com/img2.jpg \
  https://example.com/img3.jpg \
  --output-dir ./collection \
  --source-url
```

### Authenticated Download from Protected Site
Download images requiring login using cookies:
```bash
# 1. Login to site in Chrome
# 2. Extract cookies using Chrome DevTools (see authentication_guide.md)
# 3. Download with cookies
python scripts/download_image.py <protected-url> \
  --cookies cookies.json \
  --output-dir ./protected-downloads
```

### API Image Download with Bearer Token
Download from API endpoint requiring authentication:
```bash
python scripts/download_image.py https://api.example.com/images/123.jpg \
  --header "Authorization: Bearer YOUR_JWT_TOKEN" \
  --title "API Image" \
  --output-dir ./api-downloads
```

### Download from Site with CSRF Protection
Download from site requiring both cookies and CSRF token:
```bash
python scripts/download_image.py <url> \
  --cookies cookies.json \
  --header "X-CSRF-Token: YOUR_CSRF_TOKEN" \
  --header "Referer: https://example.com"
```

## Technical Details

### Dependencies
The script requires these Python packages:
- `requests` - HTTP client
- `Pillow` - Image processing
- `piexif` - EXIF metadata

Install with:
```bash
pip install requests pillow piexif --break-system-packages
```

### File Handling
- **Duplicates**: Appends `_N` counter if filename exists
- **Character sanitization**: Removes/replaces unsafe characters
- **Length limits**: Filenames capped at 200 characters
- **Extension preservation**: Maintains original file extensions

### Error Handling
- HTTP errors reported but non-fatal for batch operations
- Metadata writing failures warn but continue download
- Missing dependencies detected on startup
- Network timeouts configurable

## Reference Materials

### Metadata Standards and Technical Details

For detailed metadata standards, format support, and technical specifications:
```bash
cat references/metadata_guide.md
```

Contains:
- Complete metadata field reference
- Format support matrix (JPEG, PNG, TIFF, WebP, etc.)
- Filename strategy details
- Common use case examples
- Technical implementation details

### Authentication and Session Management

For step-by-step instructions on extracting cookies and session data from Chrome DevTools:
```bash
cat references/authentication_guide.md
```

Contains:
- **Method 1**: Export cookies as JSON from Application tab
- **Method 2**: Copy cookie strings from Network tab  
- **Method 3**: Extract Bearer tokens from Authorization headers
- **Method 4**: Create custom header files
- **Common patterns**: Session cookies, JWT tokens, API keys, OAuth, CSRF
- **Troubleshooting**: 401/403 errors, expired tokens, missing headers
- **Security practices**: Safe handling of credentials
- **Quick reference**: Authentication type lookup table
