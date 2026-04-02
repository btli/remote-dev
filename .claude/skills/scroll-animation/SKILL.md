---
name: scroll-animation
description: Build premium scroll-driven frame animations (Apple-style) by orchestrating AI image generation, AI video generation, frame extraction, and canvas-based scroll playback. Use this skill whenever a user wants scroll-triggered animations, frame-by-frame scroll effects, video-to-scroll conversion, parallax product reveals, cinematic scroll sections, exploded view scroll animations, or any "scroll to play" interaction. Also triggers on mentions of "scroll animation", "frame animation", "scroll-driven video", "Apple-style scroll", "flipbook animation", "keyframe scroll", "product reveal animation", or requests to turn a video into a scroll-controlled sequence.
---

# Scroll-Driven Frame Animation

Build premium scroll-controlled animations that play like a cinematic flipbook as the user scrolls. This technique replaces heavy embedded videos with preloaded image frames mapped to scroll position — the result is buttery smooth, performant, and works on all devices.

The technique: generate two keyframe images (start + end state), create a transition video between them, extract ~120-180 frames, and build a canvas-based scroll animation.

## When to Use This vs. Embedded Video

| Approach | Use When | Performance |
|----------|----------|-------------|
| **Scroll-driven frames** (this skill) | User controls playback via scroll. Cinematic reveals, transformations, product showcases. | ~6-12MB total (WEBP frames), instant playback |
| **Embedded video** | Ambient background, autoplay loops, content the user watches passively | ~15-50MB video file, buffering delays |
| **GSAP video scrubbing** | You already have the video and want quick implementation | Requires video decode, mobile performance issues |

Scroll-driven frames win when you need precise scroll-to-frame mapping with no buffering.

## The Pipeline

```
┌─────────────┐    ┌─────────────┐    ┌──────────────┐    ┌────────────────┐
│ 1. Keyframes │───▶│ 2. Video    │───▶│ 3. Extract   │───▶│ 4. Scroll Code │
│ (Nano Banana)│    │ (Veo 3.1)   │    │ (FFmpeg)     │    │ (Canvas + JS)  │
└─────────────┘    └─────────────┘    └──────────────┘    └────────────────┘
```

### Phase 1: Generate Keyframe Images

Use the **nano-banana** skill to create start and end frames. Two critical rules:

1. **Background color must match your website section background.** If your site section is `#FDFBF7`, the image background must be `#FDFBF7`. Mismatches break the illusion.
2. **Use Pro model** (`--model pro`) for final keyframes. Flash is fine for exploration.

```bash
# Start frame — the "before" state
python scripts/generate_image.py \
  "A beautiful craftsman home exterior in San Marino, warm afternoon light,
   lush green landscaping, welcoming front porch with the door slightly ajar.
   Background: warm cream sky (#FDFBF7). Real estate photography style,
   shot with Phase One IQ4, 35mm wide angle, f/8, golden hour lighting." \
  -o public/frames/start.png --model pro --aspect-ratio 16:9 --size 2K

# End frame — the "after" state (use start as reference for consistency)
python scripts/generate_image.py \
  "Interior of the same craftsman home, standing in a stunning open-concept
   living room with hardwood floors, natural light streaming through large
   windows, modern kitchen visible in the background. Same warm cream tones.
   Real estate photography, 24mm wide angle, f/5.6, natural interior light." \
  -o public/frames/end.png --model pro --aspect-ratio 16:9 --size 2K \
  --reference public/frames/start.png
```

**Subject ideas by domain:**

| Domain | Start Frame | End Frame | Transition |
|--------|-------------|-----------|------------|
| Real estate | Home exterior | Interior reveal | Walk through front door |
| Product | Assembled product | Exploded engineering view | Components separate |
| SaaS | Empty dashboard | Populated with data | Features appear |
| Architecture | Blueprint/wireframe | Photorealistic building | Vision to reality |
| Food/Restaurant | Raw ingredients | Plated dish | Cooking transformation |
| Automotive | Exterior beauty shot | Cutaway engine view | X-ray reveal |

