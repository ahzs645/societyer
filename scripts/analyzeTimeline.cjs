/* eslint-disable */
// Parse a V8 .heaptimeline file (Allocation instrumentation on timeline) and
// identify leak candidates: classes whose surviving instances were allocated
// continuously over the recording rather than only at startup.
const fs = require("fs");

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/analyzeTimeline.cjs <file.heaptimeline>");
  process.exit(1);
}

console.log("loading", path);
const snap = JSON.parse(fs.readFileSync(path, "utf8"));
const meta = snap.snapshot.meta;
const nodeFields = meta.node_fields;
const types = meta.node_types[0];
const T = nodeFields.indexOf("type");
const N = nodeFields.indexOf("name");
const ID = nodeFields.indexOf("id");
const S = nodeFields.indexOf("self_size");
const D = nodeFields.indexOf("detachedness");
const NF = nodeFields.length;
const nodes = snap.nodes;
const strings = snap.strings;
const samples = snap.samples; // pairs [timestamp_us, last_assigned_id]

const nodeCount = nodes.length / NF;
console.log("nodes:", nodeCount.toLocaleString(), " samples:", (samples.length / 2).toLocaleString());

// Build sorted (id -> timestamp_us) lookup. last_assigned_id at time T means
// every node with id <= last_assigned_id was allocated by time T. So a node's
// allocation-time is the FIRST sample whose last_assigned_id >= node.id.
const sampleIds = new Array(samples.length / 2);
const sampleTs = new Array(samples.length / 2);
for (let i = 0; i < samples.length; i += 2) {
  sampleTs[i / 2] = samples[i];
  sampleIds[i / 2] = samples[i + 1];
}

const totalDurationUs = sampleTs[sampleTs.length - 1] - sampleTs[0];
console.log("recording duration:", (totalDurationUs / 1e6).toFixed(1), "s");

// Binary search for allocation-time given a node id.
function allocTimeFor(id) {
  let lo = 0,
    hi = sampleIds.length - 1;
  if (id > sampleIds[hi]) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sampleIds[mid] < id) lo = mid + 1;
    else hi = mid;
  }
  return sampleTs[lo];
}

// Bucket every surviving node into 20 equal time windows. Track per (class -> bucket) counts and total self_size.
const BUCKETS = 20;
const startTs = sampleTs[0];
const endTs = sampleTs[sampleTs.length - 1];
const bucketWidth = (endTs - startTs) / BUCKETS;

function bucketOf(ts) {
  if (ts < 0) return 0;
  const b = Math.min(BUCKETS - 1, Math.floor((ts - startTs) / bucketWidth));
  return b < 0 ? 0 : b;
}

const classBuckets = new Map(); // key -> { total, totalSize, perBucket: number[BUCKETS] }
let totalSelf = 0;
let detached = 0;

for (let i = 0; i < nodeCount; i++) {
  const o = i * NF;
  const t = types[nodes[o + T]];
  const name = strings[nodes[o + N]];
  const id = nodes[o + ID];
  const self = nodes[o + S];
  const det = D >= 0 ? nodes[o + D] === 1 : false;
  totalSelf += self;
  if (det) detached++;
  const ts = allocTimeFor(id);
  const b = bucketOf(ts);
  const key = `${t}::${name}`;
  let entry = classBuckets.get(key);
  if (!entry) {
    entry = { total: 0, totalSize: 0, perBucket: new Array(BUCKETS).fill(0), perBucketSize: new Array(BUCKETS).fill(0) };
    classBuckets.set(key, entry);
  }
  entry.total++;
  entry.totalSize += self;
  entry.perBucket[b]++;
  entry.perBucketSize[b] += self;
}

console.log("\ntotal self_size:", (totalSelf / 1e6).toFixed(1), "MB  detached:", detached);

// A leak signature: many instances allocated AFTER the first 10% of recording.
// We compute: latePct = sum(buckets[2..19]) / total. If latePct is high AND total count is large, it's a leak suspect.
const ranked = [];
for (const [key, e] of classBuckets) {
  if (e.total < 50) continue;
  let early = 0;
  let late = 0;
  for (let b = 0; b < BUCKETS; b++) {
    if (b < 2) early += e.perBucket[b];
    else late += e.perBucket[b];
  }
  const latePct = late / e.total;
  ranked.push({ key, total: e.total, totalSize: e.totalSize, latePct, perBucket: e.perBucket });
}

// Sort by (lateCount * size) — the ones that grew most after startup with significant size
ranked.sort((a, b) => b.totalSize * b.latePct - a.totalSize * a.latePct);
console.log("\n=== TOP 20 LEAK SUSPECTS (large + allocated after startup) ===");
console.log("count\tlate%\tsize_KB\ttype::name");
ranked.slice(0, 20).forEach((r) => {
  console.log(
    `${r.total}\t${(r.latePct * 100).toFixed(0)}%\t${(r.totalSize / 1024).toFixed(1)}\t${r.key}`,
  );
});

// Also: classes with extreme late% (>80%) regardless of size — these are pure post-startup growth
const pureLate = ranked
  .filter((r) => r.latePct > 0.8 && r.total > 100)
  .sort((a, b) => b.total - a.total)
  .slice(0, 20);
console.log("\n=== PURE POST-STARTUP GROWTH (late% > 80%, count > 100) ===");
console.log("count\tlate%\tsize_KB\ttype::name");
pureLate.forEach((r) => {
  console.log(
    `${r.total}\t${(r.latePct * 100).toFixed(0)}%\t${(r.totalSize / 1024).toFixed(1)}\t${r.key}`,
  );
});

// Print a small ASCII histogram of the worst 6 suspects so the trend is visible
console.log("\n=== ALLOCATION HISTOGRAM (top 6 suspects by late-weighted size) ===");
console.log("Each row: 20 buckets evenly across recording, '#' = >0.5% of class total");
ranked.slice(0, 6).forEach((r) => {
  const max = Math.max(...r.perBucket);
  const bars = r.perBucket
    .map((v) => {
      const pct = v / r.total;
      if (pct < 0.005) return ".";
      if (pct < 0.02) return "·";
      if (pct < 0.05) return "▁";
      if (pct < 0.1) return "▂";
      if (pct < 0.2) return "▄";
      if (pct < 0.4) return "▆";
      return "█";
    })
    .join("");
  console.log(`${bars}  ${r.key} (n=${r.total}, late=${(r.latePct * 100).toFixed(0)}%)`);
});

// Detached DOM breakdown by allocation time
console.log("\n=== DETACHED DOM ALLOCATION TIMING ===");
const detTiming = new Map();
for (let i = 0; i < nodeCount; i++) {
  const o = i * NF;
  if (D < 0 || nodes[o + D] !== 1) continue;
  const name = strings[nodes[o + N]];
  const id = nodes[o + ID];
  const ts = allocTimeFor(id);
  const b = bucketOf(ts);
  let entry = detTiming.get(name);
  if (!entry) {
    entry = { total: 0, perBucket: new Array(BUCKETS).fill(0) };
    detTiming.set(name, entry);
  }
  entry.total++;
  entry.perBucket[b]++;
}
const sortedDet = [...detTiming.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 12);
sortedDet.forEach(([name, e]) => {
  const bars = e.perBucket
    .map((v) => (v === 0 ? "." : v < 3 ? "·" : v < 6 ? "▂" : v < 12 ? "▄" : "█"))
    .join("");
  console.log(`${bars}  ${name} (n=${e.total})`);
});
