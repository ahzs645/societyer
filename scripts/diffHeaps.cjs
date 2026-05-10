/* eslint-disable */
// Compare two V8 heap snapshots and report what GREW between them.
// Run: node scripts/diffHeaps.cjs <before.heapsnapshot> <after.heapsnapshot>
const fs = require("fs");

const [, , beforePath, afterPath] = process.argv;
if (!beforePath || !afterPath) {
  console.error("usage: node scripts/diffHeaps.cjs <before> <after>");
  process.exit(1);
}

function load(path) {
  const snap = JSON.parse(fs.readFileSync(path, "utf8"));
  const meta = snap.snapshot.meta;
  const NF = meta.node_fields;
  const types = meta.node_types[0];
  const T = NF.indexOf("type");
  const N = NF.indexOf("name");
  const S = NF.indexOf("self_size");
  const D = NF.indexOf("detachedness");
  const stride = NF.length;
  const nodes = snap.nodes;
  const strings = snap.strings;

  const buckets = new Map();
  let totalSelf = 0;
  let detached = 0;
  let detachedSelf = 0;

  for (let i = 0; i < nodes.length; i += stride) {
    const t = types[nodes[i + T]];
    const name = strings[nodes[i + N]];
    const self = nodes[i + S];
    const det = D >= 0 ? nodes[i + D] === 1 : false;
    totalSelf += self;
    if (det) {
      detached++;
      detachedSelf += self;
    }
    const key = `${t}::${name}`;
    const b = buckets.get(key) ?? { count: 0, self: 0 };
    b.count++;
    b.self += self;
    buckets.set(key, b);
  }

  return { buckets, totalSelf, detached, detachedSelf, path };
}

console.log("loading", beforePath);
const A = load(beforePath);
console.log("loading", afterPath);
const B = load(afterPath);

console.log(`\nbefore: total=${(A.totalSelf / 1e6).toFixed(1)}MB  detached=${A.detached}  detachedSelf=${(A.detachedSelf / 1e6).toFixed(2)}MB`);
console.log(`after:  total=${(B.totalSelf / 1e6).toFixed(1)}MB  detached=${B.detached}  detachedSelf=${(B.detachedSelf / 1e6).toFixed(2)}MB`);
console.log(`growth: total=+${((B.totalSelf - A.totalSelf) / 1e6).toFixed(1)}MB  detached=+${B.detached - A.detached}`);

// Compute deltas
const keys = new Set([...A.buckets.keys(), ...B.buckets.keys()]);
const deltas = [];
for (const key of keys) {
  const a = A.buckets.get(key) ?? { count: 0, self: 0 };
  const b = B.buckets.get(key) ?? { count: 0, self: 0 };
  deltas.push({
    key,
    countA: a.count,
    countB: b.count,
    countDelta: b.count - a.count,
    selfA: a.self,
    selfB: b.self,
    selfDelta: b.self - a.self,
  });
}

// Top 30 by self_size growth (positive only)
console.log("\n=== TOP 30 BUCKETS BY SELF-SIZE GROWTH ===");
console.log("Δ_self_KB\tcount(A→B)\tΔcount\ttype::name");
deltas
  .filter((d) => d.selfDelta > 1024)
  .sort((a, b) => b.selfDelta - a.selfDelta)
  .slice(0, 30)
  .forEach((d) => {
    console.log(
      `+${(d.selfDelta / 1024).toFixed(1)}\t${d.countA}→${d.countB}\t+${d.countDelta}\t${d.key}`,
    );
  });

// Top 30 by instance-count growth (positive only)
console.log("\n=== TOP 30 BUCKETS BY INSTANCE-COUNT GROWTH ===");
console.log("Δcount\tcount(A→B)\tΔ_self_KB\ttype::name");
deltas
  .filter((d) => d.countDelta > 5)
  .sort((a, b) => b.countDelta - a.countDelta)
  .slice(0, 30)
  .forEach((d) => {
    console.log(
      `+${d.countDelta}\t${d.countA}→${d.countB}\t+${(d.selfDelta / 1024).toFixed(1)}\t${d.key}`,
    );
  });
