/** Stage 3: duplicate and version clustering (deterministic). Exact content
 * hashes never group empty or failed downloads (the e3b0c442… bug); near
 * duplicates use SimHash over word shingles; versions come from normalised
 * file names with draft/final/approved/copy markers stripped. */
import { isUsableContentHash } from "./junk";

export type ClusterRelation = "canonical" | "identical" | "format-copy" | "near-duplicate" | "draft-of" | "approved-of" | "version-of" | "package-embedded";
export type ClusterInput = { id: string; name: string; path?: string; sha256?: string; text?: string; sizeBytes?: number; modifiedTime?: string };
export type ClusterMember = { fileId: string; relation: ClusterRelation; score?: number; reason: string };
export type IntakeCluster = { clusterKey: string; canonicalId: string; members: ClusterMember[]; method: string };

const MARKERS = /\b(?:draft|final|approved|signed|copy|revised|rev|updated|amended|clean|redline|tracked|v\d+(?:\.\d+)?|version\s*\d+|\(\d+\)|\d+)\b/gi;
export function versionMarker(name: string): "draft" | "approved" | "final" | "signed" | "copy" | null {
  const base = name.replace(/[_\-.]+/g, " ");
  if (/\bsigned\b/i.test(base)) return "signed";
  if (/\bapproved\b/i.test(base)) return "approved";
  if (/\bdraft\b/i.test(base)) return "draft";
  if (/\bfinal\b/i.test(base)) return "final";
  if (/\bcopy\b|\(\d+\)/i.test(base)) return "copy";
  return null;
}

