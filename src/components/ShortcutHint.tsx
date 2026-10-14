import { Fragment } from "react";
import {
  SHORTCUTS,
  formatShortcut,
  formatShortcutKey,
  isApplePlatform,
  type Shortcut,
  type ShortcutId,
} from "../lib/shortcutsRegistry";

type ShortcutHintProps = {
  /** A named shortcut from the registry… */
  id?: ShortcutId;
  /** …or explicit key tokens ("Mod", "Shift", "Alt", "K", …). */
  keys?: string[];
  /** Keys are pressed one after another ("G then D"). */
  sequence?: boolean;
  /** `inverse` reads on dark tooltip surfaces. */
  tone?: "default" | "inverse";
  className?: string;
};

/**
 * Platform-aware keyboard hint: ⌘ on Apple platforms, Ctrl elsewhere. Use it
 * inside tooltips and menu rows — e.g. `<Tooltip content={<>Search <ShortcutHint id="commandPalette" /></>}>`.
 * The chips are decorative; the text form is exposed to assistive tech.
 */
export function ShortcutHint({ id, keys, sequence, tone = "default", className }: ShortcutHintProps) {
  const shortcut: Pick<Shortcut, "keys" | "sequence"> | null = id
    ? SHORTCUTS[id]
    : keys
      ? { keys, sequence }
      : null;
  if (!shortcut) return null;
  const apple = isApplePlatform();
  const classes = ["shortcut-hint", tone === "inverse" ? "shortcut-hint--inverse" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes}>
      <span className="sr-only">{formatShortcut(shortcut, apple)}</span>
      <span className="shortcut-hint__keys" aria-hidden="true">
        {shortcut.keys.map((key, index) => (
          <Fragment key={`${key}-${index}`}>
            {index > 0 && shortcut.sequence && <span className="shortcut-hint__then">then</span>}
            <kbd className="shortcut-hint__key">{formatShortcutKey(key, apple)}</kbd>
          </Fragment>
        ))}
      </span>
    </span>
  );
}

/** Text form of a named shortcut for `title`/`aria-keyshortcuts`-style strings. */
export function shortcutText(id: ShortcutId): string {
  return formatShortcut(SHORTCUTS[id]);
}
