/** Candidate n-grams plus exact verification preserve the platform's substring/reference search. */
export function foldProcurementText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"');
}
const compact = (value: string) => value.replace(/[^\p{L}\p{N}]+/gu, "");
export function procurementTerms(search: string) {
  const terms: { text: string; compact: string | null }[] = [];
  for (const match of foldProcurementText(search.trim()).matchAll(
    /"([^"]+)"|(\S+)/g,
  )) {
    const text = (match[1] ?? match[2].replace(/^"+|"+$/g, "")).trim();
    if (!text || terms.some((t) => t.text === text)) continue;
    const ref = /[\p{N}]|[^\p{L}\p{N}\s]/u.test(text) ? compact(text) : "";
    terms.push({ text, compact: ref.length >= 2 ? ref : null });
  }
  return terms;
}
export function procurementSearchMatches(text: string, search: string) {
  const folded = foldProcurementText(text);
  let joined: string | undefined;
  return procurementTerms(search).every(
    (term) =>
      folded.includes(term.text) ||
      (term.compact !== null &&
        (joined ??= compact(folded)).includes(term.compact)),
  );
}
const token = (text: string) =>
  "g" +
  [...new TextEncoder().encode(text)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
export function procurementGrams(text: string) {
  const folded = foldProcurementText(text),
    tokens = new Set<string>();
  for (const value of [folded, compact(folded)]) {
    const chars = [...value];
    for (let n = 1; n <= 3; n++)
      for (let i = 0; i + n <= chars.length; i++)
        tokens.add(token(chars.slice(i, i + n).join("")));
  }
  return [...tokens].sort().join(" ");
}
export function procurementCandidateQuery(search: string) {
  return [
    ...new Set(
      procurementTerms(search)
        .slice(0, 12)
        .map((term) =>
          token([...(term.compact ?? term.text)].slice(0, 3).join("")),
        ),
    ),
  ].join(" ");
}
export function procurementSearchCorpus(row: Record<string, unknown>) {
  return [
    row.title,
    row.organization,
    row.issuedFor,
    row.source,
    row.status,
    row.when,
    row.whenText,
    row.documents,
    row.supplier,
    row.value,
    row.currency,
    row.procurementType,
    row._searchText,
  ]
    .map((v) => String(v ?? ""))
    .join("\n");
}
export function procurementIndexCorpus(row: Record<string, unknown>) {
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const month = Number(String(row.when ?? "").slice(5, 7));
  return (
    procurementSearchCorpus(row) +
    "\n" +
    (row.status === "Open" ? "Closed" : "") +
    " " +
    (months[month - 1] ?? "")
  );
}