### Phase 2: Generate Transition Video

Use the **veo-video** skill with frame interpolation (start + end frames):

```bash
python scripts/generate_video.py \
  "Smooth cinematic walk through the front door of a craftsman home.
   Camera moves forward steadily through the doorway, transitioning
   from the exterior porch to the interior living room. Natural light
   shifts from outdoor to indoor. Continuous single take, no cuts.
   Real estate walkthrough style, steady dolly forward." \
  -o public/frames/walkthrough.mp4 \
  --image public/frames/start.png \
  --last-frame public/frames/end.png \
  --duration 8 --resolution 1080p --aspect-ratio 16:9
```

**Tips for clean transitions:**
- Keep the prompt simple. Complex camera movements produce jerky results.
- "Smooth", "steady", "continuous" are your friends.
- Avoid "spinning", "twisting", or rapid direction changes.
- Match the prompt to the visual — if the images show a door, say "walk through the door."

### Phase 3: Extract Frames

Extract frames and convert to WEBP for best size/quality ratio:

```bash
python scripts/extract_frames.py public/frames/walkthrough.mp4 \
  --output-dir public/frames/walkthrough/ \
  --format webp \
  --quality 80 \
  --max-frames 150 \
  --dedupe
```

**Or with raw FFmpeg:**

```bash
mkdir -p public/frames/walkthrough
ffmpeg -i public/frames/walkthrough.mp4 \
  -vf "fps=18,scale=1920:-1" \
  -c:v libwebp -quality 80 \
  public/frames/walkthrough/frame-%04d.webp
```

**Frame count guidelines:**
- 120-150 frames: sweet spot for 8s video. Smooth scroll, reasonable file size.
- 180+ frames: silky smooth but heavier (~12MB+ total).
- 90 or fewer: noticeable frame skipping on slow scroll.

**Expected sizes:**
- WEBP at quality 80: ~40-80KB per frame
- 150 frames = ~6-12MB total
- Compare: a single 1080p video = 15-50MB

### Phase 4: Scroll-Driven Canvas Animation

The core component. Uses a canvas element pinned to the viewport, drawing the appropriate frame based on scroll position.

```tsx
"use client";

import { useEffect, useRef, useCallback } from "react";

interface ScrollFrameAnimationProps {
  /** Path to frame directory (e.g., "/frames/walkthrough") */
  frameDir: string;
  /** Total number of frames */
  frameCount: number;
  /** Frame filename pattern. Use {index} for the 0-padded frame number */
  pattern?: string;
  /** Height multiplier — controls how much scroll distance maps to the full animation.
   *  3 = animation plays over 3x viewport height of scrolling. */
  scrollMultiplier?: number;
  /** Additional CSS classes for the outer container */
  className?: string;
  /** Background color to fill canvas before drawing (should match page bg) */
  bgColor?: string;
}

export function ScrollFrameAnimation({
  frameDir,
  frameCount,
  pattern = "frame-{index}.webp",
  scrollMultiplier = 4,
  className = "",
  bgColor,
}: ScrollFrameAnimationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imagesRef = useRef<HTMLImageElement[]>([]);
  const rafRef = useRef<number>(0);
  const currentFrameRef = useRef<number>(-1);

  // Build frame path from index
  const framePath = useCallback(
    (index: number) => {
      const padded = String(index + 1).padStart(4, "0");
      return `${frameDir}/${pattern.replace("{index}", padded)}`;
    },
    [frameDir, pattern]
  );

  // Preload frames
  useEffect(() => {
    const imgs: HTMLImageElement[] = [];
    for (let i = 0; i < frameCount; i++) {
      const img = new Image();
      img.src = framePath(i);
      imgs.push(img);
    }
    imagesRef.current = imgs;
  }, [frameCount, framePath]);

  // Draw frame on canvas
  const drawFrame = useCallback(
    (index: number) => {
      if (index === currentFrameRef.current) return;
      const canvas = canvasRef.current;
      const img = imagesRef.current[index];
      if (!canvas || !img?.complete || !img.naturalWidth) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Match canvas to image dimensions (once)
      if (canvas.width !== img.naturalWidth) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
      }

      if (bgColor) {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.drawImage(img, 0, 0);
      currentFrameRef.current = index;
    },
    [bgColor]
  );

  // Scroll handler with rAF
  useEffect(() => {
    function onScroll() {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const scrollableHeight = container.offsetHeight - window.innerHeight;
        const progress = Math.max(0, Math.min(1, -rect.top / scrollableHeight));
        const frameIndex = Math.min(
          Math.floor(progress * imagesRef.current.length),
          imagesRef.current.length - 1
        );
        drawFrame(frameIndex);
      });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll(); // Draw initial frame
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(rafRef.current);
    };
  }, [drawFrame]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ height: `${scrollMultiplier * 100}vh` }}
    >
      <div className="sticky top-0 flex h-[100dvh] items-center justify-center overflow-hidden">
        <canvas
          ref={canvasRef}
          className="h-full w-full object-contain"
        />
      </div>
    </div>
  );
}
```

