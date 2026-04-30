// Pixel slop a single-touch swipe must exceed before we treat it as a scroll
// gesture (rather than a tap). Exported so the touch-scroll unit test stays in
// sync with the production value without pulling Terminal.tsx into the test.
export const TOUCH_SCROLL_ACTIVATION_PX = 5;
