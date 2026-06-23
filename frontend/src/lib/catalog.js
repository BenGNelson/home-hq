// Pure helpers for the Home Catalog module — kept JSX-free so they're unit-tested.

export const CATEGORY_LABELS = {
  device: 'Device',
  appliance: 'Appliance',
  tool: 'Tool',
  equipment: 'Equipment',
  furniture: 'Furniture',
  infrastructure: 'Infrastructure',
  network: 'Network',
  vehicle: 'Vehicle',
  other: 'Other',
}

export function categoryLabel(cat) {
  if (!cat) return 'Other'
  return CATEGORY_LABELS[cat] || cat.charAt(0).toUpperCase() + cat.slice(1)
}

// Small descriptive tags for an item row (brand / model / quantity). in_ha and
// the ⚠️ flag render as their own badges, so they're not included here.
export function itemTags(item) {
  const tags = []
  if (item.brand) tags.push(item.brand)
  if (item.model && item.model !== item.brand) tags.push(item.model)
  if (item.qty) tags.push(/^\d+$/.test(String(item.qty)) ? `×${item.qty}` : String(item.qty))
  return tags
}

// Case-insensitive substring match across the human-meaningful fields.
export function matchesQuery(item, q) {
  if (!q) return true
  const hay = [item.name, item.brand, item.model, item.category, item.entity, item.notes]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return hay.includes(q.trim().toLowerCase())
}

// Apply the search + toggle filters to one item.
export function itemVisible(item, { q = '', onlyHa = false, onlyFlag = false } = {}) {
  if (onlyHa && !item.in_ha) return false
  if (onlyFlag && !item.flag) return false
  return matchesQuery(item, q)
}

// Count items across a floor's rooms.
export function floorItemCount(floor) {
  return (floor.rooms || []).reduce((n, r) => n + (r.items?.length || 0), 0)
}
