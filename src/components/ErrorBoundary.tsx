import { Component, ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Render this when the subtree throws. Default: nothing (subtree silently disappears). */
  fallback?: ReactNode;
  /** Reset key — when it changes, the boundary clears its error state and re-renders the subtree. */
  resetKey?: unknown;
  /** Tag for console output, so multiple boundaries are distinguishable. */
  label?: string;
};

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ""}]`, error, info.componentStack);
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) return this.props.fallback ?? null;
    return this.props.children;
  }
}
