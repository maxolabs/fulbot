// Rules for the admin-supplied WhatsApp webhook URL (review E#22, SSRF). Pure
// and dependency-free so the settings form can run the same checks before
// saving; channels/whatsapp-webhook.ts adds the DNS check at send time, where
// every resolved address must pass isPublicIpAddress().

export type WebhookUrlProblem = 'invalid' | 'https' | 'credentials' | 'host'

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa']

function parseIPv4(address: string): number[] | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const bytes = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN))
  return bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255) ? bytes : null
}

function isPublicIPv4(bytes: number[]): boolean {
  const [a, b, c] = bytes
  if (a === 0 || a === 10 || a === 127) return false // "this" network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return false // carrier-grade NAT
  if (a === 169 && b === 254) return false // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false // IETF, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false // benchmarking
  if (a === 198 && b === 51 && c === 100) return false // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false // TEST-NET-3
  if (a >= 224) return false // multicast, reserved, broadcast
  return true
}

// Expands an IPv6 literal (optionally with a trailing dotted IPv4) to eight
// 16-bit groups. Returns null when it isn't a valid IPv6 address.
function parseIPv6(address: string): number[] | null {
  let text = address.toLowerCase()
  const zone = text.indexOf('%')
  if (zone !== -1) text = text.slice(0, zone)
  let tail: number[] = []
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':')
    if (lastColon === -1) return null
    const v4 = parseIPv4(text.slice(lastColon + 1))
    if (!v4) return null
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]]
    // "::ffff:1.2.3.4" -> "::ffff", "::1.2.3.4" -> "::"; the IPv4 becomes `tail`.
    text = text.slice(0, lastColon + 1)
    if (!text.endsWith('::')) text = text.slice(0, -1)
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const toGroups = (part: string) => (part === '' ? [] : part.split(':'))
  const head = toGroups(halves[0])
  const rest = halves.length === 2 ? toGroups(halves[1]) : []
  const valid = (g: string) => /^[0-9a-f]{1,4}$/.test(g)
  if (![...head, ...rest].every(valid)) return null
  const explicit = head.length + rest.length + tail.length
  if (halves.length === 1 && explicit !== 8) return null
  if (halves.length === 2 && explicit > 7) return null
  const zeros = new Array(8 - explicit).fill(0)
  return [
    ...head.map((g) => parseInt(g, 16)),
    ...(halves.length === 2 ? zeros : []),
    ...rest.map((g) => parseInt(g, 16)),
    ...tail,
  ]
}

function isPublicIPv6(groups: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups
  const embeddedV4 = [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]
  if (groups.every((g) => g === 0)) return false // unspecified
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return false // loopback
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): judge the IPv4.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
    return isPublicIPv4(embeddedV4)
  }
  // NAT64 (64:ff9b::/96) wraps an IPv4 as well.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return isPublicIPv4(embeddedV4)
  if ((g0 & 0xfe00) === 0xfc00) return false // unique local (incl. fd00:ec2::254 metadata)
  if ((g0 & 0xffc0) === 0xfe80) return false // link-local
  if ((g0 & 0xffc0) === 0xfec0) return false // site-local (deprecated)
  if ((g0 & 0xff00) === 0xff00) return false // multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return false // documentation
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return false // discard-only
  if (g0 === 0x2002) return isPublicIPv4([g1 >> 8, g1 & 0xff, g2 >> 8, g2 & 0xff]) // 6to4
  return true
}

/** True for an IP literal (v4 or v6) that is safe to connect to. */
export function isPublicIpAddress(address: string): boolean {
  const v4 = parseIPv4(address)
  if (v4) return isPublicIPv4(v4)
  const v6 = parseIPv6(address.replace(/^\[|\]$/g, ''))
  if (v6) return isPublicIPv6(v6)
  return false
}

export function isIpLiteral(host: string): boolean {
  return parseIPv4(host) !== null || parseIPv6(host.replace(/^\[|\]$/g, '')) !== null
}

/**
 * Checks everything that can be decided without DNS: https, no credentials,
 * no local-only host names and no private IP literals. Returns null when the
 * URL is acceptable.
 */
export function checkWebhookUrl(raw: string): WebhookUrlProblem | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return 'invalid'
  }
  if (url.protocol !== 'https:') return 'https'
  if (url.username || url.password) return 'credentials'
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!host || host === 'localhost' || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) return 'host'
  if (isIpLiteral(host) && !isPublicIpAddress(host)) return 'host'
  // A bare single-label name ("router", "metadata") only resolves on a local network.
  if (!isIpLiteral(host) && !host.includes('.')) return 'host'
  return null
}
