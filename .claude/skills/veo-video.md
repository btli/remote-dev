---
name: veo-video
description: Generate videos using Google Veo 3.1 (veo-3.0-generate-preview). Use this skill whenever the user needs AI-generated videos, animated assets, scroll animations, product videos, exploded view animations, transition effects, or any motion content. Also use for video prompts, aspect ratios, frame extraction for scroll-driven animations, or converting static images to video. Triggers on mentions of "generate video", "veo", "animate", "video generation", "exploded view", "scroll animation", "motion asset", "product video", or any request for AI-generated video/motion content.
---

# Veo Video — Gemini Video Generation

Generate videos using Google's Veo 3.1 model with native audio.

| Model | ID | Duration | Resolution | Audio |
|---|---|---|---|---|
| **Veo 3.1** | `veo-3.1-generate-preview` | 4-8s (extendable to 148s) | 720p, 1080p, 4K | Native |

## Quick Start

```bash
# Basic text-to-video
python scripts/generate_video.py "a resume document exploding apart in slow motion" -o explode.mp4

# With options
python scripts/generate_video.py "prompt" -o output.mp4 --aspect-ratio 16:9 --duration 8 --resolution 1080p

# Image-to-video (animate a still image)
python scripts/generate_video.py "slowly rotate this object" -o animated.mp4 --image static.png

# Frame interpolation (A to B transition)
python scripts/generate_video.py "smooth morph transition" -o morph.mp4 --image start.png --last-frame end.png

# Extend a video
python scripts/generate_video.py "continue the camera movement" -o extended.mp4 --extend previous.mp4

# Extract frames for scroll animation
python scripts/extract_frames.py explode.mp4 --output-dir frames/ --format jpg --quality 85
```

## Prerequisites

- `GEMINI_API_KEY` in `.env.local`
- Python 3.9+ with `google-genai` (`pip install google-genai`)
- `ffmpeg` for frame extraction (optional, for scroll animations)

## Capabilities

### Text-to-Video
Describe a scene and Veo generates a 4-8 second video with native audio.

### Image-to-Video
Provide a static image + prompt to animate it. The image becomes the first frame.

### Frame Interpolation (Veo 3.1 only)
Provide a start frame and end frame — Veo generates the transition video between them.

### Video Extension (Veo 3.1 only)
Extend a previously generated Veo video by up to 7 seconds per extension, up to 20 times (max 148 seconds total).

### Reference Images (Veo 3.1 only)
Up to 3 reference images for style/object consistency across the video.

## Configuration

| Parameter | Options | Default | Notes |
|---|---|---|---|
| `aspect_ratio` | `16:9`, `9:16` | `16:9` | Landscape or portrait only |
| `duration_seconds` | `4`, `6`, `8` | `8` | 8s required for 1080p/4K |
| `resolution` | `720p`, `1080p`, `4k` | `720p` | 1080p/4K requires 8s duration |
| `person_generation` | `allow_all`, `allow_adult` | `allow_all` | Restrictions vary by mode |
| `number_of_videos` | 1+ | `1` | Generate multiple variants |
| `seed` | integer | random | For reproducibility |

**Important constraints:**
- 1080p and 4K require `duration_seconds: 8`
- Video extensions are limited to 720p
- Reference images require `duration_seconds: 8`
- Generation takes 11 seconds to 6 minutes depending on load

## Prompt Engineering

### The 7-Factor Video Prompt

| Factor | What to Include | Example |
|---|---|---|
| **Subject** | Object, person, scenery | "a white resume document" |
| **Action** | Movement, transformation | "exploding apart into floating sections" |
| **Camera** | Movement type | "slow dolly zoom out" |
| **Composition** | Shot framing | "wide shot, centered subject" |
| **Style** | Film aesthetic | "cinematic, tech product commercial" |
| **Ambiance** | Color/lighting | "cool blue tones, dramatic rim lighting" |
| **Audio** (optional) | Sound description | "soft whoosh sounds as pieces separate" |

### Audio Prompting (Veo 3.1 Native Audio)

Veo 3.1 generates synchronized audio natively. Include audio cues in your prompt:

**Dialogue** — use quotation marks:
```
A recruiter looks at a screen and says, "This is impressive. Tell me more about your leadership style."
```

**Sound effects** — describe explicitly:
```
A resume document shatters into glowing pieces with a soft crystalline breaking sound,
pieces floating apart with gentle whooshing, ambient electronic hum in the background.
```

**Ambient** — set the soundscape:
```
Quiet office ambiance, soft keyboard clicking, the gentle hum of a computer fan.
```

### Good vs Bad Video Prompts

