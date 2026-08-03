export type OutboundUrlPolicyOptions = {
  allowDevelopmentHttp?: boolean;
  developmentHosts?: readonly string[];
  allowedOrigins?: readonly string[];
  rejectFragments?: boolean;
};

export type ValidatedOutboundUrl = {
  url: URL;
  hostname: string;
  developmentException: boolean;
};

export class OutboundUrlPolicyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OutboundUrlPolicyError";
    this.code = code;
  }
}

const INTERNAL_SUFFIXES = [
  ".internal",
  ".local",
  ".localdomain",
  ".lan",
  ".home",
  ".home.arpa",
  ".cluster.local",
  ".svc",
  ".test",
  ".invalid",
  ".example",
  ".onion",
];

function normalizedHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function ipv4Number(hostname: string): number | undefined {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return undefined;
  const octets = parts.map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return undefined;
  return (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]) >>> 0;
}

function inIpv4Range(value: number, base: number, prefix: number) {
  if (prefix === 0) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

const BLOCKED_IPV4_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0586300, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
];

function parseIpv6(hostname: string): bigint | undefined {
  if (!hostname.includes(":")) return undefined;
  let source = hostname.toLowerCase();
  const zone = source.indexOf("%");
  if (zone >= 0) source = source.slice(0, zone);

  const embeddedIpv4 = source.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (embeddedIpv4) {
    const value = ipv4Number(embeddedIpv4);
    if (value === undefined) return undefined;
    source = source.slice(0, -embeddedIpv4.length) + `${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }

  const halves = source.split("::");
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return undefined;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return undefined;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function inIpv6Range(value: bigint, base: bigint, prefix: number) {
  if (prefix === 0) return true;
  const shift = BigInt(128 - prefix);
  return value >> shift === base >> shift;
}

function ipv6Base(value: string) {
  const parsed = parseIpv6(value);
  if (parsed === undefined) throw new Error(`Invalid policy IPv6 base: ${value}`);
  return parsed;
}

const BLOCKED_IPV6_RANGES: ReadonlyArray<readonly [bigint, number]> = [
  [ipv6Base("::"), 128],
  [ipv6Base("::1"), 128],
  [ipv6Base("::ffff:0:0"), 96],
  [ipv6Base("64:ff9b:1::"), 48],
  [ipv6Base("100::"), 64],
  [ipv6Base("2001::"), 23],
  [ipv6Base("2002::"), 16],
  [ipv6Base("fc00::"), 7],
  [ipv6Base("fe80::"), 10],
  [ipv6Base("ff00::"), 8],
];

export function isPrivateOrReservedAddress(address: string) {
  const hostname = normalizedHostname(address);
  const ipv4 = ipv4Number(hostname);
  if (ipv4 !== undefined) {
    return BLOCKED_IPV4_RANGES.some(([base, prefix]) => inIpv4Range(ipv4, base, prefix));
  }
  const ipv6 = parseIpv6(hostname);
  if (ipv6 === undefined) return false;
  return BLOCKED_IPV6_RANGES.some(([base, prefix]) => inIpv6Range(ipv6, base, prefix));
}

export function isInternalHostname(hostname: string) {
  const normalized = normalizedHostname(hostname);
  return normalized === "localhost" ||
    !normalized.includes(".") ||
    INTERNAL_SUFFIXES.some((suffix) => normalized === suffix.slice(1) || normalized.endsWith(suffix));
}

export function validateOutboundUrl(
  rawUrl: string,
  options: OutboundUrlPolicyOptions = {},
): ValidatedOutboundUrl {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new OutboundUrlPolicyError("invalid_url", "Outbound URL is not valid.");
  }
  if (url.username || url.password) {
    throw new OutboundUrlPolicyError("credentials", "Outbound URLs cannot contain credentials.");
  }
  if ((options.rejectFragments ?? true) && url.hash) {
    throw new OutboundUrlPolicyError("fragment", "Outbound URLs cannot contain fragments.");
  }

  const hostname = normalizedHostname(url.hostname);
  const developmentHosts = new Set((options.developmentHosts ?? []).map(normalizedHostname));
  const developmentException = Boolean(options.allowDevelopmentHttp && developmentHosts.has(hostname));
  if (url.protocol !== "https:" && !(developmentException && url.protocol === "http:")) {
    throw new OutboundUrlPolicyError("scheme", "Outbound URLs must use HTTPS.");
  }
  if (!hostname) {
    throw new OutboundUrlPolicyError("hostname", "Outbound URL must include a hostname.");
  }
  if (!developmentException && (isInternalHostname(hostname) || isPrivateOrReservedAddress(hostname))) {
    throw new OutboundUrlPolicyError("private_host", "Outbound URL targets a private or reserved host.");
  }
  if (options.allowedOrigins?.length) {
    const allowedOrigins = new Set(options.allowedOrigins.map((origin) => new URL(origin).origin));
    if (!allowedOrigins.has(url.origin)) {
      throw new OutboundUrlPolicyError("origin", "Outbound URL origin is not allowed for this operation.");
    }
  }
  return { url, hostname, developmentException };
}
