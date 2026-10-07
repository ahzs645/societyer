import { Component, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, RefreshCw } from "lucide-react";

type Props = {
  children: ReactNode;
  /** When it changes (another page or organization), the boundary clears its error. */
  resetKey?: unknown;
  /** "page" fills the work area; "inline" fits inside a card. */
  variant?: "page" | "inline";
  /** What failed to load, e.g. "this page" or "linked people". */
  subject?: string;
};

type State = { error: Error | null; attempt: number };

/** A readable sentence for a failed query or render. */
export function readableError(error: Error): string {
  const message = String(error?.message ?? "").replace(/^\[[^\]]+\]\s*/, "").replace(/^(Uncaught )?(Convex)?Error:\s*/i, "").trim();
  if (/not found|does not exist/i.test(message)) return "The record could not be found. It may have been deleted, or it belongs to another organization.";
  if (/access denied|permission|forbidden|not part of this society|membership not found/i.test(message)) return "Your role in this organization cannot open it.";
  return message ? `It stopped with: ${message.slice(0, 240)}` : "It stopped with an unexpected error.";
}

/**
 * Error boundary for a page (or a panel inside one). A failed query — local
 * queries rethrow like hosted Convex (P-O2) — or a render error shows what
 * failed and a Retry that mounts the content again (which re-runs its
 * queries), instead of "Loading…" forever or a blank shell.
 */
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error(`[PageErrorBoundary${this.props.subject ? `:${this.props.subject}` : ""}]`, error, info?.componentStack);
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  private retry = () => this.setState((state) => ({ error: null, attempt: state.attempt + 1 }));

  render() {
    const { error, attempt } = this.state;
    if (!error) return <ErrorBoundaryContent key={attempt}>{this.props.children}</ErrorBoundaryContent>;
    const subject = this.props.subject ?? "this page";
    if (this.props.variant === "inline") {
      return (
        <div className="card__body page-error page-error--inline" role="alert">
          <p style={{ margin: 0 }}><strong>Couldn't load {subject}.</strong> {readableError(error)}</p>
          <button type="button" className="btn btn--sm" onClick={this.retry} style={{ marginTop: 8 }}>
            <RefreshCw size={12} aria-hidden="true" /> Retry
          </button>
        </div>
      );
    }
    return (
      <div className="page page-error" role="alert">
        <section className="card">
          <div className="card__body">
            <h1 style={{ marginTop: 0, display: "flex", alignItems: "center", gap: 8 }}>
              <AlertTriangle size={18} aria-hidden="true" /> Couldn't load {subject}
            </h1>
            <p>{readableError(error)}</p>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn--accent" onClick={this.retry}>
                <RefreshCw size={12} aria-hidden="true" /> Retry
              </button>
              <Link className="btn" to="/app">Back to dashboard</Link>
            </div>
          </div>
        </section>
      </div>
    );
  }
}

function ErrorBoundaryContent({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
