/** Shared scanner for the browser sweep and its non-browser regression gate. */
export type WorkspaceKey = "bc-corp" | "cbca-corp" | "obca-corp" | "custom" | "bc-society" | "bc-demo" | "cbca-demo" | "obca-demo";
export type CopyWorkspace = { key: WorkspaceKey; name: string; society: boolean; bc: boolean };
export type CopyContext = "privacy-summary";

type PatternKey =
  | "societies-act"
  | "societies-online"
  | "bc-soc"
  | "societies-section"
  | "society"
  | "members"
  | "agm"
  | "bylaws"
  | "constitution"
  | "pipa"
  | "charity-toggle";

type Pattern = {
  key: PatternKey;
  regex: RegExp;
  /** Skip the match when the surrounding line also matches this. */
  unless?: RegExp;
  applies?: (workspace: CopyWorkspace) => boolean;
  /** Only applied to the checkbox/switch label channel. */
  toggleOnly?: boolean;
};

const PATTERNS: Pattern[] = [
  { key: "societies-act", regex: /Societies Act/g },
  { key: "societies-online", regex: /Societies Online/g },
  { key: "bc-soc", regex: /BC-SOC-/g },
  { key: "societies-section", regex: /Societies[^\n]{0,40}?\bs\.\s?\d+|\bs\.\s?\d+[^\n]{0,40}?Societies/g },
  { key: "society", regex: /\bsociety\b/gi },
  // "members" as voters/owners; board/committee/team membership is fine.
  { key: "members", regex: /(?<!\b(?:board|committee|team|staff|family|council|panel|crew|commission)\s)\bmembers?\b/gi, unless: /\b(?:board|committee|team|staff) members?\b/i },
  { key: "agm", regex: /\bAGMs?\b|annual general meeting/gi },
  // A BC company has articles only, so any by-law wording is a leak there.
  // Federal, Ontario and other corporations do have by-laws (hyphenated, the
  // statutory spelling); only the society spelling "bylaws" is flagged.
  { key: "bylaws", regex: /\bby-?laws?\b/gi, unless: /articles/i, applies: (workspace) => workspace.bc },
  { key: "bylaws", regex: /\bbylaws?\b/gi, unless: /articles/i, applies: (workspace) => !workspace.bc },
  { key: "constitution", regex: /\bconstitution(?:s|al)?\b/gi },
  { key: "pipa", regex: /\bPIPA\b/g, applies: (workspace) => !workspace.bc },
  { key: "charity-toggle", regex: /charit(?:y|ies|able)/gi, toggleOnly: true, applies: (workspace) => !workspace.society },
];

export type Channel = "main" | "chrome" | "sidebar" | "popover" | "toggle" | "title";
export type Finding = {
  workspace: WorkspaceKey;
  route: string;
  channel: Channel;
  pattern: PatternKey;
  match: string;
  snippet: string;
  inNav: boolean;
  context?: CopyContext;
};

const normalise = (text: string) => text.replace(/[ \t ]+/g, " ").replace(/\n{2,}/g, "\n");

export function scan(workspace: CopyWorkspace, route: string, channel: Channel, rawText: string, inNav: boolean, context?: CopyContext): Finding[] {
  // A law label and its status badge form one summary even when innerText puts
  // them on separate lines. Other page text keeps its original line boundaries.
  const source = context === "privacy-summary" ? rawText.replace(/\s+/g, " ").trim() : rawText;
  const text = normalise(source.split(workspace.name).join("‹workspace›"));
  const findings: Finding[] = [];
  for (const pattern of PATTERNS) {
    if (pattern.applies && !pattern.applies(workspace)) continue;
    if (pattern.toggleOnly !== (channel === "toggle")) {
      if (pattern.toggleOnly || channel === "toggle") continue;
    }
    for (const match of text.matchAll(pattern.regex)) {
      const index = match.index ?? 0;
      const lineStart = text.lastIndexOf("\n", index) + 1;
      const lineEndRaw = text.indexOf("\n", index);
      const line = text.slice(lineStart, lineEndRaw === -1 ? undefined : lineEndRaw);
      if (pattern.unless && pattern.unless.test(line)) continue;
      const start = Math.max(lineStart, index - 70);
      const end = Math.min(lineEndRaw === -1 ? text.length : lineEndRaw, index + match[0].length + 70);
      const snippet = `${start > lineStart ? "…" : ""}${text.slice(start, end).trim()}${end < (lineEndRaw === -1 ? text.length : lineEndRaw) ? "…" : ""}`;
      findings.push({ workspace: workspace.key, route, channel, pattern: pattern.key, match: match[0], snippet, inNav, ...(context ? { context } : {}) });
    }
  }
  return findings;
}

export type AllowEntry = {
  pattern: PatternKey | "*";
  /** Exact route, "*" for any, or a route prefix ending in "*". */
  route?: string;
  workspaces?: WorkspaceKey[];
  channel?: Channel;
  context?: CopyContext;
  /** Regex (source) tested against the snippet. */
  snippet: string;
  reason: string;
};
export type AllowList = { allow: AllowEntry[]; knownLeaks: string[] };

const routeMatches = (rule: string | undefined, route: string) =>
  !rule || rule === "*" || (rule.endsWith("*") ? route.startsWith(rule.slice(0, -1)) : rule === route);

export function isAllowed(finding: Finding, allow: AllowEntry[]): AllowEntry | undefined {
  return allow.find(
    (entry) =>
      (entry.pattern === "*" || entry.pattern === finding.pattern) &&
      routeMatches(entry.route, finding.route) &&
      (!entry.workspaces || entry.workspaces.includes(finding.workspace)) &&
      (!entry.channel || entry.channel === finding.channel) &&
      (!entry.context || entry.context === finding.context) &&
      new RegExp(entry.snippet, "i").test(finding.snippet),
  );
}

/**
 * Separate verified closed, conditional privacy summaries from bulk rendered
 * text without touching the live DOM or reading text from a detached clone.
 *
 * The caller captures each summary's innerText inside the privacy assessment.
 * Only an exact, unambiguous whole-line span is extracted. If the status changes,
 * a duplicate makes its location ambiguous, or the rendered texts differ, leave
 * it in the main scan so the normal checks fail rather than hide a possible leak.
 */
export function partitionPrivacySummaryText(main: string, rawSummaries: readonly string[]) {
  const spans: Array<{ start: number; end: number; text: string }> = [];
  for (const captured of rawSummaries) {
    const text = captured.trim();
    if (!/^(?:BC|Alberta) PIPA Conditional$/.test(text.replace(/\s+/g, " "))) continue;
    const start = main.indexOf(text);
    if (start < 0 || main.indexOf(text, start + text.length) !== -1) continue;
    const end = start + text.length;
    const lineStart = main.lastIndexOf("\n", start - 1) + 1;
    const nextLine = main.indexOf("\n", end);
    const lineEnd = nextLine === -1 ? main.length : nextLine;
    if (main.slice(lineStart, start).trim() || main.slice(end, lineEnd).trim()) continue;
    if (spans.some((span) => span.start < end && start < span.end)) continue;
    spans.push({ start, end, text });
  }
  spans.sort((a, b) => a.start - b.start);
  let remaining = main;
  for (const span of [...spans].reverse()) {
    remaining = remaining.slice(0, span.start) + "\n" + remaining.slice(span.end);
  }
  return { main: remaining, privacySummaries: spans.map((span) => span.text) };
}
