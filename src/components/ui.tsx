import {
  Children,
  cloneElement,
  createElement,
  Fragment,
  isValidElement,
  ButtonHTMLAttributes,
  MouseEvent as ReactMouseEvent,
  ReactElement,
  ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronRight, X, AlertTriangle, CheckCircle2, Info, Lock, Unlock, type LucideIcon } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useConfirm } from "./Modal";
import { useInspectorPanel } from "./InspectorPanel";
import { CitationBadge } from "./CitationTooltip";
import { getRouteIdentity, resolveRouteIdentity, type IconTone } from "../lib/routeIdentity";

export type Breadcrumb = {
  label: ReactNode;
  to?: string;
};

/** 40px-tall page header with optional breadcrumb trail, title, and
 * right-side actions. Opt-in: pages render it at the top of their content
 * when they want the canonical "page chrome" row. */
export function PageHeader({
  breadcrumbs,
  title,
  meta,
  actions,
  className,
}: {
  breadcrumbs?: Breadcrumb[];
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const classes = ["page-header"];
  if (className) classes.push(className);
  return (
    <header className={classes.join(" ")}>
      <div className="page-header__main">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className="page-header__crumbs" aria-label="Breadcrumb">
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <Fragment key={index}>
                  {crumb.to && !isLast ? (
                    <Link to={crumb.to} className="page-header__crumb">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="page-header__crumb page-header__crumb--current">
                      {crumb.label}
                    </span>
                  )}
                  {!isLast && (
                    <ChevronRight
                      size={12}
                      aria-hidden="true"
                      className="page-header__crumb-sep"
                    />
                  )}
                </Fragment>
              );
            })}
          </nav>
        )}
        <div className="page-header__title-row">
          <h1 className="page-header__title">{title}</h1>
          {meta && <span className="page-header__meta">{meta}</span>}
        </div>
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  children,
  action,
  align = "center",
  size,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  /** Secondary line. Prefer over `children` for new call sites. */
  description?: ReactNode;
  /** Deprecated: kept for backward compatibility — renders in the description slot. */
  children?: ReactNode;
  action?: ReactNode;
  align?: "center" | "start";
  size?: "sm" | "lg";
  className?: string;
}) {
  const classes = ["empty-state"];
  if (align === "start") classes.push("empty-state--start");
  if (size) classes.push(`empty-state--${size}`);
  if (className) classes.push(className);
  const body = description ?? children;
  return (
    <div className={classes.join(" ")}>
      {icon && <div className="empty-state__icon">{icon}</div>}
      <div className="empty-state__title">{title}</div>
      {body && <div className="empty-state__description">{body}</div>}
      {action && <div className="empty-state__actions">{action}</div>}
    </div>
  );
}

export type ErrorSummaryItem = {
  fieldId?: string;
  label: string;
  message: string;
};

