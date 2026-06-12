// Plain-language notes for common SMART attribute IDs. Vendors vary the human
// names but the IDs are stable, so we key on the number. Unknown IDs return null
// (the row still renders, just without an explanation).
const ATTR_NOTES = {
  1: 'Raw read errors off the platter/flash. Judge by the normalized value, not the raw count.',
  3: 'Time for the platters to spin up (mechanical drives).',
  4: 'Count of spin-up/start-stop events.',
  5: 'Sectors remapped after going bad. Should stay 0 — any growth is an early failure sign.',
  7: 'Seek errors (mechanical drives).',
  9: 'Total hours the drive has been powered on.',
  10: 'Retried spin-up attempts (mechanical drives).',
  12: 'Power-on/off cycle count.',
  173: 'Flash erase cycles used — SSD wear indicator.',
  177: 'SSD wear-leveling count — how evenly the flash is being used.',
  187: 'Uncorrectable errors reported to the host. Should be 0.',
  188: 'Commands that timed out.',
  190: 'Airflow / drive temperature.',
  194: 'Current drive temperature.',
  196: 'Times the controller had to reallocate a sector.',
  197: 'Sectors pending reallocation (unstable). Should be 0.',
  198: 'Uncorrectable sectors found during offline scan. Should be 0.',
  199: 'Interface CRC errors — usually a cable/connection issue, not the disk itself.',
  231: 'SSD life remaining (some vendors).',
  233: 'NAND endurance / media wear-out remaining (some vendors).',
  241: 'Total data written over the drive’s life.',
  242: 'Total data read over the drive’s life.',
}

export function attrNote(id) {
  return ATTR_NOTES[id] ?? null
}

// Health of a single attribute: 'fail' if SMART itself flagged it (when_failed
// set), 'warn' if the normalized value has fallen to/below its threshold, else
// 'ok'. (thresh 0 means "informational, never fails", so it can't warn.)
export function attrHealth(a) {
  if (a.when_failed) return 'fail'
  if (a.thresh != null && a.thresh > 0 && a.value != null && a.value <= a.thresh) {
    return 'warn'
  }
  return 'ok'
}
