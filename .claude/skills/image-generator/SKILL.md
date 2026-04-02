---
name: image-generator
description: Generate high-quality images using Google's Gemini image generation models (Nano Banana Pro). This skill should be used when users request AI-generated images, text-to-image generation, image creation from descriptions, or product mockups. Supports multiple aspect ratios, resolutions up to 4K, and advanced features like reference images and text rendering. Uses gemini-3-pro-image-preview model by default.
---

# Image Generator (Nano Banana Pro)

Generate images using `gemini-3-pro-image-preview`. **This is expensive—craft thorough prompts to avoid regeneration.**

## Prerequisites

- `GEMINI_API_KEY` in project `.env`
- Python 3.9+ with `google-genai`

## Quick Reference

```bash
# Basic
python scripts/generate_image.py "detailed prompt" -o output.png

# With options
python scripts/generate_image.py "prompt" --aspect-ratio 16:9 --resolution 2K -o image.png

# Reference images (up to 14)
python scripts/generate_image.py "prompt" --reference-image ref.jpg -o styled.png

# Batch mode
python scripts/generate_image.py --batch prompts.txt --output-dir ./generated/
```

**Aspect Ratios:** `1:1` `16:9` `9:16` `4:3` `3:2` `21:9`
**Resolutions:** `1K` (fast/cheap) | `2K` (balanced) | `4K` (slow/expensive)

## Prompt Construction (Critical)

### Golden Rules

1. **Edit over re-roll**: Request modifications conversationally ("change lighting to sunset, make text neon blue") rather than regenerating
2. **Natural language**: Write complete sentences as if briefing a creative director—never keyword-stack
3. **Specificity wins**: Not "a woman" but "sophisticated elderly woman in vintage Chanel-style suit"
4. **Contextual framing**: State intended use ("for a Brazilian high-end gourmet cookbook") to infer style

### 6-Factor Prompt Framework

| Factor | Description | Example |
|--------|-------------|---------|
| Subject | Who/what appears | "bartender with silver beard" |
| Composition | Camera angle/framing | "low angle, close-up, wide shot" |
| Action | What's happening | "pouring craft cocktail" |
| Setting | Scene context | "speakeasy bar, dim amber lighting" |
| Style | Visual aesthetic | "cinematic film scene, shallow DOF" |
| Technical | Camera/lighting specs | "f/1.8, long shadows, warm tones" |

### Prompt Expansion Example

**User says:** "A cat"

**Expand to:**
```
A fluffy orange tabby cat with bright green eyes, sitting elegantly on a vintage
velvet armchair. Soft natural window light from the left creates gentle shadows.
Shot with 50mm lens at f/2.8, shallow depth of field, professional pet photography.
```

### Text in Images

Quote text explicitly with typography details:
```
Vintage travel poster with text "PARIS" in bold Art Deco typography at top,
"The City of Light" in elegant script below. Eiffel Tower silhouette against
sunset gradient (oranges, purples). Display font, metallic gold effect.
```

### Character Consistency

For multi-image series with same character:
- Use identity-locking: "Keep facial features exactly identical to Image 1"
- Label reference images by role: "Image 1: character face, Image 2: style reference"
- Specify what changes (pose, expression) while maintaining identity

## Advanced Capabilities

| Capability | How to Use |
|------------|------------|
| Reference images | Up to 14 (6 high-fidelity). Label roles explicitly |
| Google Search grounding | Real-time data visualization, current events |
| Semantic editing | "Remove background", "Apply vintage filter"—no masking needed |
| 2D→3D translation | Convert floor plans to interior renders, sketches to photos |
| Sequential narratives | "9-part story" with consistent characters across frames |

## Error Quick Reference

| Error | Fix |
|-------|-----|
| `GEMINI_API_KEY not found` | Add to `.env` in project root |
| Safety filter | Revise prompt content |
| Rate limit | Wait and retry |
| Invalid aspect ratio | Use: 1:1, 2:3, 3:2, 4:3, 16:9, 9:16, 21:9 |

## Resources

- `scripts/generate_image.py` — CLI tool with full options
- `references/prompt_engineering.md` — Domain-specific templates (photo, illustration, product, UI)
- `references/api_reference.md` — API parameters and code examples
