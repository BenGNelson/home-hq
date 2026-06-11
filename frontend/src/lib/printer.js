// Pure helpers for the Printer module — map the printer's raw gcode_state into
// a friendly label + a tone the UI styles against. Kept tiny and side-effect
// free so it's unit-testable (see printer.test.js).

const STATES = {
  RUNNING: { label: 'Printing', tone: 'sky' },
  PAUSE: { label: 'Paused', tone: 'amber' },
  FINISH: { label: 'Finished', tone: 'emerald' },
  FAILED: { label: 'Failed', tone: 'rose' },
  IDLE: { label: 'Idle', tone: 'slate' },
  PREPARE: { label: 'Preparing', tone: 'sky' },
  SLICING: { label: 'Slicing', tone: 'sky' },
}

export function printerStatus(state) {
  return STATES[state] ?? { label: state || 'Unknown', tone: 'slate' }
}

// Friendly message for an unavailable printer, keyed by the backend's reason.
const REASONS = {
  not_configured: 'No printer configured',
  no_data: 'Connecting to printer…',
  offline: 'Printer offline or asleep',
}

export function printerUnavailableMessage(reason) {
  return REASONS[reason] ?? 'Printer unavailable'
}

// The printer reports filament color as a hex value, not a name. Map it to the
// nearest human-readable color so the UI can label spools ("White", "Orange").
const NAMED_COLORS = [
  ['White', [255, 255, 255]],
  ['Black', [20, 20, 20]],
  ['Gray', [128, 128, 128]],
  ['Silver', [192, 192, 192]],
  ['Red', [220, 30, 30]],
  ['Orange', [240, 130, 30]],
  ['Yellow', [240, 230, 40]],
  ['Green', [40, 170, 70]],
  ['Teal', [0, 160, 160]],
  ['Blue', [40, 80, 200]],
  ['Navy', [20, 30, 90]],
  ['Purple', [130, 60, 160]],
  ['Magenta', [220, 40, 180]],
  ['Pink', [240, 150, 180]],
  ['Brown', [120, 70, 40]],
]

export function colorName(hex) {
  if (!hex) return 'Unknown'
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i)
  if (!m) return 'Unknown'
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16))
  let best = 'Unknown'
  let bestDist = Infinity
  for (const [name, [cr, cg, cb]] of NAMED_COLORS) {
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2
    if (d < bestDist) {
      bestDist = d
      best = name
    }
  }
  return best
}
