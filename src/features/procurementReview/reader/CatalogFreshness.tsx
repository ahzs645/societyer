/**
 * The catalog's one status control beside the page title: how fresh it is,
 * what it is, and what can be done with it, so the title's row holds nothing
 * else and stays on one line even beside an open side panel.
 *
 * Its icon's colour and shape change with age: a check while the catalog is
 * current, a clock once it is a day or two old, a warning once Zoer seems to
 * have stopped publishing. Unverified sources count as at least "a little
 * behind". Hovering shows the short answer ("A little behind · updated
 * 10 h ago"); a click or tap opens the rest: when it was updated and what
 * that means, the catalog's details (`details`, what used to sit behind the
 * title's ⓘ) and its actions (`actions`: refresh, source settings).
 */
import { useCallback, useRef, useState, type ReactNode } from "react";
import { CircleCheck, Clock, TriangleAlert } from "lucide-react";
import { Tooltip } from "../../../components/Tooltip";
import { ViewportPopover } from "../../../components/ViewportPopover";
import { useProcurementClock } from "../lib/clock";
import { exactWhen } from "./summary";

export type Freshness = "fresh" | "aging" | "stale";

/** Zoer publishes daily; a run that is a few hours late is still current. */
const FRESH_FOR = 26 * 60 * 60 * 1000;
/** After this the catalog has missed a few runs and may be missing new notices. */
const STALE_AFTER = 72 * 60 * 60 * 1000;

export function freshnessOf(publishedAt: string, now: number, unverified = false): Freshness | null {
  const at = new Date(publishedAt).getTime();
  if (Number.isNaN(at)) return null;
  const age = now - at;
  if (age > STALE_AFTER) return "stale";
  if (age > FRESH_FOR || unverified) return "aging";
  return "fresh";
}

/** "just now", "40 min ago", "7 h ago", "yesterday", "27 days ago": the catalog's age, always relative. */
function ageOf(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  const days = Math.floor(minutes / (24 * 60));
  return days === 1 ? "yesterday" : `${days} days ago`;
}

const ICONS = { fresh: CircleCheck, aging: Clock, stale: TriangleAlert };
const STATE: Record<Freshness, string> = {
  fresh: "Up to date",
  aging: "A little behind",
  stale: "Out of date",
};
const HELP: Record<Freshness, string> = {
  fresh: "Zoer published this catalog within the last day.",
  aging: "The catalog is a day or two old, so the newest notices may not be here yet.",
  stale: "Zoer hasn't published for several days. New notices and changes are missing until it does.",
};

/** Something to do with the catalog, listed at the foot of the status popover. */
export type CatalogAction = { label: string; icon?: ReactNode; onSelect: () => void; disabled?: boolean };

export function CatalogFreshness({
  publishedAt,
  readOnly = false,
  unverified = false,
  details: about,
  actions = [],
}: {
  publishedAt: string;
  /** Says so in the details, for someone who can't record a triage here. */
  readOnly?: boolean;
  /** Some sources couldn't be verified in this publication. */
  unverified?: boolean;
  /** What the catalog is and when it was collected, published and imported. */
  details?: ReactNode;
  /** Refresh, source settings and the like; each closes the popover when chosen. */
  actions?: CatalogAction[];
}) {
  const now = useProcurementClock();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const freshness = freshnessOf(publishedAt, now, unverified);
  if (!freshness) return null;
  const Icon = ICONS[freshness];
  const since = ageOf(new Date(publishedAt).getTime(), now);
  const label = `${STATE[freshness]}: catalog updated ${since}`;
  const summary = `${STATE[freshness]} · updated ${since}`;
  return (
    <>
      <Tooltip content={summary} disabled={open} delay={200} placement="bottom">
        <button
          ref={anchor}
          type="button"
          className={`procurement-freshness procurement-freshness--${freshness}`}
          aria-label={label}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((value) => !value)}
        >
          <Icon size={15} aria-hidden="true" />
        </button>
      </Tooltip>
      <ViewportPopover open={open} onClose={close} anchorRef={anchor} label="Catalog status" className="info-popover procurement-freshness__popover">
        <div className="procurement-freshness__details">
          <strong className={`procurement-freshness__state procurement-freshness__state--${freshness}`}>
            <Icon size={14} aria-hidden="true" /> {STATE[freshness]}
          </strong>
          <span>Updated {exactWhen(publishedAt)} ({since})</span>
          <span className="procurement-freshness__help">{HELP[freshness]}</span>
          {unverified && <span className="procurement-freshness__help">Some sources in this publication couldn't be verified.</span>}
          {readOnly && <span className="procurement-freshness__help">Read only: you can't record a triage here.</span>}
        </div>
        {about && <div className="procurement-freshness__about">{about}</div>}
        {actions.length > 0 && (
          <div className="procurement-freshness__actions">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                className="btn btn--sm"
                disabled={action.disabled}
                onClick={() => { close(); action.onSelect(); }}
              >
                {action.icon}
                {action.label}
              </button>
            ))}
          </div>
        )}
      </ViewportPopover>
    </>
  );
}
