import assert from "node:assert/strict";
import { assertLocalPilotRequest, configureLiveSession } from "./server/liveSession";

const request = (headers: { host?: string; origin?: string; "sec-fetch-site"?: string | string[] } = { host: "127.0.0.1:4195" }, remoteAddress = "127.0.0.1", method = "GET") => ({ method, headers, socket: { remoteAddress } });
const cases: { name: string; body: () => void | Promise<void> }[] = [
  { name: "Local GET accepts IPv4, IPv6 and mapped loopback sockets", body: () => {
    for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) assertLocalPilotRequest(request(undefined, address));
  } },
  { name: "Local GET accepts only loopback Host authorities", body: () => {
    for (const host of ["127.0.0.1:4195", "localhost:4195", "[::1]:4195"]) assertLocalPilotRequest(request({ host }));
    for (const host of ["untrusted.example:4195", "localhost.untrusted.example:4195", "127.0.0.1.untrusted.example:4195", undefined, "not a host"]) assert.throws(() => assertLocalPilotRequest(request({ host })));
  } },
  { name: "Remote socket and non-GET requests cannot reach the test signer", body: () => {
    assert.throws(() => assertLocalPilotRequest(request(undefined, "192.0.2.1")), /Loopback GET/);
    for (const method of ["POST", "PUT", "DELETE", "HEAD", "OPTIONS"]) assert.throws(() => assertLocalPilotRequest(request(undefined, "127.0.0.1", method)), /Loopback GET/);
  } },
  { name: "Mismatched Origin and cross-site browser requests are denied", body: () => {
    assertLocalPilotRequest(request({ host: "127.0.0.1:4195", origin: "http://127.0.0.1:4195", "sec-fetch-site": "same-origin" }));
    for (const origin of ["http://untrusted.example:4195", "http://127.0.0.1:4194", "http://localhost:4195", "null"]) assert.throws(() => assertLocalPilotRequest(request({ host: "127.0.0.1:4195", origin })), /Same-origin/);
    assert.throws(() => assertLocalPilotRequest(request({ host: "127.0.0.1:4195", "sec-fetch-site": "cross-site" })), /Cross-site/);
    assert.throws(() => assertLocalPilotRequest(request({ host: "untrusted.example:4195", origin: "http://untrusted.example:4195" })), /Loopback Host/);
  } },
  { name: "Fixture broker is absent unless explicitly enabled", body: async () => {
    const previous = process.env.SOCIETYER_LOCAL_LIVE_PILOT;
    let mounted = false;
    try {
      for (const flag of [undefined, "0", "true", "yes"]) {
        if (flag === undefined) delete process.env.SOCIETYER_LOCAL_LIVE_PILOT;
        else process.env.SOCIETYER_LOCAL_LIVE_PILOT = flag;
        await configureLiveSession({ middlewares: { use: () => { mounted = true; } } } as unknown as Parameters<typeof configureLiveSession>[0]);
      }
      assert.equal(mounted, false, "Disabled broker must not load secrets or register routes");
    } finally {
      if (previous === undefined) delete process.env.SOCIETYER_LOCAL_LIVE_PILOT;
      else process.env.SOCIETYER_LOCAL_LIVE_PILOT = previous;
    }
  } },
];
for (const check of cases) { await check.body(); console.log(`PASS ${check.name}`); }
console.log(`Local test broker request boundaries: ${cases.length}/${cases.length} passed.`);
