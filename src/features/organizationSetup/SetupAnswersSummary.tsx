/** The answers saved when the workspace was created, in plain language. */
export function SetupAnswersSummary({ answers, defaultOpen = false }: { answers?: string[]; defaultOpen?: boolean }) {
  if (!answers?.length) return null;
  return (
    <details className="setup-answers" open={defaultOpen || undefined}>
      <summary className="setup-answers__summary">What you told us when you set up</summary>
      <ul className="setup-answers__list">
        {answers.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <p className="setup-answers__footer">
        These are the answers you gave when you created the workspace. Check them against your documents.
      </p>
    </details>
  );
}
