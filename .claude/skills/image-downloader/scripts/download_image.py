#!/usr/bin/env python3
"""
Image Downloader with Metadata Support

Downloads images from URLs, renames them intelligently, and adds metadata.
"""

import argparse
import hashlib
import json
import mimetypes
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any
from urllib.parse import urlparse, unquote

try:
    import requests
    from PIL import Image
    from PIL.ExifTags import TAGS
    import piexif
except ImportError as e:
    print(f"Error: Missing required library. Please install: pip install requests pillow piexif", file=sys.stderr)
    sys.exit(1)


class ImageDownloader:
    """Downloads and processes images with metadata support."""
    
    def __init__(self, output_dir: str = ".", timeout: int = 30, 
                 cookies: Dict[str, str] = None, headers: Dict[str, str] = None):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.timeout = timeout
        self.cookies = cookies or {}
        self.custom_headers = headers or {}
        
    def sanitize_filename(self, filename: str) -> str:
        """Remove unsafe characters from filename."""
        # Remove or replace unsafe characters
        filename = re.sub(r'[<>:"/\\|?*]', '_', filename)
        # Remove control characters
        filename = re.sub(r'[\x00-\x1f\x7f]', '', filename)
        # Limit length
        name, ext = filename.rsplit('.', 1) if '.' in filename else (filename, '')
        if len(name) > 200:
            name = name[:200]
        return f"{name}.{ext}" if ext else name
    
    def generate_filename(self, url: str, strategy: str = "url", custom_name: str = None) -> str:
        """Generate filename based on strategy."""
        parsed_url = urlparse(url)
        
        if strategy == "custom" and custom_name:
            return custom_name
        
        elif strategy == "url":
            # Extract filename from URL
            path = unquote(parsed_url.path)
            filename = Path(path).name
            if not filename or filename == '/':
                # Use domain and hash if no filename in URL
                domain = parsed_url.netloc.replace('.', '_')
                url_hash = hashlib.md5(url.encode()).hexdigest()[:8]
                filename = f"{domain}_{url_hash}.jpg"
            return self.sanitize_filename(filename)
        
        elif strategy == "timestamp":
            # Use timestamp
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]
            ext = Path(unquote(parsed_url.path)).suffix or '.jpg'
            return f"image_{timestamp}{ext}"
        
        elif strategy == "hash":
            # Use URL hash
            url_hash = hashlib.md5(url.encode()).hexdigest()
            ext = Path(unquote(parsed_url.path)).suffix or '.jpg'
            return f"{url_hash}{ext}"
        
        else:
            raise ValueError(f"Unknown filename strategy: {strategy}")
    
    def download_image(self, url: str, filename: str = None) -> Path:
        """Download image from URL."""
        print(f"Downloading from: {url}")
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        
        # Merge custom headers (they take precedence)
        headers.update(self.custom_headers)
        
        try:
            response = requests.get(
                url, 
                headers=headers, 
                cookies=self.cookies,
                timeout=self.timeout, 
                stream=True
            )
            response.raise_for_status()
            
            # Determine filename if not provided
            if not filename:
                # Try to get from Content-Disposition header
                content_disposition = response.headers.get('Content-Disposition', '')
                if 'filename=' in content_disposition:
                    filename = content_disposition.split('filename=')[1].strip('"\'')
                else:
                    filename = self.generate_filename(url, strategy="url")
            
            filename = self.sanitize_filename(filename)
            output_path = self.output_dir / filename
            
            # Handle duplicate filenames
            counter = 1
            original_stem = output_path.stem
            while output_path.exists():
                output_path = self.output_dir / f"{original_stem}_{counter}{output_path.suffix}"
                counter += 1
            
            # Download and save
            with open(output_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            print(f"✓ Downloaded to: {output_path}")
            return output_path
            
        except requests.exceptions.RequestException as e:
            print(f"✗ Download failed: {e}", file=sys.stderr)
            raise
    
    def add_metadata(self, image_path: Path, metadata: Dict[str, Any]) -> None:
        """Add metadata to image file."""
        try:
            img = Image.open(image_path)
            
            # Get existing EXIF data or create new
            try:
                exif_dict = piexif.load(str(image_path))
            except:
                exif_dict = {"0th": {}, "Exif": {}, "GPS": {}, "1st": {}}
            
            # Add custom metadata to EXIF
            if "title" in metadata:
                exif_dict["0th"][piexif.ImageIFD.ImageDescription] = metadata["title"].encode('utf-8')
            
            if "author" in metadata:
                exif_dict["0th"][piexif.ImageIFD.Artist] = metadata["author"].encode('utf-8')
            
            if "copyright" in metadata:
                exif_dict["0th"][piexif.ImageIFD.Copyright] = metadata["copyright"].encode('utf-8')
            
            if "description" in metadata:
                exif_dict["0th"][piexif.ImageIFD.ImageDescription] = metadata["description"].encode('utf-8')
            
            if "source_url" in metadata:
                # Store source URL in UserComment
                exif_dict["Exif"][piexif.ExifIFD.UserComment] = metadata["source_url"].encode('utf-8')
            
            # Add software tag
            exif_dict["0th"][piexif.ImageIFD.Software] = b"Claude Image Downloader"
            
            # Save with new EXIF data
            exif_bytes = piexif.dump(exif_dict)
            
            # Only certain formats support EXIF
            if img.format in ['JPEG', 'JPG', 'TIFF']:
                img.save(image_path, exif=exif_bytes, quality=95)
                print(f"✓ Added metadata to: {image_path.name}")
            else:
                # For formats that don't support EXIF, save with PNG metadata
                from PIL import PngImagePlugin
                meta = PngImagePlugin.PngInfo()
                
                for key, value in metadata.items():
                    meta.add_text(key, str(value))
                
                if img.format == 'PNG':
                    img.save(image_path, pnginfo=meta)
                    print(f"✓ Added PNG metadata to: {image_path.name}")
                else:
                    print(f"⚠ Format {img.format} has limited metadata support", file=sys.stderr)
                    
        except Exception as e:
            print(f"⚠ Could not add metadata: {e}", file=sys.stderr)
    
    def get_image_info(self, image_path: Path) -> Dict[str, Any]:
        """Extract information about the image."""
        try:
            img = Image.open(image_path)
            info = {
                "format": img.format,
                "mode": img.mode,
                "size": img.size,
                "width": img.width,
                "height": img.height,
                "file_size": image_path.stat().st_size,
            }
            
            # Try to read EXIF data
            try:
                exif_data = img._getexif()
                if exif_data:
                    info["exif"] = {TAGS.get(k, k): v for k, v in exif_data.items()}
            except:
                pass
            
            return info
        except Exception as e:
            return {"error": str(e)}


def load_cookies_from_file(cookie_file: Path) -> Dict[str, str]:
    """Load cookies from JSON file exported from Chrome DevTools."""
    try:
        with open(cookie_file, 'r') as f:
            cookie_data = json.load(f)
        
        cookies = {}
        
        # Handle different cookie export formats
        if isinstance(cookie_data, list):
            # Netscape/Chrome format: list of cookie objects
            for cookie in cookie_data:
                if isinstance(cookie, dict):
                    name = cookie.get('name') or cookie.get('Name')
                    value = cookie.get('value') or cookie.get('Value')
                    if name and value:
                        cookies[name] = value
        elif isinstance(cookie_data, dict):
            # Simple key-value format
            cookies = cookie_data
        
        print(f"✓ Loaded {len(cookies)} cookies from {cookie_file}")
        return cookies
        
    except Exception as e:
        print(f"✗ Failed to load cookies: {e}", file=sys.stderr)
        sys.exit(1)


def load_headers_from_file(header_file: Path) -> Dict[str, str]:
    """Load custom headers from JSON file."""
    try:
        with open(header_file, 'r') as f:
            headers = json.load(f)
        
        if not isinstance(headers, dict):
            raise ValueError("Headers file must contain a JSON object")
        
        print(f"✓ Loaded {len(headers)} custom headers from {header_file}")
        return headers
        
    except Exception as e:
        print(f"✗ Failed to load headers: {e}", file=sys.stderr)
        sys.exit(1)


def parse_cookie_string(cookie_str: str) -> Dict[str, str]:
    """Parse cookie string in 'name=value; name2=value2' format."""
    cookies = {}
    for item in cookie_str.split(';'):
        item = item.strip()
        if '=' in item:
            name, value = item.split('=', 1)
            cookies[name.strip()] = value.strip()
    return cookies


def main():
    parser = argparse.ArgumentParser(
        description="Download images from URLs with metadata support",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Basic download
  %(prog)s https://example.com/image.jpg
  
  # Download with custom name
  %(prog)s https://example.com/image.jpg --filename custom_name.jpg
  
  # Download with metadata
  %(prog)s https://example.com/image.jpg --title "Beautiful Sunset" --author "John Doe"
  
  # Download to specific directory
  %(prog)s https://example.com/image.jpg --output-dir ./downloads
  
  # Download with timestamp naming
  %(prog)s https://example.com/image.jpg --filename-strategy timestamp
  
  # Download multiple images
  %(prog)s https://example.com/img1.jpg https://example.com/img2.jpg
  
  # Download with authentication (cookies from file)
  %(prog)s https://example.com/protected/image.jpg --cookies cookies.json
  
  # Download with authentication (inline cookies)
  %(prog)s https://example.com/protected/image.jpg --cookie "session_id=abc123; auth_token=xyz789"
  
  # Download with custom headers
  %(prog)s https://example.com/api/image.jpg --headers headers.json
  
  # Download with bearer token
  %(prog)s https://example.com/api/image.jpg --header "Authorization: Bearer TOKEN_HERE"
        """
    )
    
    parser.add_argument("urls", nargs="+", help="Image URLs to download")
    parser.add_argument("-o", "--output-dir", default=".", help="Output directory (default: current directory)")
    parser.add_argument("-f", "--filename", help="Custom filename (only for single URL)")
    parser.add_argument("-s", "--filename-strategy", choices=["url", "timestamp", "hash", "custom"],
                        default="url", help="Filename generation strategy (default: url)")
    parser.add_argument("--title", help="Image title metadata")
    parser.add_argument("--author", help="Image author metadata")
    parser.add_argument("--description", help="Image description metadata")
    parser.add_argument("--copyright", help="Copyright information")
    parser.add_argument("--source-url", action="store_true", help="Store source URL in metadata")
    parser.add_argument("--timeout", type=int, default=30, help="Download timeout in seconds (default: 30)")
    parser.add_argument("--info", action="store_true", help="Display image information after download")
    
    # Authentication options
    auth_group = parser.add_argument_group("Authentication Options")
    auth_group.add_argument("--cookies", type=Path, help="Path to JSON file containing cookies (exported from Chrome DevTools)")
    auth_group.add_argument("--cookie", help="Cookie string in 'name=value; name2=value2' format")
    auth_group.add_argument("--headers", type=Path, help="Path to JSON file containing custom headers")
    auth_group.add_argument("--header", action="append", dest="header_list", help="Add custom header in 'Name: Value' format (can be used multiple times)")
    
    args = parser.parse_args()
    
    # Validate arguments
    if args.filename and len(args.urls) > 1:
        print("Error: --filename can only be used with a single URL", file=sys.stderr)
        sys.exit(1)
    
    if args.filename and args.filename_strategy != "custom":
        print("Warning: --filename requires --filename-strategy custom", file=sys.stderr)
        args.filename_strategy = "custom"
    
    # Load cookies
    cookies = {}
    if args.cookies:
        cookies = load_cookies_from_file(args.cookies)
    elif args.cookie:
        cookies = parse_cookie_string(args.cookie)
        print(f"✓ Parsed {len(cookies)} cookies from command line")
    
    # Load headers
    custom_headers = {}
    if args.headers:
        custom_headers = load_headers_from_file(args.headers)
    
    # Add individual headers from --header arguments
    if args.header_list:
        for header in args.header_list:
            if ':' in header:
                name, value = header.split(':', 1)
                custom_headers[name.strip()] = value.strip()
            else:
                print(f"Warning: Ignoring malformed header '{header}' (should be 'Name: Value')", file=sys.stderr)
        print(f"✓ Added {len(args.header_list)} custom headers from command line")
    
    # Create downloader
    downloader = ImageDownloader(
        output_dir=args.output_dir, 
        timeout=args.timeout,
        cookies=cookies,
        headers=custom_headers
    )
    
    # Prepare metadata
    metadata = {}
    if args.title:
        metadata["title"] = args.title
    if args.author:
        metadata["author"] = args.author
    if args.description:
        metadata["description"] = args.description
    if args.copyright:
        metadata["copyright"] = args.copyright
    
    # Download images
    success_count = 0
    for url in args.urls:
        try:
            # Generate filename based on strategy
            if args.filename:
                filename = args.filename
            else:
                filename = downloader.generate_filename(url, args.filename_strategy)
            
            # Add source URL to metadata if requested
            if args.source_url:
                metadata["source_url"] = url
            
            # Download
            image_path = downloader.download_image(url, filename)
            
            # Add metadata if provided
            if metadata:
                downloader.add_metadata(image_path, metadata)
            
            # Display info if requested
            if args.info:
                info = downloader.get_image_info(image_path)
                print(f"\nImage Information:")
                print(f"  Format: {info.get('format', 'Unknown')}")
                print(f"  Dimensions: {info.get('width', '?')}x{info.get('height', '?')}")
                print(f"  File Size: {info.get('file_size', 0):,} bytes")
                print()
            
            success_count += 1
            
        except Exception as e:
            print(f"✗ Failed to process {url}: {e}", file=sys.stderr)
    
    # Summary
    print(f"\n{'='*60}")
    print(f"Downloaded {success_count}/{len(args.urls)} images successfully")
    print(f"Output directory: {downloader.output_dir.absolute()}")
    print(f"{'='*60}")
    
    sys.exit(0 if success_count == len(args.urls) else 1)


if __name__ == "__main__":
    main()
