// The README references its screenshots by repo-relative path (docs/img/<file>).
// In the app those images are served by the backend at /api/readme/asset/<file>,
// so rewrite the src. Absolute URLs and non-asset paths pass through unchanged.
// Pure (no globals) so it's unit-testable.
export function rewriteAssetSrc(src) {
  if (!src) return src
  if (/^(https?:)?\/\//i.test(src)) return src
  const m = src.match(/(?:^|\/)docs\/img\/([^/?#]+)/)
  return m ? `/api/readme/asset/${m[1]}` : src
}
