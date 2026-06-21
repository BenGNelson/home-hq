import { describe, it, expect } from 'vitest'
import { prefersSnapshot } from './camera.js'

// Representative real-world UA strings.
const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1',
  // iPadOS 13+ reports a desktop Mac UA — caught by the Safari branch, not iPad.
  ipadSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  desktopFirefox:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
}

describe('prefersSnapshot', () => {
  it('uses snapshot polling on all iOS browsers (WebKit-only)', () => {
    expect(prefersSnapshot(UA.iphoneSafari)).toBe(true)
    expect(prefersSnapshot(UA.iphoneChrome)).toBe(true)
    expect(prefersSnapshot(UA.ipadSafari)).toBe(true)
  })

  it('uses snapshot polling on desktop Safari', () => {
    expect(prefersSnapshot(UA.macSafari)).toBe(true)
  })

  it('uses the MJPEG stream on Blink/Gecko browsers', () => {
    expect(prefersSnapshot(UA.macChrome)).toBe(false)
    expect(prefersSnapshot(UA.desktopFirefox)).toBe(false)
    expect(prefersSnapshot(UA.androidChrome)).toBe(false)
  })

  it('defaults to the stream (false) when the UA is missing', () => {
    expect(prefersSnapshot('')).toBe(false)
    expect(prefersSnapshot()).toBe(false)
  })
})