**Usage:**
```tsx
<ScrollFrameAnimation
  frameDir="/frames/walkthrough"
  frameCount={150}
  scrollMultiplier={4}
  bgColor="#FDFBF7"
/>
```

## Text Overlays

Layer text that fades in/out at specific scroll progress points using Framer Motion:

```tsx
import { motion, useScroll, useTransform } from "framer-motion";

function ScrollOverlays({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }) {
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });

  // Fade in at 10-20%, hold until 35%, fade out at 35-45%
  const opacity1 = useTransform(scrollYProgress, [0.1, 0.2, 0.35, 0.45], [0, 1, 1, 0]);
  // Second overlay: 50-60% in, hold, 75-85% out
  const opacity2 = useTransform(scrollYProgress, [0.5, 0.6, 0.75, 0.85], [0, 1, 1, 0]);

  return (
    <div className="pointer-events-none fixed inset-0 z-10">
      <motion.div style={{ opacity: opacity1 }} className="absolute bottom-16 left-8 max-w-md">
        <h2 className="text-4xl font-medium tracking-tighter">Your headline</h2>
        <p className="mt-2 text-lg text-muted-foreground">Supporting text</p>
      </motion.div>
      <motion.div style={{ opacity: opacity2 }} className="absolute bottom-16 left-8 max-w-md">
        <h2 className="text-4xl font-medium tracking-tighter">Second headline</h2>
      </motion.div>
    </div>
  );
}
```

## Performance Checklist

Before shipping, verify:

- [ ] Frame format is WEBP (not JPEG or PNG)
- [ ] Frame count is 120-180 (not 300+ from raw 24fps extraction)
- [ ] `--dedupe` flag used to remove near-identical frames
- [ ] Canvas uses `requestAnimationFrame` (not raw scroll listener)
- [ ] `{ passive: true }` on scroll event listener
- [ ] Frames preload before user reaches the section (use `loading="eager"` or JS preload)
- [ ] Background color matches between frames and website section
- [ ] Tested on mobile (may need reduced frame count or lower resolution)
- [ ] Total frame payload is under 15MB

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Animation feels jerky | Too few frames or no rAF | Extract more frames; ensure `requestAnimationFrame` wraps draw |
| White flash between frames | Frames not preloaded | Preload all frames before section becomes visible |
| Background mismatch | Image bg doesn't match CSS bg | Regenerate images with exact hex color; set `bgColor` prop |
| Mobile stuttering | Too many/large frames | Reduce to 90-120 frames, use lower resolution, add `will-change: transform` |
| Animation too fast/slow | Wrong scroll multiplier | Increase `scrollMultiplier` for slower playback (more scroll distance) |
| Frames load in wrong order | Filename padding mismatch | Ensure `frame-0001.webp` format matches the `pattern` prop |
