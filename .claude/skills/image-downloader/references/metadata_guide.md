# Image Metadata Reference

## Supported Metadata Fields

### EXIF Metadata (JPEG, TIFF)

Standard EXIF fields that can be written to images:

- **title**: Image title/name (maps to `ImageDescription`)
- **author**: Creator/photographer name (maps to `Artist`)
- **copyright**: Copyright notice (maps to `Copyright`)
- **description**: Detailed description (maps to `ImageDescription`)
- **source_url**: Original URL where image was downloaded from (stored in `UserComment`)

### PNG Metadata

PNG images use text chunks (tEXt, zTXt, iTXt) for metadata storage. All metadata fields are stored as key-value text pairs.

### Format Support Matrix

| Format | EXIF | PNG Chunks | XMP | Notes |
|--------|------|------------|-----|-------|
| JPEG   | ✓    | -          | ✓   | Best metadata support |
| PNG    | -    | ✓          | ✓   | Use tEXt chunks |
| WebP   | ✓    | -          | ✓   | Limited EXIF |
| TIFF   | ✓    | -          | ✓   | Full EXIF support |
| GIF    | -    | -          | -   | No metadata support |
| BMP    | -    | -          | -   | No metadata support |

## Filename Strategies

### url (default)
Extracts filename from the URL path. Sanitizes unsafe characters.
- Example: `https://example.com/sunset.jpg` → `sunset.jpg`
- Fallback: Uses domain + hash if no filename in URL

### timestamp
Generates filename using current timestamp.
- Format: `image_YYYYMMDD_HHMMSS_mmm.ext`
- Example: `image_20250124_143022_123.jpg`

### hash
Uses MD5 hash of the URL as filename.
- Example: `d41d8cd98f00b204e9800998ecf8427e.jpg`
- Good for: Deduplication, consistent naming

### custom
Uses user-provided filename.
- Requires: `--filename` argument
- Example: `--filename "my_photo.jpg"`

## Common Use Cases

### Basic Download
```bash
scripts/download_image.py https://example.com/image.jpg
```

### Download with Metadata
```bash
scripts/download_image.py https://example.com/photo.jpg \
  --title "Sunset at Beach" \
  --author "John Doe" \
  --description "Beautiful sunset photograph" \
  --copyright "© 2025 John Doe" \
  --source-url
```

### Batch Download
```bash
scripts/download_image.py \
  https://example.com/img1.jpg \
  https://example.com/img2.jpg \
  https://example.com/img3.jpg \
  --output-dir ./downloads
```

### Download with Timestamp Naming
```bash
scripts/download_image.py https://example.com/image.jpg \
  --filename-strategy timestamp \
  --output-dir ./archive
```

## Technical Details

### Dependencies
- **requests**: HTTP client for downloading
- **Pillow (PIL)**: Image processing and basic metadata
- **piexif**: EXIF metadata reading/writing

### Character Sanitization
Unsafe characters removed from filenames:
- `< > : " / \ | ? *` → replaced with `_`
- Control characters (0x00-0x1f, 0x7f) → removed
- Filename length limited to 200 characters (excluding extension)

### Duplicate Handling
If a file with the same name exists, appends `_N` counter:
- `image.jpg` → `image_1.jpg` → `image_2.jpg`

### Error Handling
- HTTP errors (404, 403, etc.) are caught and reported
- Network timeouts configurable with `--timeout`
- Metadata writing failures are non-fatal (warns but continues)
- Missing dependencies detected on startup
