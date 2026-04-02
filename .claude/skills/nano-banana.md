---
name: nano-banana
description: Generate images using Google Gemini image models (Nano Banana 2 and Nano Banana Pro). Use this skill whenever the user needs AI-generated images, marketing assets, product mockups, UI screenshots, OG images, resume visuals, exploded view renders, or any visual content creation. Also use when discussing image generation prompts, aspect ratios, or comparing image model capabilities. Triggers on mentions of "generate image", "nano banana", "gemini image", "create visual", "marketing asset", "product shot", "render", or any request for AI-generated visual content.
---

# Nano Banana — Gemini Image Generation

Generate images using Google's Gemini image models. Two tiers available:

| Model | ID | Best For | Speed | Quality |
|---|---|---|---|---|
| **Nano Banana 2** | `gemini-3.1-flash-image-preview` | Fast iteration, high volume, exploration | Fast | Great |
| **Nano Banana Pro** | `gemini-3-pro-image-preview` | Final assets, text rendering, complex scenes | Slower | Best |

## Quick Start

```bash
# Generate with Nano Banana 2 (fast)
python scripts/generate_image.py "a modern resume floating in dark space" -o hero.png

# Generate with Pro (higher quality)
python scripts/generate_image.py "a modern resume floating in dark space" -o hero.png --model pro

# With options
python scripts/generate_image.py "prompt" -o output.png --aspect-ratio 16:9 --size 2K

# Edit an existing image
python scripts/generate_image.py "remove the background, make it transparent" -o edited.png --reference input.png

# Multi-image reference (character consistency)
python scripts/generate_image.py "same person in a different pose" -o pose2.png --reference face.png style.png
```

## Prerequisites

- `GEMINI_API_KEY` in `.env.local`
- Python 3.9+ with `google-genai` (`pip install google-genai`)

## Model Comparison

| Feature | Nano Banana 2 (Flash) | Nano Banana Pro |
|---|---|---|
| Model ID | `gemini-3.1-flash-image-preview` | `gemini-3-pro-image-preview` |
| Aspect Ratios | 1:1, 1:4, 1:8, 2:3, 3:2, 3:4, 4:1, 4:3, 4:5, 5:4, 8:1, 9:16, 16:9, 21:9 | 1:1, 2:3, 3:2, 3:4, 4:1, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9 |
| Resolutions | 512, 1K, 2K, 4K | 1K, 2K, 4K |
| Max Reference Images | 10 object + 4 character | 6 object + 5 character |
| Thinking | Configurable (High/minimal) | Always on |
| Text Rendering | Poor — generates garbage text | Best — use Pro for ANY legible text |
| Speed | ~5-15s | ~15-45s |
| Google Search | Yes — real-time grounding | Yes |
| Best For | Iteration, exploration, bulk | Final assets, precision, text |

**Strategy**: Use Nano Banana 2 for exploration (3-5 variations), then regenerate the winner with Pro at higher resolution.

**IMPORTANT**: Nano Banana 2 (Flash) generates garbage/illegible text. If your image needs ANY readable text, use `--model pro`. For images without text (product shots, backgrounds, abstract), Flash is fine and much faster.

## Prompt Engineering

### Google's Official Formula

Start simple, then build detail:

```
Create an image of [subject] [action] [scene]
```

Then expand with specifics: composition, style, image quality, aspect ratio. The more details you provide, the better Gemini follows your instructions. Let your creativity run wild — Gemini excels at surreal objects and unique scenes.

**If you don't like the result, just ask Gemini to change it.** With multi-turn editing, you can tell Gemini to change the background, replace an object, or add an element — all while preserving the details you love.

### The 6-Factor Framework

Write prompts as **complete sentences describing a scene**, not keyword lists. Think like a creative director briefing a photographer.

| Factor | What to Include | Example |
|---|---|---|
| **Subject** | Who/what appears | "a modern one-page resume document" |
| **Composition** | Camera angle, framing | "shot from above at 30 degrees, slightly tilted" |
| **Action** | What's happening | "floating and slowly rotating in space" |
| **Setting** | Scene context | "against a deep charcoal background (#09090b)" |
| **Style** | Visual aesthetic | "product photography, studio lighting, high-end tech" |
| **Technical** | Camera/lighting specs | "soft rim light, shallow depth of field, f/2.8" |

### Good vs Bad Prompts

**Bad** (keyword soup):
```
resume, dark background, professional, 3D, floating
```

**Good** (narrative):
```
A premium one-page resume document floating in a deep charcoal void. The paper
is crisp white with subtle text lines representing name, experience, and skills
sections. Soft studio lighting from the upper left creates a gentle shadow
beneath. The resume has a subtle reflection on an invisible surface below it.
Product photography style, 85mm lens, f/2.8, shallow depth of field. High-end
tech aesthetic similar to Apple product shots.
```

### Domain-Specific Tips

**Product/Tech Shots** (marketing assets):
- Reference specific lens/camera specs ("shot with Phase One IQ4, 80mm")
- Describe lighting setup ("three-point lighting, key from upper left")
- Specify material properties ("matte white paper, slight texture visible")
- Add environmental context ("floating above a reflective dark surface")

**UI Mockups** (app screenshots):
- Describe the screen content in detail
- Specify device ("on a MacBook Pro screen, angled at 30 degrees")
- Add ambient context ("in a modern workspace with soft natural light")

