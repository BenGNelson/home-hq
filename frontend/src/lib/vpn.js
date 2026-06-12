// Map the /api/vpn payload to a single display verdict. Pure so it's unit-tested
// and the page just renders the result.
//
// tone drives the color; label is the headline. The security-relevant state is
// `leak` (egress IP == home IP → traffic isn't masked). `down` is benign on its
// own — with the kill-switch, no tunnel means no traffic — so it reads neutral.
export function vpnVerdict(v) {
  if (!v || v.available === false) return { tone: 'idle', label: 'Not configured' }
  if (v.stale) return { tone: 'idle', label: 'Stale — checker not running' }
  if (v.status === 'leak') return { tone: 'bad', label: 'Leak detected' }
  if (v.status === 'down') return { tone: 'idle', label: 'VPN off' }
  return { tone: 'good', label: 'Protected' }
}

// A short, human one-liner explaining the current verdict.
export function vpnExplanation(v) {
  if (!v || v.available === false)
    return 'No VPN egress data yet — the host check hasn’t run (see the Server Guide).'
  if (v.stale) return 'The egress checker hasn’t reported recently, so this may be out of date.'
  if (v.status === 'leak')
    return 'The protected container’s traffic is exiting via your home IP — the tunnel is NOT masking it.'
  if (v.status === 'down')
    return 'The VPN container isn’t running. With the kill-switch, that means no traffic leaves — not a leak.'
  return 'Traffic from the protected container exits through the VPN, not your home connection.'
}