**Bad:**
```
resume exploding, dark background, 3D
```

**Good:**
```
A pristine white resume document floating in deep charcoal space begins to
slowly deconstruct. Each section — header, experience, skills, education —
separates and floats outward in a controlled explosion. Thin glowing emerald
lines connect the pieces like a technical blueprint. The camera slowly dollies
backward as pieces spread. Cinematic tech commercial style, dramatic rim
lighting, slow motion. Soft crystalline separation sounds, ambient electronic
undertone.
```

### The 10-Factor Video Prompt (Google Official)

Structure your prompt with these components for best results:

| # | Factor | Description | Example |
|---|---|---|---|
| 1 | **Subject** | Who/what the action centers on | "a white resume document" |
| 2 | **Action** | Verbs describing movement | "exploding apart into floating sections" |
| 3 | **Scene/Context** | Where, when, atmosphere | "in deep charcoal void, studio lighting" |
| 4 | **Camera Angle** | Shot perspective | "eye-level, medium shot" |
| 5 | **Camera Movement** | Dynamic motion | "slow dolly zoom out" |
| 6 | **Lens/Optical** | Visual perception | "shallow depth of field, 85mm lens" |
| 7 | **Visual Style** | Lighting, mood, direction | "cinematic, product commercial, rim lighting" |
| 8 | **Temporal** | Time flow | "slow motion, 0.5x speed" |
| 9 | **Audio** | Sound effects, ambient, dialogue | "soft crystalline breaking sounds" |
| 10 | **Cinematic** | Editing techniques | "smooth continuous take" |

**Write it like a shot list in one sentence:**
`[Cinematography] + [Subject] + [Action] + [Context] + [Style and Audio]`

### Camera Movement Keywords

| Movement | Description |
|---|---|
| `static/fixed` | Camera remains completely still |
| `pan left/right` | Rotates horizontally from fixed position |
| `tilt up/down` | Rotates vertically from fixed position |
| `dolly in/out` | Physically moves closer/further from subject |
| `truck left/right` | Physically moves sideways |
| `pedestal up/down` | Moves vertically while maintaining level |
| `zoom in/out` | Lens changes focal length to magnify |
| `crane shot` | Mounted on crane, sweeping arcs |
| `aerial/drone` | High altitude, smooth flying movement |
| `tracking shot` | Follows a moving subject |
| `orbit/arc` | Circular path around subject |
| `handheld/shaky` | Less stable, conveys realism |
| `whip pan` | Extremely fast pan that blurs |
| `dolly zoom (vertigo)` | Dolly + opposing zoom = surreal |

### Camera Angles

| Angle | Effect |
|---|---|
| `eye-level` | Neutral, human perspective |
| `low-angle` | Below subject, conveys power |
| `high-angle` | Above subject, suggests vulnerability |
| `bird's-eye/top-down` | Direct overhead |
| `worm's-eye` | Extremely low, looking up |
| `dutch/canted` | Tilted horizon, unease |
| `POV` | Character's perspective |
| `over-the-shoulder` | Behind one person toward another |

### Lens & Optical Keywords

| Effect | Usage |
|---|---|
| `wide-angle` | Broader FOV, exaggerated perspective |
| `telephoto` | Narrows FOV, compresses depth |
| `shallow depth of field` | Blurred background, subject sharp |
| `deep depth of field` | Everything sharp |
| `lens flare` | Streaks when bright light hits lens |
| `rack focus` | Shift focus between depth planes |
| `fisheye` | Ultra-wide with barrel distortion |

### Lighting Keywords

- **Natural**: "soft morning sunlight", "moonlight", "overcast daylight", "golden hour"
- **Artificial**: "warm fireplace glow", "neon signs", "fluorescent"
- **Cinematic**: "Rembrandt lighting", "film noir", "high-key", "low-key", "rim lighting"
- **Effects**: "volumetric lighting", "backlighting", "side lighting", "silhouette"

### Style Keywords

- **Photorealistic/Cinematic** — default for product/marketing
- **Animation**: "anime", "Pixar", "claymation", "stop-motion", "cel-shaded"
- **Art**: "watercolor", "charcoal sketch", "blueprint", "technical drawing"
- **Specific looks**: "film noir", "sci-fi", "vintage 1920s sepia", "futuristic"

### Negative Prompts

Instead of "no walls, don't show X", describe what to EXCLUDE as nouns: "wall, frame, text"

## Nano Banana → Veo Keyframe Pipeline

The most powerful workflow: generate start and end frames with Nano Banana, then use Veo's frame interpolation to create the video between them. This gives you precise control over the transformation.

