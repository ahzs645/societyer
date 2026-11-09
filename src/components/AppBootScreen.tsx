/**
 * The single full-screen placeholder shown from first paint until the app
 * shell can render: loading the bundle, the auth client, completing an OAuth
 * hand-off, checking the session, workspace membership and deployment
 * capabilities. Every one of those steps draws this same screen, so signing in
 * reads as one calm wait instead of a run of blank pages and corner messages.
 *
 * `index.html` paints identical markup inside `#root` before any script runs,
 * and owns the styles (inline, so they apply before the stylesheet loads). Keep
 * the two in step.
 *
 * `label` is spoken to screen readers only; it may change between steps
 * without the screen visibly changing.
 */
export function AppBootScreen({ label = "Loading Societyer…" }: { label?: string }) {
  return (
    <div className="boot-screen" role="status" aria-live="polite" aria-busy="true">
      <svg className="boot-screen__mark" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false">
        <rect className="boot-screen__tile" width="32" height="32" rx="8" />
        <path
          className="boot-screen__glyph"
          d="M10 12c0-1.1.9-2 2-2h8c1.1 0 2 .9 2 2v2h-4v-1h-4v3h6c1.1 0 2 .9 2 2v4c0 1.1-.9 2-2 2h-8c-1.1 0-2-.9-2-2v-2h4v1h4v-3h-6c-1.1 0-2-.9-2-2v-4z"
        />
      </svg>
      <span className="boot-screen__spinner" aria-hidden="true" />
      <span className="boot-screen__label">{label}</span>
    </div>
  );
}
