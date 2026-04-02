# Gemini Image Generation API Reference

Comprehensive API documentation for Google's Gemini image generation models.

## Available Models

### gemini-3-pro-image-preview (Nano Banana Pro) - Default

The most advanced image generation model with professional-grade features.

**Capabilities:**
- Generates images in 1K, 2K, and 4K resolutions
- Supports up to 14 reference images (6 objects, 5 humans)
- Uses internal reasoning for complex prompts
- Excels at text rendering in images
- Integrates Google Search for real-time information grounding

**Best for:**
- High-quality professional output
- Complex compositions
- Text in images
- Style transfer with reference images
- Product mockups and marketing materials

### gemini-2.5-flash-image (Nano Banana)

Faster, more efficient model for simpler use cases.

**Capabilities:**
- Quick generation for standard resolutions
- Good for iterative exploration
- Lower cost per generation

**Best for:**
- Rapid prototyping
- Simple compositions
- High-volume generation
- Budget-conscious projects

## API Configuration

### Python SDK Setup

```python
from google import genai
from google.genai import types

# Initialize client
client = genai.Client(api_key="YOUR_API_KEY")
```

### Generation Configuration

```python
config = types.GenerateContentConfig(
    response_modalities=["TEXT", "IMAGE"],
    image_config=types.ImageConfig(
        aspect_ratio="16:9",  # Optional
        image_size="2K",      # Optional
    ),
)
```

### Supported Parameters

#### response_modalities
Type: `list[str]`
Required: Yes for image generation

Must include `"IMAGE"` to receive image output. Can also include `"TEXT"` for model commentary.

```python
response_modalities=["TEXT", "IMAGE"]  # Recommended
response_modalities=["IMAGE"]          # Image only
```

#### image_config.aspect_ratio
Type: `str`
Default: Model default (approximately 1:1)

Supported values:
- `"1:1"` - Square (1024x1024 at 1K)
- `"2:3"` - Portrait
- `"3:2"` - Landscape (traditional photo)
- `"4:3"` - Standard (classic)
- `"3:4"` - Portrait (classic)
- `"16:9"` - Widescreen
- `"9:16"` - Vertical/mobile
- `"21:9"` - Ultrawide/cinematic

#### image_config.image_size
Type: `str`
Default: `"1K"`

Supported values:
- `"1K"` - ~1024px on longest edge (fastest, cheapest)
- `"2K"` - ~2048px on longest edge
- `"4K"` - ~4096px on longest edge (slowest, most expensive)

**Important:** Resolution values must be uppercase.

## Request Formats

### Text-to-Image (Basic)

```python
response = client.models.generate_content(
    model="gemini-3-pro-image-preview",
    contents="A serene mountain landscape at dawn",
    config=types.GenerateContentConfig(
        response_modalities=["TEXT", "IMAGE"],
    ),
)
```

### Text-to-Image with Configuration

```python
response = client.models.generate_content(
    model="gemini-3-pro-image-preview",
    contents="A professional headshot of a business executive",
    config=types.GenerateContentConfig(
        response_modalities=["TEXT", "IMAGE"],
        image_config=types.ImageConfig(
            aspect_ratio="1:1",
            image_size="2K",
        ),
    ),
)
```

### Image + Text Input (Reference Images)

```python
import base64

# Load reference image
with open("reference.jpg", "rb") as f:
    image_data = f.read()

# Build content with reference image
contents = [
    types.Part.from_bytes(
        data=image_data,
        mime_type="image/jpeg",
    ),
    "Generate an image in the same style as this reference",
]

response = client.models.generate_content(
    model="gemini-3-pro-image-preview",
    contents=contents,
    config=types.GenerateContentConfig(
        response_modalities=["TEXT", "IMAGE"],
    ),
)
```

### Multiple Reference Images

```python
contents = []

# Add up to 14 reference images
for img_path in reference_images:
    with open(img_path, "rb") as f:
        contents.append(
            types.Part.from_bytes(
                data=f.read(),
                mime_type="image/jpeg",
            )
        )

# Add the prompt
contents.append("Combine elements from these references into a new composition")

response = client.models.generate_content(
    model="gemini-3-pro-image-preview",
    contents=contents,
    config=config,
)
```

