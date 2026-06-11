// Map ntfy tag shortcodes (what the backend sends) to the emoji to show in-app,
// so the Alerts page reads the same as the phone notification.
const EMOJI = {
  floppy_disk: '💾',
  rotating_light: '🚨',
  minidisc: '💽',
  card_file_box: '🗄️',
  electric_plug: '🔌',
  package: '📦',
  printer: '🖨️',
  warning: '⚠️',
  satellite: '🛰️',
  desktop_computer: '🖥️',
  white_check_mark: '✅',
}

export function alertEmoji(tag) {
  return EMOJI[tag] || '🔔'
}
