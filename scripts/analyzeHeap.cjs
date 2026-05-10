/* eslint-disable */
// One-off heap snapshot inspector. Run: node scripts/analyzeHeap.js <path>
// Heap snapshot format reference:
// https://github.com/v8/v8/blob/main/include/v8-profiler.h (HeapSnapshotJSONSerializer)
const fs = require("fs");

const path = process.argv[2];
if (!path) {
  console.error("usage: node analyzeHeap.js <heapsnapshot>");
  process.exit(1);
}

console.log("reading", path);
const raw = fs.readFileSync(path, "utf8");
const snap = JSON.parse(raw);

const meta = snap.snapshot.meta;
const nodeFields = meta.node_fields;
const nodeTypes = meta.node_types[0];
const edgeFields = meta.edge_fields;
const edgeTypes = meta.edge_types[0];
const NF = nodeFields.length;
const EF = edgeFields.length;
const nodes = snap.nodes;
const edges = snap.edges;
const strings = snap.strings;

const fIdx = (arr, name) => arr.indexOf(name);
const NF_TYPE = fIdx(nodeFields, "type");
const NF_NAME = fIdx(nodeFields, "name");
const NF_ID = fIdx(nodeFields, "id");
const NF_SELF = fIdx(nodeFields, "self_size");
const NF_EDGE_COUNT = fIdx(nodeFields, "edge_count");
const NF_DETACHED = fIdx(nodeFields, "detachedness"); // 0 attached, 1 detached, 2 unknown
const EF_TYPE = fIdx(edgeFields, "type");
const EF_NAME_OR_INDEX = fIdx(edgeFields, "name_or_index");
const EF_TO_NODE = fIdx(edgeFields, "to_node");

const nodeCount = nodes.length / NF;
console.log("nodes:", nodeCount.toLocaleString());
console.log("edges:", (edges.length / EF).toLocaleString());
console.log("strings:", strings.length.toLocaleString());

const getNode = (i) => {
  const o = i * NF;
  return {
    type: nodeTypes[nodes[o + NF_TYPE]],
    name: strings[nodes[o + NF_NAME]],
    id: nodes[o + NF_ID],
    self: nodes[o + NF_SELF],
    edgeCount: nodes[o + NF_EDGE_COUNT],
    detached: NF_DETACHED >= 0 ? nodes[o + NF_DETACHED] : 0,
  };
};

// Aggregate self_size by (type, name) so we can see big classes
const buckets = new Map();
let totalSelf = 0;
let detachedCount = 0;
let detachedSelf = 0;
for (let i = 0; i < nodeCount; i++) {
  const n = getNode(i);
  totalSelf += n.self;
  if (n.detached === 1) {
    detachedCount++;
    detachedSelf += n.self;
  }
  const key = `${n.type}::${n.name}`;
  const b = buckets.get(key) ?? { count: 0, self: 0 };
  b.count++;
  b.self += n.self;
  buckets.set(key, b);
}

console.log("\ntotal self_size:", (totalSelf / 1e6).toFixed(1), "MB");
console.log("detached DOM nodes:", detachedCount, " self:", (detachedSelf / 1e6).toFixed(2), "MB");

// Top 30 buckets by self_size
const sortedBySelf = [...buckets.entries()]
  .sort((a, b) => b[1].self - a[1].self)
  .slice(0, 30);

console.log("\n=== TOP 30 (type::name) BY TOTAL SELF SIZE ===");
console.log("count\tself_MB\ttype::name");
for (const [key, b] of sortedBySelf) {
  console.log(`${b.count}\t${(b.self / 1e6).toFixed(2)}\t${key}`);
}

// Top 30 by count (mass-instances)
const sortedByCount = [...buckets.entries()]
  .filter(([, b]) => b.count > 50)
  .sort((a, b) => b[1].count - a[1].count)
  .slice(0, 30);

console.log("\n=== TOP 30 BY INSTANCE COUNT (>50) ===");
console.log("count\tself_MB\ttype::name");
for (const [key, b] of sortedByCount) {
  console.log(`${b.count}\t${(b.self / 1e6).toFixed(2)}\t${key}`);
}

// Look at top 30 individual nodes by self_size
const indices = Array.from({ length: nodeCount }, (_, i) => i);
indices.sort((a, b) => nodes[b * NF + NF_SELF] - nodes[a * NF + NF_SELF]);

console.log("\n=== TOP 25 INDIVIDUAL NODES BY SELF SIZE ===");
console.log("self_MB\ttype\tname  (id)");
for (let i = 0; i < 25; i++) {
  const n = getNode(indices[i]);
  console.log(`${(n.self / 1e6).toFixed(2)}\t${n.type}\t${n.name}\t(${n.id})`);
}

// Detached DOM breakdown
if (detachedCount > 0) {
  const det = new Map();
  for (let i = 0; i < nodeCount; i++) {
    const o = i * NF;
    if (NF_DETACHED >= 0 && nodes[o + NF_DETACHED] === 1) {
      const name = strings[nodes[o + NF_NAME]];
      const cur = det.get(name) ?? 0;
      det.set(name, cur + 1);
    }
  }
  const sortedDet = [...det.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log("\n=== DETACHED DOM BY NAME (top 20) ===");
  for (const [n, c] of sortedDet) console.log(`${c}\t${n}`);
}

// Find arrays/strings with unusually large self_size (>100KB)
console.log("\n=== INDIVIDUAL NODES > 200KB ===");
console.log("self_MB\ttype\tname  (id)");
let bigCount = 0;
for (let i = 0; i < nodeCount && bigCount < 40; i++) {
  const o = i * NF;
  const self = nodes[o + NF_SELF];
  if (self > 200_000) {
    const n = getNode(i);
    console.log(`${(self / 1e6).toFixed(2)}\t${n.type}\t${n.name}\t(${n.id})`);
    bigCount++;
  }
}
