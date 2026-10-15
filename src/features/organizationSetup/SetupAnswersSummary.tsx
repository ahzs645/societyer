/**
 * Guided setup saves its collapsed "governance notes" defaults even when the
 * founder never opened that section, and the stored answers can't tell them
 * apart. Those default lines say nothing the founder told us, so leave them out.
 */
const UNTOUCHED_DEFAULTS = new Set([
  "Share classes: not decided yet",
  "Membership classes: not decided yet",
  "Documents: you need to find or check them",
  "People: you'll add them later",
]);

export function givenSetupAnswers(answers?: string[]): string[] {
  return (answers ?? []).filter((line) => !UNTOUCHED_DEFAULTS.has(line));
}

/** The answers saved when the workspace was created, in plain language. */
export function SetupAnswersSummary({ answers, defaultOpen = false }: { answers?: string[]; defaultOpen?: boolean }) {
  const lines = givenSetupAnswers(answers);
  if (!lines.length) return null;
  return (
    <details className="setup-answers" open={defaultOpen || undefined}>
      <summary className="setup-answers__summary">What you told us when you set up</summary>
      <ul className="setup-answers__list">
        {lines.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <p className="setup-answers__footer">
        These are the answers you gave when you created the workspace. Check them against your documents.
      </p>
    </details>
  );
}