export function ErrorSummary({
  title = "Fix the following before continuing",
  errors,
}: {
  title?: string;
  errors: ErrorSummaryItem[];
}) {
  if (errors.length === 0) return null;

  return (
    <div className="error-summary" role="alert" tabIndex={-1}>
      <div className="error-summary__title">{title}</div>
      <ul className="error-summary__list">
        {errors.map((error) => (
          <li key={`${error.fieldId ?? error.label}-${error.message}`}>
            {error.fieldId ? (
              <a href={`#${error.fieldId}`}>
                <strong>{error.label}:</strong> {error.message}
              </a>
            ) : (
              <span>
                <strong>{error.label}:</strong> {error.message}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Semantic tones (success/warn/danger/info/accent) plus the full
 * palette-driven family tones Twenty uses for chips and tags. */
export type ToneVariant =
  | "neutral"
  | "success"
  | "warn"
  | "danger"
  | "info"
  | "accent"
  | "blue"
  | "red"
  | "turquoise"
  | "gray"
  | "orange"
  | "purple"
  | "green"
  | "pink"
  | "yellow";

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: ToneVariant;
  children: ReactNode;
}) {
  const klass = tone === "neutral" ? "badge" : `badge badge--${tone}`;
  return <span className={klass}>{children}</span>;
}

export function Pill({
  tone = "neutral",
  size = "md",
  className,
  children,
}: {
  tone?: ToneVariant;
  size?: "sm" | "md";
  className?: string;
  children: ReactNode;
}) {
  const classes = ["pill", `pill--${size}`];
  if (tone !== "neutral") classes.push(`pill--${tone}`);
  if (className) classes.push(className);
  return <span className={classes.join(" ")}>{children}</span>;
}

/** Twenty-style chip with leftComponent / rightComponent slots.
 * Uses the .badge CSS for its base look and extends it via tone/size/variant. */
export function Chip({
  tone = "neutral",
  size = "md",
  variant = "regular",
  clickable,
  leftComponent,
  rightComponent,
  onClick,
  children,
  className,
}: {
  tone?: ToneVariant;
  size?: "sm" | "md";
  variant?: "regular" | "rounded" | "transparent" | "highlighted" | "static";
  clickable?: boolean;
  leftComponent?: ReactNode;
  rightComponent?: ReactNode | (() => ReactNode);
  onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
  children: ReactNode;
  className?: string;
}) {
  const classes = ["chip", `chip--${variant}`, `chip--${size}`];
  if (tone !== "neutral") classes.push(`chip--tone-${tone}`);
  if (onClick || clickable) classes.push("chip--interactive");
  if (className) classes.push(className);
  const Tag: "button" | "span" = onClick ? "button" : "span";
  const renderedRightComponent =
    typeof rightComponent === "function" ? rightComponent() : rightComponent;
  return (
    <Tag
      type={onClick ? "button" : undefined}
      className={classes.join(" ")}
      onClick={onClick as any}
    >
      {leftComponent != null && <span className="chip__left">{leftComponent}</span>}
      <span className="chip__label">{children}</span>
      {renderedRightComponent != null && <span className="chip__right">{renderedRightComponent}</span>}
    </Tag>
  );
}

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "ghost" | "danger" | "accent";
export type ButtonSize = "sm" | "md";

/** Variant-driven button that renders the existing .btn CSS classes.
 * Unlike bare <button className="btn">, this enforces the variant/size prop
 * set, and centralises icon sizing + disabled behaviour. */
export function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconOnly = false,
  type = "button",
  className,
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconOnly?: boolean;
  children?: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const classes = ["btn"];
  if (variant === "primary") classes.push("btn--primary");
  if (variant === "accent") classes.push("btn--accent");
  if (variant === "ghost" || variant === "tertiary") classes.push("btn--ghost");
  if (variant === "danger") classes.push("btn--danger");
  if (size === "sm") classes.push("btn--sm");
  if (iconOnly) classes.push("btn--icon");
  if (className) classes.push(className);
  return (
    <button type={type} className={classes.join(" ")} {...rest}>
      {icon && <span className="btn__icon">{icon}</span>}
      {!iconOnly && children}
    </button>
  );
}

export type LightButtonAccent = "secondary" | "tertiary";
export type LightButtonSize = "sm" | "md";

export function LightButton({
  accent = "secondary",
  active = false,
  focus = false,
  size = "sm",
  icon,
  type = "button",
  className,
  children,
  ...rest
}: {
  accent?: LightButtonAccent;
  active?: boolean;
  focus?: boolean;
  size?: LightButtonSize;
  icon?: ReactNode;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const classes = ["light-button", `light-button--${accent}`, `light-button--${size}`];
  if (active) classes.push("is-active");
  if (focus) classes.push("is-focused");
  if (className) classes.push(className);
  return (
    <button type={type} className={classes.join(" ")} {...rest}>
      {icon && <span className="light-button__icon">{icon}</span>}
      {children && <span className="light-button__label">{children}</span>}
    </button>
  );
}

export function LightIconButton({
  accent = "secondary",
  active = false,
  focus = false,
  size = "sm",
  icon,
  type = "button",
  className,
  children,
  ...rest
}: {
  accent?: LightButtonAccent;
  active?: boolean;
  focus?: boolean;
  size?: LightButtonSize;
  icon?: ReactNode;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const classes = ["light-icon-button", `light-icon-button--${accent}`, `light-icon-button--${size}`];
  if (active) classes.push("is-active");
  if (focus) classes.push("is-focused");
  if (className) classes.push(className);
  return (
    <button type={type} className={classes.join(" ")} {...rest}>
      {icon ?? children}
    </button>
  );
}

export function SettingsShell({
  title,
  description,
  icon,
  iconColor,
  routeKey,
  tabs,
  activeTab,
  onTabChange,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Fallback icon when the registry has no entry for this route. */
  icon?: ReactNode;
  /** Fallback color when the registry has no entry for this route. */
  iconColor?: IconTone;
  /** Override the auto-detected route. Usually omit — the current pathname is used. */
  routeKey?: string;
  tabs?: { id: string; label: ReactNode; icon?: ReactNode }[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const location = useLocation();
  const identity = routeKey
    ? getRouteIdentity(routeKey)
    : resolveRouteIdentity(location.pathname);

  const resolvedIcon = identity
    ? createElement(identity.icon, { size: 16 })
    : icon;
  const resolvedTone: IconTone = identity?.color ?? iconColor ?? "gray";

  return (
    <div className="settings-shell">
      <div className="settings-shell__bar">
        <div className="settings-shell__main">
          <h1 className="settings-shell__title">
            {resolvedIcon && (
              <TintedIconTile tone={resolvedTone} size="md" className="settings-shell__icon">
                {resolvedIcon}
              </TintedIconTile>
            )}
            <span className="settings-shell__title-text">{title}</span>
          </h1>
          {description && <div className="settings-shell__description">{description}</div>}
        </div>
        {tabs && tabs.length > 0 && (
          <div className="settings-shell__tabs" role="tablist" aria-label="Settings sections">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.id === activeTab}
                className={`settings-shell__tab${tab.id === activeTab ? " is-active" : ""}${onTabChange ? " is-clickable" : ""}`}
                onClick={() => onTabChange?.(tab.id)}
              >
                {tab.icon && <span className="settings-shell__tab-icon">{tab.icon}</span>}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        )}
        {actions && <div className="settings-shell__actions">{actions}</div>}
      </div>
      <div className="settings-shell__content">{children}</div>
    </div>
  );
}

export function TintedIconTile({
  tone = "gray",
  size = "md",
  className,
  children,
}: {
  tone?: "blue" | "red" | "turquoise" | "gray" | "orange" | "purple" | "green" | "pink" | "yellow";
  size?: "sm" | "md" | "lg";
  className?: string;
  children: ReactNode;
}) {
  const classes = ["tinted-icon-tile", `tinted-icon-tile--${size}`, `icon-chip-${tone}`];
  if (className) classes.push(className);
  return <span className={classes.join(" ")}>{children}</span>;
}

export function MenuSectionLabel({ children }: { children: ReactNode }) {
  return <div className="menu__section-label">{children}</div>;
}

export function MenuRow({
  icon,
  label,
  hint,
  right,
  active = false,
  disabled = false,
  destructive = false,
  subtle = false,
  role,
  ariaSelected,
  onMouseEnter,
  onClick,
}: {
  icon?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  right?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  subtle?: boolean;
  role?: string;
  ariaSelected?: boolean;
  onMouseEnter?: () => void;
  onClick?: () => void;
}) {
  const classes = ["menu__item"];
  if (active) classes.push("is-active");
  if (disabled) classes.push("is-disabled");
  if (destructive) classes.push("menu__item--destructive");
  if (subtle) classes.push("menu__item--clear");

  return (
    <button
      type="button"
      role={role}
      aria-selected={ariaSelected}
      aria-disabled={disabled || undefined}
      className={classes.join(" ")}
      disabled={disabled}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      <span className="menu__item-main">
        {icon && <span className="menu__item-icon">{icon}</span>}
        <span className="menu__item-label">
          {label}
          {hint && <span className="menu__item-hint"> · {hint}</span>}
        </span>
      </span>
      {right && <span className="menu__item-right">{right}</span>}
    </button>
  );
}

export function RecordChip({
  avatar,
  label,
  meta,
  tone = "gray",
  to,
  onClick,
  className,
}: {
  avatar?: ReactNode;
  label: ReactNode;
  meta?: ReactNode;
  tone?: "blue" | "red" | "turquoise" | "gray" | "orange" | "purple" | "green" | "pink" | "yellow";
  to?: string;
  onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
  className?: string;
}) {
  const classes = ["record-chip"];
  if (to || onClick) classes.push("record-chip--interactive");
  if (className) classes.push(className);

  const content = (
    <>
      {avatar != null && (
        <TintedIconTile tone={tone} size="sm" className="record-chip__avatar">
          {avatar}
        </TintedIconTile>
      )}
      <span className="record-chip__content">
        <span className="record-chip__label">{label}</span>
        {meta && <span className="record-chip__meta">{meta}</span>}
      </span>
    </>
  );

  if (to) {
    return (
      <Link to={to} className={classes.join(" ")} onClick={onClick}>
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button type="button" className={classes.join(" ")} onClick={onClick}>
        {content}
      </button>
    );
  }

  return <span className={classes.join(" ")}>{content}</span>;
}

export function InspectorNote({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "danger";
  title?: ReactNode;
  children: ReactNode;
}) {
  const Icon = tone === "info" ? Info : AlertTriangle;

  return (
    <div className={`inspector-note inspector-note--${tone}`}>
      <div className="inspector-note__icon">
        <Icon size={14} />
      </div>
      <div className="inspector-note__content">
        {title && <div className="inspector-note__title">{title}</div>}
        <div className="inspector-note__body">{children}</div>
      </div>
    </div>
  );
}

export function Avatar({ label }: { label: string }) {
  return <span className="avatar">{label.slice(0, 2).toUpperCase()}</span>;
}

/** Animated placeholder block. Use while Convex useQuery returns undefined. */
export function Skeleton({
  width,
  height,
  radius,
  variant = "block",
  className,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  variant?: "block" | "line" | "text" | "circle";
  className?: string;
  style?: React.CSSProperties;
}) {
  const classes = ["skeleton", `skeleton--${variant}`];
  if (className) classes.push(className);
  const merged: React.CSSProperties = { ...style };
  if (width != null) merged.width = typeof width === "number" ? `${width}px` : width;
  if (height != null) merged.height = typeof height === "number" ? `${height}px` : height;
  if (radius != null) merged.borderRadius = typeof radius === "number" ? `${radius}px` : radius;
  return <span className={classes.join(" ")} style={merged} aria-hidden="true" />;
}

/** N stacked skeleton rows — handy for DataTable loading states. */
export function SkeletonRows({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="skeleton-stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div className="skeleton-row" key={r}>
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton
              key={c}
              variant="line"
              height={10}
              width={c === 0 ? "22%" : c === columns - 1 ? "14%" : "18%"}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Spinner({
  size = "md",
  tone,
  className,
  label = "Loading",
}: {
  size?: "sm" | "md" | "lg";
  tone?: "accent";
  className?: string;
  label?: string;
}) {
  const classes = ["spinner", `spinner--${size}`];
  if (tone) classes.push(`spinner--${tone}`);
  if (className) classes.push(className);
  return <span className={classes.join(" ")} role="status" aria-label={label} />;
}

export type BannerTone = "info" | "success" | "warn" | "danger";

/** Inline callout row. Use at the top of a page or panel to convey
 * non-blocking state (hint, success confirmation, warning, error). */
export function Banner({
  tone = "info",
  icon,
  title,
  onDismiss,
  className,
  children,
}: {
  tone?: BannerTone;
  icon?: ReactNode;
  title?: ReactNode;
  onDismiss?: () => void;
  className?: string;
  children?: ReactNode;
}) {
  const classes = ["banner", `banner--${tone}`];
  if (className) classes.push(className);
  const DefaultIcon: LucideIcon =
    tone === "success" ? CheckCircle2
    : tone === "danger" ? AlertTriangle
    : tone === "warn" ? AlertTriangle
    : Info;
  return (
    <div
      className={classes.join(" ")}
      role={tone === "danger" ? "alert" : "status"}
    >
      <span className="banner__icon">{icon ?? <DefaultIcon aria-hidden="true" />}</span>
      <div className="banner__content">
        {title && <div className="banner__title">{title}</div>}
        {children && <div className="banner__body">{children}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          className="banner__dismiss"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          <X aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  size = "default",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "default" | "wide";
}) {
  const inspector = useInspectorPanel();
  const panelId = useId();
  const titleId = useStableDomId("drawer-title");
  const dialogRef = useDialogFocus<HTMLDivElement>(open, onClose);

  useEffect(() => {
    if (!open || !inspector) return;
    inspector.activate(panelId, onClose);
    return () => inspector.deactivate(panelId);
  }, [open, onClose, inspector, panelId]);

  if (!open) return null;
  if (inspector?.portalTarget) {
    return createPortal(
      <div
        className={`inspector-panel${size === "wide" ? " inspector-panel--wide" : ""}`}
        role="dialog"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="drawer__head inspector-panel__head">
          <h2 className="drawer__title" id={titleId}>{title}</h2>
          <div style={{ flex: 1 }} />
          <button className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Close drawer">
            <X />
          </button>
        </div>
        <div className="drawer__body inspector-panel__body">{children}</div>
        {footer && <div className="drawer__footer inspector-panel__footer">{footer}</div>}
      </div>,
      inspector.portalTarget,
    );
  }
  if (inspector) return null;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div
        className={`drawer${size === "wide" ? " drawer--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="drawer__head">
          <h2 className="drawer__title" id={titleId}>{title}</h2>
          <div style={{ flex: 1 }} />
          <button className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Close drawer">
            <X />
          </button>
        </div>
        <div className="drawer__body">{children}</div>
        {footer && <div className="drawer__footer">{footer}</div>}
      </div>
    </>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  id,
  children,
}: {
  label: string;
  hint?: string;
  error?: ReactNode;
  required?: boolean;
  id?: string;
  children: ReactNode;
}) {
  const generatedId = useStableDomId("field");
  const fieldId = id ?? getFirstChildId(children) ?? generatedId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="field">
      <label className="field__label" htmlFor={fieldId}>
        {label}
        {required && <span className="field__required" aria-hidden="true"> *</span>}
      </label>
      {enhanceFieldChildren(children, fieldId, describedBy, Boolean(error))}
      {hint && <div className="field__hint" id={hintId}>{hint}</div>}
      {error && <div className="field__error" id={errorId}>{error}</div>}
    </div>
  );
}

export function LockedField({
  label,
  hint,
  reason,
  children,
}: {
  label: string;
  hint?: string;
  /** Why the field is locked — shown in the unlock confirmation. */
  reason: string;
  /** A render prop receiving the current locked state — your input must respect it (e.g. `disabled={locked}`). */
  children: (locked: boolean) => ReactNode;
}) {
  const [locked, setLocked] = useState(true);
  const confirm = useConfirm();
  const generatedId = useStableDomId("field");
  const fieldId = generatedId;
  const hintId = hint ? `${fieldId}-hint` : undefined;

  const onUnlock = async () => {
    const ok = await confirm({
      title: "Unlock this field?",
      message: (
        <>
          <p style={{ margin: "0 0 8px" }}>Editing this field has legal consequences:</p>
          <p style={{ margin: 0, color: "var(--text-secondary)" }}>{reason}</p>
        </>
      ),
      confirmLabel: "Unlock",
      tone: "warn",
    });
    if (ok) setLocked(false);
  };

  return (
    <div className={`field field--lockable${locked ? "" : " is-unlocked"}`}>
      <div className="field__label-row">
        <label className="field__label" htmlFor={fieldId}>{label}</label>
        {locked ? (
          <button
            className="field__lock field__lock--icon"
            onClick={onUnlock}
            type="button"
            title={reason}
            aria-label={`Unlock ${label}`}
          >
            <Lock aria-hidden="true" />
          </button>
        ) : (
          <button
            className="field__lock field__lock--unlocked"
            onClick={() => setLocked(true)}
            type="button"
            title="Lock again"
          >
            <Unlock aria-hidden="true" /> Editing
          </button>
        )}
      </div>
      {enhanceFieldChildren(children(locked), fieldId, hintId, false)}
      {hint && <div className="field__hint" id={hintId}>{hint}</div>}
    </div>
  );
}

export function Flag({
  level,
  children,
  citationId,
  citationIds,
}: {
  level: "ok" | "warn" | "err";
  children: ReactNode;
  /**
   * Regulatory citation id to surface next to the flag copy. Hovering the
   * badge reveals the source quote, full citation, and a link to the
   * authoritative text. Use for flags that rest on a statute, regulation,
   * or published agency guidance. See src/lib/regulatoryCitations.ts.
   */
  citationId?: string;
  /** Several citations (primary rendered first). */
  citationIds?: string[];
}) {
  const Icon = level === "ok" ? CheckCircle2 : level === "warn" ? Info : AlertTriangle;
  const ids = citationIds && citationIds.length > 0
    ? citationIds
    : citationId
      ? [citationId]
      : [];
  return (
    <div className={`flag flag--${level}`}>
      <Icon />
      <div className="flag__body">
        <div className="flag__text">{children}</div>
        {ids.length > 0 && (
          <div className="flag__citations">
            {ids.map((id) => (
              <CitationBadge key={id} citationId={id} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function useStableDomId(prefix: string) {
  const id = useId();
  return `${prefix}-${id.replace(/:/g, "")}`;
}

function useDialogFocus<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => {
      const first = ref.current?.querySelector<HTMLElement>("[autofocus]") ?? getFocusable(ref.current)[0];
      (first ?? ref.current)?.focus();
    }, 0);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusable(ref.current);
      if (focusable.length === 0) {
        event.preventDefault();
        ref.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !ref.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus();
    };
  }, [open]);

  return ref;
}

function getFocusable(root: HTMLElement | null) {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.offsetParent !== null,
  );
}

function getFirstChildId(children: ReactNode): string | undefined {
  let found: string | undefined;
  Children.forEach(children, (child) => {
    if (found || !isValidElement(child)) return;
    const props = child.props as { id?: string };
    if (props.id) found = props.id;
  });
  return found;
}

function enhanceFieldChildren(
  children: ReactNode,
  id: string,
  describedBy: string | undefined,
  invalid: boolean,
) {
  let applied = false;
  return Children.map(children, (child) => {
    if (applied || !isValidElement(child)) return child;
    const childProps = child.props as {
      id?: string;
      "aria-describedby"?: string;
      "aria-invalid"?: boolean;
    };
    const nextProps: Record<string, unknown> = {};
    if (!childProps.id) nextProps.id = id;
    if (describedBy) {
      nextProps["aria-describedby"] = [childProps["aria-describedby"], describedBy]
        .filter(Boolean)
        .join(" ");
    }
    if (invalid) nextProps["aria-invalid"] = true;
    applied = true;
    return cloneElement(child as ReactElement, nextProps);
  });
}