## Response Handling

### Extracting Generated Images

```python
for part in response.candidates[0].content.parts:
    if hasattr(part, "text") and part.text:
        print(f"Model commentary: {part.text}")
    elif hasattr(part, "inline_data") and part.inline_data:
        # Save the image
        image_data = part.inline_data.data
        with open("output.png", "wb") as f:
            f.write(image_data)
```

### Response Structure

```python
response.candidates[0].content.parts = [
    Part(text="Here's your generated image..."),  # Optional text
    Part(inline_data=Blob(
        data=<bytes>,           # Raw image data
        mime_type="image/png",  # Always PNG
    )),
]
```

## Error Handling

### Common Errors

#### Safety Filter
```python
try:
    response = client.models.generate_content(...)
except Exception as e:
    if "SAFETY" in str(e).upper():
        print("Content blocked by safety filters")
        # Revise prompt to avoid prohibited content
```

#### Rate Limiting
```python
import time

try:
    response = client.models.generate_content(...)
except Exception as e:
    if "RATE" in str(e).upper() or "QUOTA" in str(e).upper():
        print("Rate limited, waiting...")
        time.sleep(60)  # Wait before retry
```

#### Invalid Parameters
```python
# These will cause errors:
image_size="4k"   # Wrong: lowercase
aspect_ratio="2x3"  # Wrong: use colon
```

### Retry Strategy

```python
import time
from typing import Optional

def generate_with_retry(
    client,
    model: str,
    contents,
    config,
    max_retries: int = 3,
) -> Optional[any]:
    for attempt in range(max_retries):
        try:
            return client.models.generate_content(
                model=model,
                contents=contents,
                config=config,
            )
        except Exception as e:
            error_msg = str(e).upper()
            if "RATE" in error_msg or "QUOTA" in error_msg:
                wait_time = 2 ** attempt * 30  # Exponential backoff
                print(f"Rate limited, waiting {wait_time}s...")
                time.sleep(wait_time)
            elif "SAFETY" in error_msg:
                raise  # Don't retry safety violations
            else:
                raise
    return None
```

## Multi-Turn Conversations

For iterative image refinement, the SDK handles thought signatures automatically:

```python
# Initial generation
response1 = client.models.generate_content(
    model="gemini-3-pro-image-preview",
    contents="A red sports car",
    config=config,
)

# Refinement using chat session
chat = client.chats.create(model="gemini-3-pro-image-preview")

response1 = chat.send_message(
    "Generate a red sports car",
    config=config,
)

# Follow-up refinement (context preserved)
response2 = chat.send_message(
    "Make it a convertible with the top down",
    config=config,
)
```

## Supported Image Input Formats

When providing reference images:

| Format | MIME Type | Notes |
|--------|-----------|-------|
| PNG | image/png | Best for graphics, transparency |
| JPEG | image/jpeg | Best for photos |
| GIF | image/gif | First frame only |
| WebP | image/webp | Good compression |

## Safety and Watermarking

- All generated images include invisible SynthID watermark
- Content must comply with Google's Prohibited Use Policy
- Avoid generating:
  - Content that infringes on rights
  - Deceptive or misleading content
  - Harmful or offensive material
  - Content depicting real individuals without consent

## Best Practices

### Cost Optimization

1. **Start with 1K resolution** for iterations, upgrade for final output
2. **Use gemini-2.5-flash-image** for rapid prototyping
3. **Craft thorough prompts** to avoid regeneration
4. **Cache and reuse** successful prompts

### Quality Optimization

1. **Use narrative prompts** instead of keyword lists
2. **Specify technical details** (camera, lighting, style)
3. **Include reference images** for consistency
4. **Iterate on prompts** rather than parameters

### Reliability

1. **Implement retry logic** for rate limits
2. **Log prompts with outputs** for reproducibility
3. **Validate inputs** before API calls
4. **Handle safety rejections** gracefully
