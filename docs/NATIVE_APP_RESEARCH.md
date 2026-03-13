# Native App Research: Terminal Rendering Options

## What is libghostty

libghostty is a GPU-accelerated terminal rendering library extracted from [Ghostty](https://ghostty.org/), a modern terminal emulator written in Zig. Key characteristics:

- **GPU-accelerated rendering** via Metal (macOS), Vulkan, or OpenGL backends
- **Written in Zig** with C ABI compatibility, callable from Swift/Objective-C/C++
- **Font rendering** with advanced shaping (HarfBuzz), ligature support, and subpixel antialiasing
- **Terminal emulation** built on a high-performance VT parser
- **Sub-millisecond frame times** even with large scrollback buffers
- **Library form factor** -- designed to be embedded in other applications, not just used as a standalone terminal

The library handles the full terminal stack: input processing, VT sequence parsing, grid state management, and GPU-based rendering of the terminal surface.

## How cmux Integrates libghostty

[cmux](https://github.com/anthropics/cmux) is a native macOS application that uses libghostty for its terminal rendering:

- **Swift/AppKit** native application with Ghostty included as a git submodule
- **XPC service architecture** -- the terminal rendering runs in a separate XPC process for isolation
- **Direct Metal rendering** -- terminal output goes straight to GPU without DOM/CSS overhead
- **Native macOS integration** -- proper keyboard handling, system font rendering, Retina display support
- **Split panes** rendered natively with zero-overhead compositing

The integration pattern: cmux builds libghostty from source (Zig build system), links it into an XPC service bundle, and communicates between the main AppKit process and the terminal renderer via XPC messages.

## Architecture Options for Remote Dev

### Option A: Full Native (Replace Electron)

Replace the Electron desktop app entirely with a native Swift/AppKit application using libghostty.

**Approach:**
- Build a native macOS app in Swift
- Embed libghostty for terminal rendering
- Communicate with the existing Next.js API server over HTTP/WebSocket
- Reimplement the UI (sidebar, session management, settings) in SwiftUI or AppKit

**Pros:**
- Best possible terminal rendering performance
- Native macOS look and feel
- Smallest memory footprint
- No web technology overhead for terminal rendering

**Cons:**
- macOS only (no Linux/Windows)
- Requires maintaining two complete UIs (web + native)
- 10-14 weeks estimated development time
- Zig build toolchain dependency
- Cannot reuse any existing React components

**Effort: 10-14 weeks**

### Option B: WebGL xterm.js Upgrade

Upgrade the existing xterm.js configuration to use the WebGL renderer addon, which provides GPU-accelerated rendering within the existing web stack.

**Approach:**
- Add `@xterm/addon-webgl` to the existing xterm.js setup
- Enable WebGL renderer with fallback to canvas
- Tune buffer sizes and rendering parameters
- Optionally add `@xterm/addon-unicode11` for better Unicode support

**Pros:**
- 1-2 weeks implementation time
- Works across all platforms (web, Electron, mobile)
- No new build toolchain or language
- Maintains single codebase
- 3-5x rendering speedup over canvas renderer
- Graceful fallback if WebGL unavailable

**Cons:**
- Still limited by browser/Electron rendering pipeline
- Cannot match native GPU rendering quality (no subpixel antialiasing in WebGL)
- Font rendering quality lower than native
- Higher baseline memory usage than native

**Effort: 1-2 weeks**

### Option C: Hybrid (Electron + libghostty via XPC)

Keep the Electron shell for UI but offload terminal rendering to a native libghostty process.

**Approach:**
- Build a lightweight native helper (Swift XPC service or Unix socket server)
- The helper uses libghostty for terminal rendering and exposes rendered frames
- Electron communicates with the helper via XPC (macOS) or Unix socket
- Terminal surfaces are composited into the Electron window using native overlays or shared GPU textures
- All non-terminal UI (sidebar, settings, modals) remains in React

**Pros:**
- Native-quality terminal rendering
- Reuses existing React UI for everything except terminal
- Can be rolled out incrementally (one terminal at a time)
- Maintains cross-platform web UI as fallback

**Cons:**
- Complex IPC architecture between Electron and native process
- macOS-only for the native rendering path (other platforms fall back to WebGL xterm.js)
- 4-6 weeks development time
- Debugging across process boundaries is harder
- Window management complexity (native surface inside Electron window)

**Effort: 4-6 weeks**

## Recommendation

**Start with Option B (WebGL upgrade) immediately.** This is low-risk, high-reward, and ships in 1-2 weeks. The WebGL renderer in xterm.js provides a significant performance improvement for the terminal rendering path.

**Plan Option C for medium-term (Q2-Q3).** The hybrid approach gives native rendering quality where it matters most (the terminal) while preserving the existing React UI investment. Start with macOS, use WebGL as the cross-platform fallback.

**Defer Option A indefinitely.** The cost of maintaining two complete UI codebases is not justified unless Remote Dev pivots to a terminal-first product where the web UI is secondary.

### Immediate next steps for Option B:
1. Install `@xterm/addon-webgl`
2. Update `Terminal.tsx` to initialize the WebGL renderer with canvas fallback
3. Test on macOS, Linux, and mobile browsers
4. Measure frame times and memory usage before/after

## Key Differences: Web vs Native Terminal Rendering

| Aspect | Web (xterm.js + WebGL) | Native (libghostty) |
|--------|----------------------|-------------------|
| Rendering pipeline | JS -> WebGL -> GPU | Zig -> Metal/Vulkan -> GPU |
| Font rendering | Browser text metrics + texture atlas | HarfBuzz + FreeType with subpixel AA |
| Input latency | ~16ms (requestAnimationFrame) | <1ms (direct event loop) |
| Memory per terminal | ~15-30MB (DOM + JS heap) | ~5-10MB (native buffers) |
| Scrollback performance | Degrades >100k lines | Stable at 1M+ lines |
| Unicode/emoji | Browser-dependent | Full ICU + custom renderer |
| Color accuracy | sRGB only | P3 wide gamut support |
| Platform support | All browsers + Electron | macOS (Metal), Linux (Vulkan/GL) |

## Effort Summary

| Option | Effort | Platform | Risk | Performance Gain |
|--------|--------|----------|------|-----------------|
| A: Full Native | 10-14 weeks | macOS only | High | 10x |
| B: WebGL Upgrade | 1-2 weeks | All | Low | 3-5x |
| C: Hybrid | 4-6 weeks | macOS + fallback | Medium | 8-10x (macOS) |