### Step 1: Generate Start Frame (Nano Banana)
```bash
python scripts/generate_image.py \
  "A pristine white resume document floating in charcoal space. Clean layout
   with visible sections for name, experience, skills. Product photography,
   studio lighting, centered composition. No text legible." \
  -o assets/resume-intact.png --model pro --aspect-ratio 16:9 --size 2K
```

### Step 2: Generate End Frame (Nano Banana)
```bash
python scripts/generate_image.py \
  "The same resume document fully exploded apart in charcoal space. Header,
   experience, skills, education sections floating as separate white cards
   connected by thin emerald glowing lines. Same lighting and style as
   before but pieces spread apart symmetrically." \
  -o assets/resume-exploded.png --model pro --aspect-ratio 16:9 --size 2K \
  --reference assets/resume-intact.png
```

### Step 3: Generate Transition Video (Veo Interpolation)
```bash
python scripts/generate_video.py \
  "Smooth, controlled explosion of a resume document. Pieces separate slowly
   and deliberately in zero gravity. Emerald connection lines appear between
   pieces. Camera static, only the document transforms. Product commercial
   lighting, slow motion." \
  -o assets/resume-explode.mp4 \
  --image assets/resume-intact.png \
  --last-frame assets/resume-exploded.png \
  --duration 8 --resolution 1080p
```

This gives you a perfectly controlled 8-second transformation that you can then extract frames from for scroll animations.

## Scroll Animation Workflow

This is the key workflow for creating scroll-driven animations on the landing page, inspired by the technique from the reference video.

### Step 1: Generate the Video

```bash
python scripts/generate_video.py \
  "A resume document floating in dark charcoal space slowly explodes apart.
   Each section separates and floats outward. The header card rises up,
   experience cards drift left, skills float right, education descends.
   Thin emerald glowing lines connect each piece. Camera static, subject
   transforms. White paper on #09090b background. Product commercial style,
   studio lighting." \
  -o resume_explode.mp4 \
  --duration 8 \
  --resolution 1080p \
  --aspect-ratio 16:9
```

### Step 2: Extract Frames as JPEGs

```bash
python scripts/extract_frames.py resume_explode.mp4 \
  --output-dir public/frames/resume-explode/ \
  --format jpg \
  --quality 85 \
  --max-frames 120
```

This produces ~120 JPEGs (8s at ~15fps after dedup) at ~50-100KB each.

### Step 3: Tie Frames to Scroll Position

In the Next.js component, preload frames and map scroll progress to frame index:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";

