"use strict";

/**
 * Outbound URL policy for provider API calls (YTT-436, issue #16).
 *
 * Built-in providers stay on a fixed HTTPS host allowlist. Every other
 * http(s) URL — including a custom baseUrl tested with the stored key —
 * must not be a private, loopback, link-local, or cloud-metadata target.
 * Hostname checks run on the parsed URL (so decimal/hex/octal IPv4 forms
 * are canonicalized first). Non-literal hosts are also checked after DNS
 * resolution; any blocked address fails closed.
 */

const { isIP } = require("node:net");
const dns = require("node:dns");

/** Exact hosts hardcoded for built-in provider endpoints. */
const KNOWN_PROVIDER_HOSTS = new Set([
  "api.groq.com",
  "openrouter.ai",
  "api.openai.com",
]);

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "kubernetes.default",
  "kubernetes.default.svc",
  "kubernetes.default.svc.cluster.local",
]);

const BLOCKED_MESSAGE =
  "Custom base URL must not target a private, link-local, or metadata address";

/** Non-public IPv4 ranges (RFC1918, loopback, link-local, CGNAT, documentation, multicast). */
const IPV4_BLOCKS = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

/**
 * @param {string} hostname
 * @returns {string}
 */
function normalizeHostname(hostname) {
  let host = String(hostname || "").trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }
  while (host.endsWith(".")) host = host.slice(0, -1);
  return host;
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isKnownProviderHost(hostname) {
  return KNOWN_PROVIDER_HOSTS.has(normalizeHostname(hostname));
}

/**
 * Known hosts may follow redirects. Custom hosts must not: a public URL can
 * 302 to a metadata address and the stored Bearer key would be forwarded.
 * @param {string} hostname
 * @returns {"follow" | "manual"}
 */
function providerFetchRedirect(hostname) {
  return isKnownProviderHost(hostname) ? "follow" : "manual";
}

/**
 * @param {string} ip
 * @returns {number | null}
 */
function ipv4ToInt(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/**
 * @param {number} ip
 * @param {string} base
 * @param {number} bits
 * @returns {boolean}
 */
function ipv4InCidr(ip, base, bits) {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  const shift = 2 ** (32 - bits);
  return Math.floor(ip / shift) === Math.floor(baseInt / shift);
}

/**
 * @param {string} ip
 * @returns {boolean}
 */
function isBlockedIpv4(ip) {
  const value = ipv4ToInt(ip);
  if (value === null) return true;
  return IPV4_BLOCKS.some(([base, bits]) => ipv4InCidr(value, base, bits));
}

/**
 * Expand an IPv6 address to eight hextets. Returns null when the form is
 * not a usable address (caller fails closed).
 * @param {string} ip
 * @returns {string[] | null}
 */
function expandIpv6(ip) {
  let text = ip.toLowerCase().split("%")[0];
  const dotted = text.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const octets = dotted[2].split(".").map(Number);
    if (octets.some((n) => n > 255)) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    text = `${dotted[1]}${hi}:${lo}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    return head.map((part) => part.padStart(4, "0"));
  }
  const tail = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  return [...head, ...Array(missing).fill("0"), ...tail].map((part) =>
    part.padStart(4, "0")
  );
}

/**
 * @param {string[]} words eight hextets
 * @returns {string}
 */
function ipv4FromTail(words) {
  const hi = parseInt(words[6], 16);
  const lo = parseInt(words[7], 16);
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

/**
 * @param {string} ip
 * @returns {boolean}
 */
function isBlockedIpv6(ip) {
  const words = expandIpv6(ip);
  if (!words || words.length !== 8) return true;
  if (words.some((word) => !/^[0-9a-f]{4}$/.test(word))) return true;

  const mapped =
    words.slice(0, 5).every((word) => word === "0000") && words[5] === "ffff";
  if (mapped) return isBlockedIpv4(ipv4FromTail(words));

  const compatible = words.slice(0, 6).every((word) => word === "0000");
  if (compatible) {
    if (words[6] === "0000" && (words[7] === "0000" || words[7] === "0001")) {
      return true;
    }
    return isBlockedIpv4(ipv4FromTail(words));
  }

  // NAT64 well-known prefix 64:ff9b::/96 — block when the embedded IPv4 is blocked.
  if (
    words[0] === "0064" &&
    words[1] === "ff9b" &&
    words.slice(2, 6).every((word) => word === "0000")
  ) {
    return isBlockedIpv4(ipv4FromTail(words));
  }

  const first = parseInt(words[0], 16);
  if (first >= 0xfc00 && first <= 0xfdff) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local
  if (first >= 0xff00) return true; // ff00::/8 multicast
  return false;
}

/**
 * @param {string} ip
 * @returns {boolean}
 */
function isBlockedIpAddress(ip) {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedIpv4(ip);
  if (kind === 6) return isBlockedIpv6(ip);
  return false;
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isBlockedHostname(hostname) {
  const host = normalizeHostname(hostname);
  if (!host) return true;
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith(".localhost")) return true;
  if (host.endsWith(".local")) return true;
  if (host.endsWith(".localdomain")) return true;
  if (host.endsWith(".internal")) return true;
  return false;
}

/**
 * Synchronous URL gate. Null means the parsed URL is acceptable before DNS.
 * @param {string} urlString
 * @returns {string | null}
 */
function assertSafeProviderUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return "Invalid base URL";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "Custom base URL must use http or https";
  }
  if (parsed.username || parsed.password) {
    return "Custom base URL must not include credentials";
  }

  const host = normalizeHostname(parsed.hostname);
  if (!host) return "Invalid base URL";
  if (isIP(host)) {
    return isBlockedIpAddress(host) ? BLOCKED_MESSAGE : null;
  }
  if (isBlockedHostname(host)) return BLOCKED_MESSAGE;
  return null;
}

/**
 * @param {string} hostname
 * @returns {Promise<string[]>}
 */
async function defaultLookup(hostname) {
  const records = await dns.promises.lookup(hostname, {
    all: true,
    verbatim: true,
  });
  return records.map((record) => record.address);
}

/**
 * Sync policy plus DNS. A known-provider hostname is not exempt: if it
 * resolves to a blocked address, the call is refused.
 * @param {string} urlString
 * @param {{ lookup?: (hostname: string) => Promise<string[]> }} [options]
 * @returns {Promise<string | null>}
 */
async function assertSafeProviderUrlResolved(urlString, options = {}) {
  const syncError = assertSafeProviderUrl(urlString);
  if (syncError) return syncError;

  const host = normalizeHostname(new URL(urlString).hostname);
  if (isIP(host)) return null;

  const lookup = options.lookup || defaultLookup;
  let addresses;
  try {
    addresses = await lookup(host);
  } catch {
    return "Custom base URL host could not be resolved";
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    return "Custom base URL host could not be resolved";
  }
  for (const address of addresses) {
    if (typeof address !== "string" || isBlockedIpAddress(address)) {
      return BLOCKED_MESSAGE;
    }
  }
  return null;
}

module.exports = {
  KNOWN_PROVIDER_HOSTS,
  BLOCKED_MESSAGE,
  isKnownProviderHost,
  providerFetchRedirect,
  isBlockedIpAddress,
  assertSafeProviderUrl,
  assertSafeProviderUrlResolved,
};