/** File name with extension, version markers, separators and copy suffixes removed. */
export function normalizedStem(name: string): string {
  return name
    .replace(/\.[a-z0-9]{1,6}$/i, "")
    .replace(/^(?:item\s*\d+(?:\.\d+)*[\s_.-]+)/i, "")
    .replace(/\(\d+\)/g, " ")
    .replace(/[_\-.]+/g, " ")
    .replace(MARKERS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const MONTH_TOKEN = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*$/;
/** The dates a file name carries ("2013_05_14", "23-Feb-2016", "May 2013"): two names that
 * differ only by version markers but carry different dates are different documents (the
 * minutes of two meetings), never versions of one. Copy counters and version numbers are ignored. */
export function nameDateSignature(name: string): string {
  const tokens = name
    .replace(/\.[a-z0-9]{1,6}$/i, "")
    .replace(/\(\d+\)|\bv(?:ersion)?\s*\d+(?:\.\d+)?\b|\brev\s*\d+\b/gi, " ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return tokens.filter((token) => /^\d{1,4}$/.test(token) || MONTH_TOKEN.test(token)).map((token) => (/^\d+$/.test(token) ? String(Number(token)) : token.slice(0, 3))).join(" ");
}

function fnv1a(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

export function shingles(text: string, size = 3): string[] {
  const words = text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let index = 0; index + size <= words.length; index++) out.push(words.slice(index, index + size).join(" "));
  return out;
}

/** 64-bit SimHash as two 32-bit halves. */
export function simhash(text: string): [number, number] {
  const weights = new Array(64).fill(0);
  for (const shingle of shingles(text)) {
    const halves = [fnv1a(shingle, 2166136261), fnv1a(shingle, 16777619)];
    for (let bit = 0; bit < 64; bit++) weights[bit] += (halves[bit >> 5] >>> (bit & 31)) & 1 ? 1 : -1;
  }
  const out: [number, number] = [0, 0];
  for (let bit = 0; bit < 64; bit++) if (weights[bit] > 0) out[bit >> 5] |= 1 << (bit & 31);
  return [out[0] >>> 0, out[1] >>> 0];
}

function popcount(value: number): number {
  let v = value >>> 0, count = 0;
  while (v) {
    v &= v - 1;
    count++;
  }
  return count;
}
export function hamming(a: [number, number], b: [number, number]): number {
  return popcount(a[0] ^ b[0]) + popcount(a[1] ^ b[1]);
}

/** Share of the smaller document's shingles found in the larger one. */
export function containment(small: string, large: string): number {
  const a = new Set(shingles(small));
  if (!a.size) return 0;
  const b = new Set(shingles(large));
  let hit = 0;
  for (const shingle of a) if (b.has(shingle)) hit++;
  return hit / a.size;
}

const MARKER_RANK: Record<string, number> = { signed: 5, approved: 4, final: 3, none: 2, draft: 1, copy: 0 };

function canonicalOf(members: ClusterInput[]): ClusterInput {
  return [...members].sort((a, b) => {
    const rank = (MARKER_RANK[versionMarker(b.name) ?? "none"] ?? 2) - (MARKER_RANK[versionMarker(a.name) ?? "none"] ?? 2);
    if (rank) return rank;
    const textLength = (b.text?.length ?? 0) - (a.text?.length ?? 0);
    if (Math.abs(textLength) > 200) return textLength;
    const pdfFirst = Number(/\.docx?$/i.test(b.name)) - Number(/\.docx?$/i.test(a.name));
    if (pdfFirst) return pdfFirst;
    return (a.path ?? a.name).localeCompare(b.path ?? b.name);
  })[0];
}

class UnionFind {
  parent = new Map<string, string>();
  find(id: string): string {
    let root = id;
    while (this.parent.get(root) && this.parent.get(root) !== root) root = this.parent.get(root)!;
    this.parent.set(id, root);
    return root;
  }
  union(a: string, b: string) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

export function clusterFiles(files: ClusterInput[], options: { nearDuplicateBits?: number; embeddedContainment?: number } = {}): IntakeCluster[] {
  const maxBits = options.nearDuplicateBits ?? 4;
  const uf = new UnionFind();
  const edges = new Map<string, { relation: ClusterRelation; score?: number; reason: string }>();
  const edgeKey = (a: string, b: string) => [a, b].sort().join("\u0000");
  const link = (a: string, b: string, relation: ClusterRelation, reason: string, score?: number) => {
    uf.union(a, b);
    const key = edgeKey(a, b);
    if (!edges.has(key)) edges.set(key, { relation, reason, score });
  };
  for (const file of files) uf.find(file.id);
  // 1. Exact bytes (never the empty hash).
  const byHash = new Map<string, ClusterInput[]>();
  for (const file of files) if (isUsableContentHash(file.sha256)) byHash.set(file.sha256!, [...(byHash.get(file.sha256!) ?? []), file]);
  for (const group of byHash.values()) for (const other of group.slice(1)) link(group[0].id, other.id, "identical", "Identical bytes (SHA-256)", 1);
  // 2. Near-identical text and format copies.
  const withText = files.filter((file) => (file.text ?? "").trim().length >= 200).map((file) => ({ file, hash: simhash(file.text!) }));
  for (let i = 0; i < withText.length; i++) {
    for (let j = i + 1; j < withText.length; j++) {
      const a = withText[i], b = withText[j];
      if (uf.find(a.file.id) === uf.find(b.file.id) && edges.has(edgeKey(a.file.id, b.file.id))) continue;
      const distance = hamming(a.hash, b.hash);
      if (distance > maxBits) continue;
      // Templated minutes of two meetings can be textually close; names dated differently are different documents.
      const datesA = nameDateSignature(a.file.name), datesB = nameDateSignature(b.file.name);
      if (datesA && datesB && datesA !== datesB) continue;
      const sameStem = normalizedStem(a.file.name) === normalizedStem(b.file.name);
      const differentFormat = a.file.name.replace(/^.*\./, "").toLowerCase() !== b.file.name.replace(/^.*\./, "").toLowerCase();
      link(a.file.id, b.file.id, differentFormat && sameStem ? "format-copy" : "near-duplicate", `Text SimHash distance ${distance}/64${differentFormat ? " across formats" : ""}`, 1 - distance / 64);
    }
  }
  // 3. Version families by normalised name.
  const byStem = new Map<string, ClusterInput[]>();
  for (const file of files) {
    const stem = normalizedStem(file.name);
    if (stem.length < 6) continue;
    const key = `${stem}|${nameDateSignature(file.name)}`;
    byStem.set(key, [...(byStem.get(key) ?? []), file]);
  }
  for (const group of byStem.values()) {
    if (group.length < 2) continue;
    for (const other of group.slice(1)) {
      if (edges.has(edgeKey(group[0].id, other.id))) continue;
      link(group[0].id, other.id, "version-of", "Same name after removing version markers");
    }
  }
  // 4. Documents embedded in a larger package (e.g. "Item 5.1 … Minutes" inside a board package).
  const threshold = options.embeddedContainment ?? 0.85;
  const shingleCache = new Map<string, Set<string>>();
  const shingleSet = (id: string, text: string) => {
    if (!shingleCache.has(id)) shingleCache.set(id, new Set(shingles(text)));
    return shingleCache.get(id)!;
  };
  const candidates = withText.filter(({ file }) => /minutes|agenda|report|policy|statement/i.test(file.name));
  const packages = withText.filter(({ file }) => /package|binder|book|consent agenda/i.test(file.name) && (file.text?.length ?? 0) > 4000);
  for (const pkg of packages) {
    for (const part of candidates) {
      if (part.file.id === pkg.file.id || (part.file.text?.length ?? 0) * 1.3 > (pkg.file.text?.length ?? 0)) continue;
      const small = shingleSet(part.file.id, part.file.text!), large = shingleSet(pkg.file.id, pkg.file.text!);
      let hit = 0;
      for (const shingle of small) if (large.has(shingle)) hit++;
      const score = small.size ? hit / small.size : 0;
      if (score >= threshold) link(part.file.id, pkg.file.id, "package-embedded", `${Math.round(score * 100)}% of its text appears inside the package`, score);
    }
  }
  // Assemble clusters with a canonical member and per-member relations.
  const groups = new Map<string, ClusterInput[]>();
  for (const file of files) groups.set(uf.find(file.id), [...(groups.get(uf.find(file.id)) ?? []), file]);
  const clusters: IntakeCluster[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const packageMembers = members.filter((member) => [...edges.entries()].some(([key, edge]) => edge.relation === "package-embedded" && key.split("\u0000").includes(member.id) && /package|binder|book|consent agenda/i.test(member.name)));
    const canonical = canonicalOf(members.filter((member) => !packageMembers.includes(member)).length ? members.filter((member) => !packageMembers.includes(member)) : members);
    const canonicalMarker = versionMarker(canonical.name);
    const out: ClusterMember[] = members.map((member) => {
      if (member.id === canonical.id) return { fileId: member.id, relation: "canonical", reason: "Preferred copy: approved/final marker, then most text, then Word source" };
      const edge = edges.get(edgeKey(member.id, canonical.id)) ?? [...edges.entries()].find(([key]) => key.split("\u0000").includes(member.id))?.[1];
      const marker = versionMarker(member.name);
      let relation: ClusterRelation = edge?.relation ?? "version-of";
      if (packageMembers.includes(member)) relation = "package-embedded";
      else if (relation === "version-of" || relation === "near-duplicate") {
        if (marker === "draft" && canonicalMarker !== "draft") relation = "draft-of";
        else if ((marker === "approved" || marker === "signed") && canonicalMarker === "draft") relation = "approved-of";
      }
      return { fileId: member.id, relation, ...(edge?.score !== undefined ? { score: edge.score } : {}), reason: edge?.reason ?? "Linked through another member of the cluster" };
    });
    clusters.push({ clusterKey: `cluster:${canonical.id}`, canonicalId: canonical.id, members: out, method: "sha256+simhash64+name-stem+containment" });
  }
  return clusters.sort((a, b) => a.clusterKey.localeCompare(b.clusterKey));
}