export function ScrollSequence({ frameDir, frameCount }: {
  frameDir: string;
  frameCount: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [images, setImages] = useState<HTMLImageElement[]>([]);

  // Preload all frames
  useEffect(() => {
    const loaded: HTMLImageElement[] = [];
    for (let i = 0; i < frameCount; i++) {
      const img = new Image();
      img.src = `${frameDir}/frame-${String(i).padStart(4, "0")}.jpg`;
      loaded.push(img);
    }
    setImages(loaded);
  }, [frameDir, frameCount]);

  // Map scroll to frame
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas || images.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function onScroll() {
      const rect = container!.getBoundingClientRect();
      const scrollHeight = container!.scrollHeight - window.innerHeight;
      const progress = Math.max(0, Math.min(1, -rect.top / scrollHeight));
      const frameIndex = Math.min(
        Math.floor(progress * images.length),
        images.length - 1
      );
      const img = images[frameIndex];
      if (img?.complete) {
        canvas!.width = img.naturalWidth;
        canvas!.height = img.naturalHeight;
        ctx!.drawImage(img, 0, 0);
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [images]);

  return (
    <div ref={containerRef} style={{ height: `${frameCount * 15}px` }}>
      <canvas
        ref={canvasRef}
        className="sticky top-0 h-screen w-full object-contain"
      />
    </div>
  );
}
```

### Step 4: Apply Masking Gradient

Add CSS gradient masks so the animation blends with the page background:

```css
.scroll-sequence-container canvas {
  mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    black 10%,
    black 90%,
    transparent 100%
  );
}
```

## AskCV-Specific Templates

### Resume Exploded View (Landing Page Hero)

```
A pristine white one-page resume document floating in deep charcoal space
(#09090b) begins a controlled explosion. The header section (name + title)
lifts upward, work experience cards drift to the left, skills badges float
to the right, education section descends. Each piece is a clean white card.
Thin glowing emerald (#10b981) connection lines form between pieces like a
technical diagram. Camera is static, only the document transforms. Product
commercial lighting, subtle rim light on each piece. No text visible on the
cards. Center of mass stays fixed. Slow motion, 8 seconds.
```

### Resume-to-Chat Transformation

```
A resume document in charcoal space morphs into a chat interface. The paper
folds and reshapes, sections becoming chat bubbles. The rigid document format
dissolves into a flowing conversation layout. A subtle emerald glow pulses
as the transformation completes. The final frame shows a modern chat window
with message bubbles. Smooth, liquid transition. Tech commercial aesthetic.
```

### Interview Session Visualization

```
A split-screen scene. Left: an AI interviewer represented by a subtle
emerald glowing orb. Right: text appearing as if being typed — a candidate's
answer. Below, four horizontal bars labeled S, T, A, R animate from left to
right, filling with emerald color to different lengths. A circular score
indicator in the center pulses to reveal "87". Clean dark UI aesthetic,
zinc-900 background, data visualization style.
```

### Globe Rotation (For International Appeal)

```
A 3D wireframe globe rotating slowly in place on a charcoal background.
The wireframe lines are thin and zinc-400 colored. Certain connection points
pulse with emerald light, representing global talent connections. The globe
rotates perfectly on its axis — center of mass does not move. Minimalist
tech aesthetic, clean lines, no labels. 8 seconds, seamless loop.
```

## API Details

### Python SDK Pattern

```python
import time
from google import genai
from google.genai import types

client = genai.Client(api_key="YOUR_KEY")

# Text-to-video
operation = client.models.generate_videos(
    model="veo-3.1-generate-preview",
    prompt="Your video description here",
    config=types.GenerateVideosConfig(
        aspect_ratio="16:9",
        resolution="1080p",
        duration_seconds="8",
    ),
)

# Poll for completion (11s to 6 min)
while not operation.done:
    time.sleep(10)
    operation = client.operations.get(operation)

# Save the video
video = operation.response.generated_videos[0]
client.files.download(file=video.video)
video.video.save("output.mp4")
```

### Image-to-Video Pattern

```python
from PIL import Image

first_frame = Image.open("start.png")

operation = client.models.generate_videos(
    model="veo-3.1-generate-preview",
    prompt="Animate this scene: the document slowly rotates",
    image=first_frame,
    config=types.GenerateVideosConfig(
        aspect_ratio="16:9",
        duration_seconds="8",
    ),
)
```

### Frame Interpolation Pattern

```python
start = Image.open("resume_intact.png")
end = Image.open("resume_exploded.png")

operation = client.models.generate_videos(
    model="veo-3.1-generate-preview",
    prompt="Smooth transition from intact to exploded state",
    image=start,
    config=types.GenerateVideosConfig(
        last_frame=end,
        duration_seconds="8",
    ),
)
```

### Video Extension Pattern

```python
# Extend a previously generated video
operation = client.models.generate_videos(
    model="veo-3.1-generate-preview",
    video=previous_video,  # Must be a Veo-generated Video object
    prompt="Continue the camera movement, pieces drift further apart",
    config=types.GenerateVideosConfig(
        resolution="720p",  # Extensions limited to 720p
    ),
)
```

### Key Notes
- Videos include SynthID watermark
- Generated videos stored on server for 2 days — download immediately
- 24fps, MP4 format
- Extensions add 7s per call, max 20 extensions (148s total)
- 1080p/4K require 8-second duration
- Native audio generated automatically (suppress with silent prompts if unwanted)

## CLI Scripts

### Video Generation (`scripts/generate_video.py`)

```
Usage: python scripts/generate_video.py [OPTIONS] PROMPT

Options:
  -o, --output PATH          Output file path (default: output.mp4)
  --aspect-ratio RATIO       16:9 or 9:16 (default: 16:9)
  --duration [4|6|8]         Duration in seconds (default: 8)
  --resolution [720p|1080p|4k]  Resolution (default: 720p)
  --image PATH               First frame image (image-to-video)
  --last-frame PATH          Last frame (interpolation, requires --image)
  --extend PATH              Extend a previous video
  --reference PATH           Reference image(s), up to 3
  --count N                  Number of variants to generate (default: 1)
  --seed N                   Random seed for reproducibility
  --poll-interval N          Seconds between status checks (default: 10)
```

### Frame Extraction (`scripts/extract_frames.py`)

```
Usage: python scripts/extract_frames.py VIDEO [OPTIONS]

Options:
  --output-dir DIR           Output directory (default: ./frames/)
  --format [jpg|png|webp]    Image format (default: jpg)
  --quality N                JPEG quality 1-100 (default: 85)
  --max-frames N             Maximum frames to extract (default: all)
  --fps N                    Extract at specific FPS (default: source fps)
  --dedupe                   Remove near-duplicate frames
  --resize WxH               Resize frames (e.g., 1920x1080)
```
