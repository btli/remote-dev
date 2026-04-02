#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gemini Image Generator Script

Generate high-quality images using Google's Gemini image generation API.
Default model: gemini-3-pro-image-preview (Nano Banana Pro)

Usage:
    python generate_image.py "Your detailed prompt" --output image.png
    python generate_image.py "prompt" --aspect-ratio 16:9 --resolution 2K --output banner.png
    python generate_image.py --batch prompts.txt --output-dir ./generated/
"""

import argparse
import base64
import io
import json
import os
import sys
import traceback
from datetime import datetime
from pathlib import Path
from typing import Optional

# Ensure UTF-8 output encoding
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

try:
    from google import genai
    from google.genai import types
except ImportError:
    print("Error: google-genai package not installed.")
    print("Install with: pip install google-genai")
    sys.exit(1)


# Default configuration
DEFAULT_MODEL = "gemini-3-pro-image-preview"
VALID_ASPECT_RATIOS = ["1:1", "2:3", "3:2", "4:3", "3:4", "16:9", "9:16", "21:9"]
VALID_RESOLUTIONS = ["1K", "2K", "4K"]


def load_env_file(env_path: Optional[Path] = None) -> dict:
    """Load environment variables from .env file."""
    env_vars = {}

    # Search paths for .env file
    search_paths = []
    if env_path:
        search_paths.append(env_path)
    search_paths.extend([
        Path.cwd() / ".env",
        Path.cwd().parent / ".env",
        Path.home() / ".env",
    ])

    for path in search_paths:
        if path.exists():
            with open(path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        key, value = line.split("=", 1)
                        # Remove quotes if present
                        value = value.strip().strip('"').strip("'")
                        env_vars[key.strip()] = value
            break

    return env_vars


def get_api_key() -> str:
    """Get Gemini API key from environment or .env file."""
    # First check environment variable
    api_key = os.environ.get("GEMINI_API_KEY")

    if not api_key:
        # Try loading from .env file
        env_vars = load_env_file()
        api_key = env_vars.get("GEMINI_API_KEY")

    if not api_key:
        print("Error: GEMINI_API_KEY not found.")
        print("Please set it in your environment or .env file.")
        sys.exit(1)

    return api_key


def load_image_as_base64(image_path: Path) -> tuple[str, str]:
    """Load an image file and return base64 data and mime type."""
    suffix = image_path.suffix.lower()
    mime_types = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
    }

    mime_type = mime_types.get(suffix, "image/png")

    with open(image_path, "rb") as f:
        data = base64.b64encode(f.read()).decode("utf-8")

    return data, mime_type


def generate_image(
    prompt: str,
    output_path: Path,
    model: str = DEFAULT_MODEL,
    aspect_ratio: str = "1:1",
    resolution: str = "1K",
    reference_images: Optional[list[Path]] = None,
    verbose: bool = False,
) -> bool:
    """
    Generate an image using the Gemini API.

    Args:
        prompt: The text prompt describing the image to generate
        output_path: Path where the generated image will be saved
        model: Model to use (default: gemini-3-pro-image-preview)
        aspect_ratio: Aspect ratio (1:1, 16:9, 9:16, etc.)
        resolution: Image resolution (1K, 2K, 4K)
        reference_images: Optional list of reference image paths
        verbose: Print detailed information

    Returns:
        True if successful, False otherwise
    """
    api_key = get_api_key()

    # Initialize client
    client = genai.Client(api_key=api_key)

    # Build content parts
    contents = []

    # Add reference images if provided
    if reference_images:
        for img_path in reference_images:
            if not img_path.exists():
                print(f"Warning: Reference image not found: {img_path}")
                continue

            data, mime_type = load_image_as_base64(img_path)
            contents.append(
                types.Part.from_bytes(
                    data=base64.b64decode(data),
                    mime_type=mime_type,
                )
            )
            if verbose:
                print(f"Added reference image: {img_path}")

    # Add the text prompt
    contents.append(prompt)

    # Configure generation
    config = types.GenerateContentConfig(
        response_modalities=["TEXT", "IMAGE"],
        image_config=types.ImageConfig(
            aspect_ratio=aspect_ratio,
            image_size=resolution,
        ),
    )

    if verbose:
        print(f"Model: {model}")
        print(f"Aspect Ratio: {aspect_ratio}")
        print(f"Resolution: {resolution}")
        print(f"Prompt: {prompt[:100]}..." if len(prompt) > 100 else f"Prompt: {prompt}")
        print("Generating image...")

    try:
        response = client.models.generate_content(
            model=model,
            contents=contents,
            config=config,
        )

        # Process response
        image_saved = False
        text_response = []

        for part in response.candidates[0].content.parts:
            if hasattr(part, "text") and part.text:
                text_response.append(part.text)
            elif hasattr(part, "inline_data") and part.inline_data:
                # Save the image
                image_data = part.inline_data.data
                output_path.parent.mkdir(parents=True, exist_ok=True)

                with open(output_path, "wb") as f:
                    f.write(image_data)

                image_saved = True
                print(f"Image saved to: {output_path}")

        # Print any text response from the model
        if text_response and verbose:
            print("\nModel commentary:")
            for text in text_response:
                print(f"  {text}")

        if not image_saved:
            print("Warning: No image was generated in the response.")
            return False

        # Log the generation for reproducibility
        log_generation(prompt, output_path, model, aspect_ratio, resolution)

        return True

    except Exception as e:
        # Print full traceback for debugging
        print("\n=== Full Traceback ===")
        traceback.print_exc()
        print("=== End Traceback ===\n")

        try:
            error_msg = str(e).encode('utf-8', errors='replace').decode('utf-8')
        except Exception:
            error_msg = repr(e)

        if "SAFETY" in error_msg.upper():
            print("Error: Content was blocked by safety filters.")
            print("Please revise your prompt to avoid prohibited content.")
        elif "RATE" in error_msg.upper() or "QUOTA" in error_msg.upper():
            print("Error: Rate limit or quota exceeded.")
            print("Please wait before trying again.")
        else:
            print(f"Error generating image: {error_msg}")
        return False


def log_generation(
    prompt: str,
    output_path: Path,
    model: str,
    aspect_ratio: str,
    resolution: str,
) -> None:
    """Log generation details for reproducibility."""
    log_path = output_path.with_suffix(".json")

    log_data = {
        "timestamp": datetime.now().isoformat(),
        "prompt": prompt,
        "model": model,
        "aspect_ratio": aspect_ratio,
        "resolution": resolution,
        "output_file": str(output_path),
    }

    with open(log_path, "w", encoding="utf-8") as f:
        json.dump(log_data, f, indent=2, ensure_ascii=False)


def batch_generate(
    prompts_file: Path,
    output_dir: Path,
    model: str = DEFAULT_MODEL,
    aspect_ratio: str = "1:1",
    resolution: str = "1K",
    verbose: bool = False,
) -> tuple[int, int]:
    """
    Generate multiple images from a file of prompts.

    Args:
        prompts_file: Path to file containing one prompt per line
        output_dir: Directory to save generated images
        model: Model to use
        aspect_ratio: Aspect ratio for all images
        resolution: Resolution for all images
        verbose: Print detailed information

    Returns:
        Tuple of (successful count, failed count)
    """
    if not prompts_file.exists():
        print(f"Error: Prompts file not found: {prompts_file}")
        return 0, 0

    output_dir.mkdir(parents=True, exist_ok=True)

    with open(prompts_file, encoding="utf-8") as f:
        prompts = [line.strip() for line in f if line.strip() and not line.startswith("#")]

    print(f"Found {len(prompts)} prompts to process.")

    success_count = 0
    fail_count = 0

    for i, prompt in enumerate(prompts, 1):
        output_path = output_dir / f"image_{i:03d}.png"
        print(f"\n[{i}/{len(prompts)}] Generating...")

        if generate_image(
            prompt=prompt,
            output_path=output_path,
            model=model,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            verbose=verbose,
        ):
            success_count += 1
        else:
            fail_count += 1

    print(f"\nBatch complete: {success_count} successful, {fail_count} failed")
    return success_count, fail_count


def main():
    parser = argparse.ArgumentParser(
        description="Generate images using Google's Gemini API",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s "A serene mountain landscape at dawn" --output mountain.png
  %(prog)s "Product photo of a watch" --aspect-ratio 1:1 --resolution 2K -o watch.png
  %(prog)s --batch prompts.txt --output-dir ./generated/
  %(prog)s "A cat in space" --reference-image style.jpg --output styled_cat.png
        """,
    )

    # Main arguments
    parser.add_argument(
        "prompt",
        nargs="?",
        help="The text prompt describing the image to generate",
    )

    parser.add_argument(
        "-o", "--output",
        type=Path,
        default=Path("generated_image.png"),
        help="Output file path (default: generated_image.png)",
    )

    # Batch mode
    parser.add_argument(
        "--batch",
        type=Path,
        metavar="FILE",
        help="Path to file containing prompts (one per line)",
    )

    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("./generated"),
        help="Output directory for batch mode (default: ./generated)",
    )

    # Generation options
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"Model to use (default: {DEFAULT_MODEL})",
    )

    parser.add_argument(
        "--aspect-ratio",
        default="1:1",
        choices=VALID_ASPECT_RATIOS,
        help="Aspect ratio (default: 1:1)",
    )

    parser.add_argument(
        "--resolution",
        default="1K",
        choices=VALID_RESOLUTIONS,
        help="Image resolution (default: 1K)",
    )

    parser.add_argument(
        "--reference-image",
        type=Path,
        action="append",
        dest="reference_images",
        help="Reference image for style/consistency (can be used multiple times)",
    )

    # Other options
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Print detailed information",
    )

    parser.add_argument(
        "--env",
        type=Path,
        help="Path to .env file",
    )

    args = parser.parse_args()

    # Load .env if specified
    if args.env:
        env_vars = load_env_file(args.env)
        for key, value in env_vars.items():
            os.environ.setdefault(key, value)

    # Batch mode
    if args.batch:
        batch_generate(
            prompts_file=args.batch,
            output_dir=args.output_dir,
            model=args.model,
            aspect_ratio=args.aspect_ratio,
            resolution=args.resolution,
            verbose=args.verbose,
        )
        return

    # Single image mode
    if not args.prompt:
        parser.error("A prompt is required (or use --batch for batch mode)")

    generate_image(
        prompt=args.prompt,
        output_path=args.output,
        model=args.model,
        aspect_ratio=args.aspect_ratio,
        resolution=args.resolution,
        reference_images=args.reference_images,
        verbose=args.verbose,
    )


if __name__ == "__main__":
    main()
