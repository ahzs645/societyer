import assert from "node:assert/strict";
import {
  activeCertificates,
  certificateChain,
  validateCertificate,
  sharesOutstandingByClass,
  type CertificateEvent,
} from "../shared/shareCertificates";

// --- fixtures -------------------------------------------------------------

const c1: CertificateEvent = {
  certificateNumber: "C1",
  holderName: "Ada Lovelace",
  shareClass: "Common",
  shares: 100,
  issuedOn: "2024-01-01",
  cancelledOn: "2024-06-01",
};

const c2: CertificateEvent = {
  certificateNumber: "C2",
  holderName: "Ada Lovelace",
  shareClass: "Common",
  shares: 100,
  issuedOn: "2024-06-01",
  replacesCertificateNumber: "C1",
};

const c3: CertificateEvent = {
  certificateNumber: "C3",
  holderName: "Grace Hopper",
  shareClass: "Preferred",
  shares: 50,
  issuedOn: "2024-03-01",
};

const events = [c1, c2, c3];

// --- activeCertificates: issue/cancel boundaries --------------------------

// Before anything issued.
assert.deepEqual(activeCertificates(events, "2023-12-31"), []);

// After C1 issued, before C3 issued: only C1 active.
assert.deepEqual(
  activeCertificates(events, "2024-02-01").map((e) => e.certificateNumber),
  ["C1"],
);

// On C1's issue date: present at exact issue.
assert.deepEqual(
  activeCertificates(events, "2024-01-01").map((e) => e.certificateNumber),
  ["C1"],
);

// On the cancel/replace boundary 2024-06-01: C1 cancelled (absent), C2 issued
// (present), C3 active.
assert.deepEqual(
  activeCertificates(events, "2024-06-01")
    .map((e) => e.certificateNumber)
    .sort(),
  ["C2", "C3"],
);

// --- certificateChain -----------------------------------------------------

// Following C2 backwards reaches C1; ordered original -> latest.
assert.deepEqual(
  certificateChain(events, "C2").map((e) => e.certificateNumber),
  ["C1", "C2"],
);

// A leaf with no replacement is a chain of one.
assert.deepEqual(
  certificateChain(events, "C3").map((e) => e.certificateNumber),
  ["C3"],
);

// Unknown certificate -> empty chain.
assert.deepEqual(certificateChain(events, "NOPE"), []);

// Cycle guard: self-referencing certificate terminates.
const selfRef: CertificateEvent = {
  certificateNumber: "X1",
  holderName: "Loopy",
  shareClass: "Common",
  shares: 1,
  issuedOn: "2024-01-01",
  replacesCertificateNumber: "X1",
};
assert.deepEqual(
  certificateChain([selfRef], "X1").map((e) => e.certificateNumber),
  ["X1"],
);

// --- validateCertificate --------------------------------------------------

assert.deepEqual(validateCertificate(c1), { ok: true, errors: [] });

// Missing required fields + non-positive non-integer shares.
const bad: CertificateEvent = {
  certificateNumber: "",
  holderName: "  ",
  shareClass: "",
  shares: 0,
  issuedOn: "",
};
const badResult = validateCertificate(bad);
assert.equal(badResult.ok, false);
assert.ok(badResult.errors.some((m) => m.includes("certificateNumber")));
assert.ok(badResult.errors.some((m) => m.includes("holderName")));
assert.ok(badResult.errors.some((m) => m.includes("shareClass")));
assert.ok(badResult.errors.some((m) => m.includes("issuedOn")));
assert.ok(badResult.errors.some((m) => m.includes("shares")));

// Fractional shares are rejected.
assert.equal(
  validateCertificate({ ...c1, cancelledOn: null, shares: 1.5 }).ok,
  false,
);

// cancelledOn before issuedOn is rejected.
const backwards = validateCertificate({
  ...c2,
  issuedOn: "2024-06-01",
  cancelledOn: "2024-05-01",
});
assert.equal(backwards.ok, false);
assert.ok(backwards.errors.some((m) => m.includes("cancelledOn")));

// cancelledOn == issuedOn is allowed.
assert.equal(
  validateCertificate({ ...c2, issuedOn: "2024-06-01", cancelledOn: "2024-06-01" }).ok,
  true,
);

// --- sharesOutstandingByClass: sums only active ---------------------------

// At 2024-02-01 only C1 (Common, 100) is active.
assert.deepEqual(sharesOutstandingByClass(events, "2024-02-01"), {
  Common: 100,
});

// At 2024-06-01: C2 (Common, 100) + C3 (Preferred, 50) active; C1 cancelled.
assert.deepEqual(sharesOutstandingByClass(events, "2024-06-01"), {
  Common: 100,
  Preferred: 50,
});

// Two active Common certs sum within the class.
const extraCommon: CertificateEvent = {
  certificateNumber: "C4",
  holderName: "Katherine Johnson",
  shareClass: "Common",
  shares: 25,
  issuedOn: "2024-06-01",
};
assert.deepEqual(
  sharesOutstandingByClass([...events, extraCommon], "2024-06-01"),
  { Common: 125, Preferred: 50 },
);

// Before any issuance: empty.
assert.deepEqual(sharesOutstandingByClass(events, "2023-01-01"), {});

console.log("OK share-certificates");