**Abstract/Conceptual** (exploded views, transformations):
- Be very specific about spatial relationships
- Describe the transformation state ("the resume is mid-explosion, pieces floating apart")
- Specify what connects the pieces ("thin glowing lines connect each section")

**Text in Images**:
- Use Nano Banana Pro for legible text
- Describe font style ("bold sans-serif", "elegant script") not font names
- Specify text placement and hierarchy

### Reference Image Strategies

**Character Consistency** (same person across images):
```bash
# First, generate a face reference
python scripts/generate_image.py "professional headshot..." -o face_ref.png

# Then use it for consistency
python scripts/generate_image.py "same person presenting at a conference" \
  -o scene2.png --reference face_ref.png
```

**Style Transfer** (apply one image's style to new content):
```bash
python scripts/generate_image.py "apply this style to a cityscape at night" \
  -o styled.png --reference style_source.png
```

**Object Inclusion** (place specific objects in scenes):
```bash
python scripts/generate_image.py "place this product on a marble table" \
  -o product_shot.png --reference product.png
```

## AskCV-Specific Templates

### Marketing Assets

**Hero Image — Resume in Space:**
```
A premium modern resume document floating in deep charcoal space (#09090b).
Clean white paper with minimalist typography suggesting name, title, and
experience sections. Soft emerald accent lighting on the edges. Studio
product photography, rim lighting, subtle reflection below. 16:9, ultra clean.
```

**Exploded Resume View:**
```
An exploded 3D view of a resume document. Sections (header, experience,
skills, education) are floating apart in space, separated by glowing emerald
connection lines. Deep charcoal background. Each section is a clean white
card with subtle text. The explosion is symmetrical and elegant, like a
technical blueprint. Product photography lighting, high-end tech aesthetic.
```

**AI Chat Interaction:**
```
A sleek chat interface floating in dark space. A chat bubble shows a
recruiter asking "Tell me about your leadership experience" and an AI
response with a detailed, compelling answer. The interface has a modern
glass-morphism design with subtle emerald accents. Zinc-900 background,
clean Geist-like sans-serif typography. UI screenshot style, crisp and sharp.
```

**STAR Coaching:**
```
A modern dashboard showing STAR analysis of an interview answer. Four
horizontal bars labeled S, T, A, R with scores (75, 82, 91, 68). An overall
score of 79 in a circular progress indicator. Below, strength badges in
emerald green and improvement suggestions in amber. Dark UI, zinc-900
background, clean data visualization style.
```

### OG Images

**Profile OG Card:**
```
A minimal, premium social card on deep charcoal background. Left side shows
a professional headshot placeholder (abstract geometric face). Right side
has the name "Sarah Chen" in large white sans-serif text, "Senior Software
Engineer" below in muted gray, and "Chat with my AI" with a small emerald
dot indicator. Aspect ratio 1.91:1 (1200x630px). Clean, sharp, no noise.
```

## API Details (for script development)

### Python SDK Pattern

```python
from google import genai
from google.genai import types

client = genai.Client(api_key="YOUR_KEY")

response = client.models.generate_content(
    model="gemini-3.1-flash-image-preview",  # or gemini-3-pro-image-preview
    contents="Your prompt here",
    config=types.GenerateContentConfig(
        response_modalities=["TEXT", "IMAGE"],
        image_config=types.ImageConfig(
            aspect_ratio="16:9",
            image_size="2K",
        ),
    ),
)

# Extract image
for part in response.candidates[0].content.parts:
    if part.inline_data:
        # Save raw bytes
        with open("output.png", "wb") as f:
            f.write(part.inline_data.data)
    elif part.text:
        print(part.text)
```

### Image Editing Pattern

```python
from PIL import Image

ref_image = Image.open("input.png")
response = client.models.generate_content(
    model="gemini-3.1-flash-image-preview",
    contents=["Edit instruction here", ref_image],
    config=types.GenerateContentConfig(
        response_modalities=["TEXT", "IMAGE"],
    ),
)
```

### Multi-Turn Editing

```python
chat = client.chats.create(
    model="gemini-3.1-flash-image-preview",
    config=types.GenerateContentConfig(
        response_modalities=["TEXT", "IMAGE"],
    ),
)

# Generate initial
response = chat.send_message("A modern resume on dark background")
# Refine
response = chat.send_message("Make the lighting warmer and add a subtle shadow")
```

### Key Notes
- All images include SynthID watermark
- Response modalities MUST include both TEXT and IMAGE
- Thinking is always active (billed regardless of `include_thoughts`)
- Google Search grounding available for real-world references
- Max 14 reference images total (object + character)

## CLI Script

The generation script is at `scripts/generate_image.py`. Run with `--help` for all options.

```
Usage: python scripts/generate_image.py [OPTIONS] PROMPT

Options:
  -o, --output PATH          Output file path (default: output.png)
  --model [flash|pro]        Model tier (default: flash)
  --aspect-ratio RATIO       Aspect ratio (default: 1:1)
  --size [512|1K|2K|4K]      Resolution (default: 1K)
  --reference PATH           Reference image(s), can specify multiple
  --search                   Enable Google Search grounding
  --thinking [high|minimal]  Thinking level (flash only)
  --batch FILE               Batch mode: read prompts from file
  --output-dir DIR           Output directory for batch mode
```
