import assert from "node:assert/strict";
import type { LookupAddress } from "node:dns";
import {
  OutboundUrlPolicyError,
  validateOutboundUrl,
  type OutboundUrlPolicyOptions,
} from "../shared/outboundUrlPolicy";
import {
  resolveOutboundUrl,
  validateOutboundRedirectChain,
  type OutboundResolver,
} from "../server/outbound-url-policy";
import {
  getConnectorManifest,
  isConnectorNavigationUrlAllowed,
} from "../services/connector-runner/src/connectors";

const strictPolicy: OutboundUrlPolicyOptions = {};

const blockedUrls = [
  ["decimal IPv4", "https://2130706433/"],
  ["octal IPv4", "https://0177.0.0.1/"],
  ["hex IPv4", "https://0x7f000001/"],
  ["IPv6 loopback", "https://[::1]/"],
  ["IPv6 link-local", "https://[fe80::1]/"],
  ["IPv4-mapped IPv6", "https://[::ffff:127.0.0.1]/"],
  ["AWS metadata IPv4", "https://169.254.169.254/latest/meta-data/"],
  ["AWS metadata IPv6", "https://[fd00:ec2::254]/latest/meta-data/"],
  ["credentials", "https://user:secret@example.com/hook"],
  ["internal DNS suffix", "https://metadata.google.internal/computeMetadata/v1/"],
  ["Kubernetes DNS suffix", "https://api.default.svc.cluster.local/"],
  ["single-label hostname", "https://intranet/"],
  ["non-HTTPS scheme", "http://example.com/"],
  ["nonstandard scheme", "file:///etc/passwd"],
  ["fragment", "https://example.com/hook#private"],
] as const;

for (const [name, url] of blockedUrls) {
  assert.throws(
    () => validateOutboundUrl(url, strictPolicy),
    OutboundUrlPolicyError,
    `${name} should be rejected`,
  );
}

for (const url of ["https://example.com/hook", "https://8.8.8.8/dns-query"]) {
  assert.equal(validateOutboundUrl(url, strictPolicy).url.toString(), url);
}

assert.equal(
  validateOutboundUrl("http://127.0.0.1:5678/hook", {
    allowDevelopmentHttp: true,
    developmentHosts: ["127.0.0.1", "localhost"],
  }).developmentException,
  true,
);
assert.throws(
  () => validateOutboundUrl("http://127.0.0.1:5678/hook", strictPolicy),
  OutboundUrlPolicyError,
  "development hosts must remain blocked without the explicit gate",
);

const publicAnswer: LookupAddress = { address: "93.184.216.34", family: 4 };
const privateAnswer: LookupAddress = { address: "127.0.0.1", family: 4 };
const pinned = await resolveOutboundUrl("https://example.com/", {
  resolver: async () => [publicAnswer],
  policy: strictPolicy,
});
assert.equal(pinned.address, publicAnswer.address, "the approved DNS address is retained for socket pinning");
const mixedResolver: OutboundResolver = async () => [publicAnswer, privateAnswer];
await assert.rejects(
  resolveOutboundUrl("https://example.com/", { resolver: mixedResolver, policy: strictPolicy }),
  OutboundUrlPolicyError,
  "every DNS answer must be public",
);

const publicResolver: OutboundResolver = async () => [publicAnswer];
await assert.rejects(
  validateOutboundRedirectChain(
    ["https://example.com/start", "https://169.254.169.254/latest/meta-data"],
    { resolver: publicResolver, policy: strictPolicy },
  ),
  OutboundUrlPolicyError,
  "a redirect chain ending at metadata must be rejected",
);

let resolutionCount = 0;
const rebindingResolver: OutboundResolver = async () => {
  resolutionCount += 1;
  return resolutionCount === 1 ? [publicAnswer] : [privateAnswer];
};
await assert.rejects(
  validateOutboundRedirectChain(
    ["https://rebind.example.com/start", "https://rebind.example.com/finish"],
    { resolver: rebindingResolver, policy: strictPolicy },
  ),
  OutboundUrlPolicyError,
  "DNS must be re-resolved and revalidated for every redirect hop",
);
assert.equal(resolutionCount, 2);

const wave = getConnectorManifest("wave");
assert.ok(wave);
const connectorCases = [
  ["allowed origin", "https://next.waveapps.com/business/dashboard", true],
  ["lookalike suffix", "https://next.waveapps.com.attacker.example/", false],
  ["arbitrary public origin", "https://example.com/", false],
  ["private navigation", "https://127.0.0.1/", false],
  ["credential escape", "https://next.waveapps.com@attacker.example/", false],
  ["non-network scheme", "javascript:alert(1)", false],
] as const;
for (const [name, url, expected] of connectorCases) {
  assert.equal(isConnectorNavigationUrlAllowed(wave, url), expected, name);
}

console.log(`Outbound URL policy checks passed (${blockedUrls.length + connectorCases.length + 7} cases).`);
