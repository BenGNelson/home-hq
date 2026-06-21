// Should this browser avoid the MJPEG stream and use snapshot polling instead?
//
// The chamber camera is served as an MJPEG (multipart/x-mixed-replace) stream
// that a plain <img> renders by swapping frames in place. That works in Blink
// (Chrome/Edge) and Gecko (Firefox), but WebKit — every browser on iOS, plus
// Safari on macOS — does not reliably render multipart/x-mixed-replace in an
// <img>: it gets stuck "connecting" and paints the broken-image glyph. Those
// browsers fall back to polling the single-frame snapshot endpoint instead.
//
// Detection is intentionally broad (cheap fast-path, not the only safety net —
// the stream path also times out into snapshot mode at runtime):
//   - any iOS device: the UA names iPhone/iPad/iPod (all iOS browsers are WebKit)
//   - desktop Safari (and iPadOS, which reports a Mac UA): "Safari" present but
//     not one of the Blink/Gecko engines that ride on top of it elsewhere.
export function prefersSnapshot(ua = '') {
  if (!ua) return false
  if (/iPhone|iPad|iPod/i.test(ua)) return true
  const isSafari = /Safari/i.test(ua) && !/(Chrome|Chromium|CriOS|FxiOS|Edg|OPR|SamsungBrowser|Android)/i.test(ua)
  return isSafari
}
