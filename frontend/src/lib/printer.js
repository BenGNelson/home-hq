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
