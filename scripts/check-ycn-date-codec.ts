import assert from "node:assert/strict";

import { decodeYcnDate, encodeYcnDate, isYcnNullDate } from "../shared/ycnDate";

// Round-trip: full timestamp.
assert.equal(decodeYcnDate(20161213.155505), "2016-12-13T15:55:05");
assert.equal(encodeYcnDate("2016-12-13T15:55:05"), 20161213.155505);

// Padded fractional part: '09' -> '090000'.
assert.equal(decodeYcnDate(20200714.09), "2020-07-14T09:00:00");
assert.equal(encodeYcnDate("2020-07-14T09:00:00"), 20200714.09);

// Sentinel / no-value: date part < 19000101.
assert.equal(decodeYcnDate(18991230.0), null);
assert.equal(isYcnNullDate(18991230.0), true);
assert.equal(isYcnNullDate(20161213.155505), false);

// null / empty handling.
assert.equal(decodeYcnDate(null), null);
assert.equal(decodeYcnDate(undefined), null);
assert.equal(decodeYcnDate(""), null);
assert.equal(encodeYcnDate(null), null);
assert.equal(encodeYcnDate(undefined), null);
assert.equal(encodeYcnDate(""), null);
assert.equal(isYcnNullDate(null), true);
assert.equal(isYcnNullDate(undefined), true);
assert.equal(isYcnNullDate(""), true);

// String slicing (no float drift): 20240101.000001 -> '...T00:00:01' exactly.
assert.equal(decodeYcnDate(20240101.000001), "2024-01-01T00:00:01");

// Guard against the classic binary-float drift case: .155505 must NOT
// decode to '...:04'. Already asserted above, but assert the string form too.
assert.equal(decodeYcnDate("20161213.155505"), "2016-12-13T15:55:05");

// String inputs round-trip equivalently.
assert.equal(decodeYcnDate("20200714.09"), "2020-07-14T09:00:00");

// Midnight (no fractional part) decodes to all-zero time.
assert.equal(decodeYcnDate(20240101), "2024-01-01T00:00:00");
assert.equal(decodeYcnDate("20240101.0"), "2024-01-01T00:00:00");

// Encode tolerates date-only ISO.
assert.equal(encodeYcnDate("2024-01-01"), 20240101);

console.log("OK ycn-date-codec");
