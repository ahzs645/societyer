import { useEffect, useState } from "react";
import { ArtifactUnavailableError, loadReviewArtifact, type LoadedReviewArtifact } from "./artifact";
import { REVIEW_ARTIFACT_PIN } from "./artifactPin";

export type ReviewArtifactState =
  | { status: "not-installed" }
  | { status: "loading" }
  | { status: "unavailable"; message: string }
  | { status: "ready"; loaded: LoadedReviewArtifact };

/** The pinned review plugin bundle, loaded once per page session. */
export function useReviewArtifact(enabled: boolean): ReviewArtifactState {
  const [state, setState] = useState<ReviewArtifactState>(() => (REVIEW_ARTIFACT_PIN ? { status: "loading" } : { status: "not-installed" }));
  useEffect(() => {
    if (!enabled || !REVIEW_ARTIFACT_PIN) return;
    let cancelled = false;
    loadReviewArtifact(REVIEW_ARTIFACT_PIN, import.meta.env.BASE_URL).then(
      (loaded) => { if (!cancelled) setState({ status: "ready", loaded }); },
      (error: unknown) => {
        if (cancelled) return;
        setState({ status: "unavailable", message: error instanceof ArtifactUnavailableError ? error.message : "The review plugin bundle failed to load." });
      },
    );
    return () => { cancelled = true; };
  }, [enabled]);
  return state;
}
