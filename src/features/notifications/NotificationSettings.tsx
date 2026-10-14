import { useEffect, useState, type KeyboardEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { CalendarClock, Info, Mail } from "lucide-react";
import { api } from "@/lib/convexApi";
import { formatMoney, parseMoneyInput } from "@/lib/money";
import { isLocalDataRuntime } from "@/lib/staticRuntime";
import { organizationVocabulary } from "@/lib/organizationVocabulary";
import { Banner, Badge } from "@/components/ui";
import { Toggle } from "@/components/Controls";
import { Select } from "@/components/Select";
import { useToast } from "@/components/Toast";
import { PageLoading } from "@/pages/_helpers";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_GROUPS,
  NOTIFICATION_KINDS,
  notificationRule,
  prefAllows,
  type NotificationChannel,
  type NotificationKindDef,
  type NotificationRuleId,
  type NotificationPrefRow,
} from "../../../shared/notificationCatalog";

type RuleState = {
  rule: NotificationRuleId;
  enabled: boolean;
  value: number;
  accountId?: string;
  stored: boolean;
  canEdit: boolean;
  preview?: { matches: number; detail?: string };
};

type SettingsResult = {
  userId: string | null;
  canSave: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
  kinds: string[];
  prefs: NotificationPrefRow[];
  rules: RuleState[];
  accounts: Array<{ _id: string; name: string; currency: string; balanceCents: number; isRestricted: boolean }>;
  digests: { daily: boolean; weekly: boolean };
  weeklyPreview: string[];
};

type Society = { _id: string } & Record<string, any>;

/**
 * Notification settings: a kinds × channels matrix for the signed-in person,
 * the workspace alert thresholds written as sentences, and digest emails.
 */
export function NotificationSettings({ society }: { society: Society }) {
  const settings = useQuery(api.notifications.settings, { societyId: society._id }) as SettingsResult | undefined;
  const setMyPref = useMutation(api.notifications.setMyPref);
  const toast = useToast();
  // Switches answer instantly; the server row catches up on the next query.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const vocab = organizationVocabulary(society as any);
  const local = isLocalDataRuntime();

  if (settings === undefined) return <PageLoading />;

  const prefs = settings.prefs;
  const isOn = (channel: string, kind: string) => {
    const key = `${channel}:${kind}`;
    if (key in pending) return pending[key];
    return prefAllows(prefs, channel, kind);
  };
  const digestOn = (cadence: "daily" | "weekly") => {
    const key = `email:digest:${cadence}`;
    return key in pending ? pending[key] : settings.digests[cadence];
  };

  const save = async (channel: string, kind: string, enabled: boolean) => {
    const key = `${channel}:${kind}`;
    setPending((current) => ({ ...current, [key]: enabled }));
    try {
      await setMyPref({ societyId: society._id, channel, kind, enabled });
    } catch (error: any) {
      setPending((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      toast.error("Couldn't save that setting", error?.message);
    }
  };

  const receivable = new Set(settings.kinds);
  const groups = NOTIFICATION_GROUPS.map((group) => ({
    ...group,
    label: vocab.isCorporation && group.corporationLabel ? group.corporationLabel : group.label,
    kinds: NOTIFICATION_KINDS.filter((kind) => kind.group === group.id && receivable.has(kind.id)),
  })).filter((group) => group.kinds.length > 0);

  const canSave = settings.canSave;

  return (
    <div className="notif-settings">
      {local && (
        <Banner tone="info" icon={<Info size={14} />} title="Email and texts need a connected server">
          This workspace runs in your browser, so digests aren't sent. Your choices are saved and take effect once the workspace is connected to a server. In-app alerts work here.
        </Banner>
      )}
      {!canSave && (
        <Banner tone="warn" title="Choose who you are first">
          Pick your name from the user menu to save personal notification settings.
        </Banner>
      )}

      <section className="card notif-settings__card" aria-labelledby="notif-matrix-title">
        <div className="card__head">
          <div>
            <h2 className="card__title" id="notif-matrix-title">What you hear about</h2>
            <div className="card__subtitle">These switches only affect you. You only see the kinds your role can receive.</div>
          </div>
        </div>
        <div className="card__body notif-matrix-wrap">
          <table className="notif-matrix">
            <thead>
              <tr>
                <th scope="col" className="notif-matrix__kind-col">Notification</th>
                {NOTIFICATION_CHANNELS.map((channel) => (
                  <th key={channel.id} scope="col" className="notif-matrix__channel-col" title={channel.description}>
                    {channel.label}
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.id}>
                <tr className="notif-matrix__group">
                  <th scope="rowgroup" colSpan={1 + NOTIFICATION_CHANNELS.length}>{group.label}</th>
                </tr>
                {group.kinds.map((kind) => (
                  <MatrixRow
                    key={kind.id}
                    kind={kind}
                    corporation={vocab.isCorporation}
                    isOn={isOn}
                    disabled={!canSave}
                    onChange={save}
                  />
                ))}
              </tbody>
            ))}
          </table>
          <p className="notif-settings__note muted">
            Email and text go out as a daily digest, not one message per alert.
            {!settings.hasPhone && " Texts need a phone number on your profile."}
          </p>
        </div>
      </section>

      {settings.rules.length > 0 && (
        <AlertThresholds society={society} rules={settings.rules} accounts={settings.accounts} />
      )}

      <section className="card notif-settings__card" aria-labelledby="notif-digest-title">
        <div className="card__head">
          <div>
            <h2 className="card__title" id="notif-digest-title">Digest emails</h2>
            <div className="card__subtitle">
              {settings.hasEmail ? "Sent to the email address on your profile." : "Add an email address to your profile to receive digests."}
            </div>
          </div>
        </div>
        <div className="card__body notif-digests">
          <div className="notif-digest">
            <Mail size={16} aria-hidden="true" className="notif-digest__icon" />
            <Toggle
              checked={digestOn("daily")}
              disabled={!canSave}
              onChange={(enabled) => void save("email", "digest:daily", enabled)}
              label="Daily digest"
              hint="Each morning: your unread notifications, limited to the kinds switched on in the Email column."
            />
          </div>
          <div className="notif-digest">
            <CalendarClock size={16} aria-hidden="true" className="notif-digest__icon" />
            <Toggle
              checked={digestOn("weekly")}
              disabled={!canSave}
              onChange={(enabled) => void save("email", "digest:weekly", enabled)}
              label="Weekly summary"
              hint="Mondays: what's due soon, claims waiting for approval and transactions that need attention."
            />
          </div>
          <div className="notif-digest__preview" aria-live="polite">
            <div className="notif-digest__preview-title">If your weekly summary went out now</div>
            {settings.weeklyPreview.length ? (
              <ul>
                {settings.weeklyPreview.map((line) => <li key={line}>{line}</li>)}
              </ul>
            ) : (
              <p className="muted">Nothing to report right now.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function MatrixRow({
  kind,
  corporation,
  isOn,
  disabled,
  onChange,
}: {
  kind: NotificationKindDef;
  corporation: boolean;
  isOn: (channel: string, kind: string) => boolean;
  disabled: boolean;
  onChange: (channel: NotificationChannel, kind: string, enabled: boolean) => void;
}) {
  const label = corporation && kind.corporationLabel ? kind.corporationLabel : kind.label;
  const description = corporation && kind.corporationDescription ? kind.corporationDescription : kind.description;
  return (
    <tr className="notif-matrix__row">
      <th scope="row" className="notif-matrix__kind">
        <span className="notif-matrix__label">
          {label}
          {kind.rule && <Badge tone="neutral">Threshold</Badge>}
        </span>
        <span className="notif-matrix__desc">{description}</span>
      </th>
      {NOTIFICATION_CHANNELS.map((channel) => {
        const checked = isOn(channel.id, kind.id);
        return (
          <td key={channel.id} className="notif-matrix__cell">
            <button
              type="button"
              role="switch"
              aria-checked={checked}
              aria-label={`${label}: ${channel.label}`}
              disabled={disabled}
              className="switch-bare notif-matrix__switch"
              onClick={() => onChange(channel.id, kind.id, !checked)}
            >
              <span className={`switch switch--sm${checked ? " is-on" : ""}${disabled ? " is-disabled" : ""}`} aria-hidden="true">
                <span className="switch__thumb" />
              </span>
            </button>
          </td>
        );
      })}
    </tr>
  );
}

function AlertThresholds({
  society,
  rules,
  accounts,
}: {
  society: Society;
  rules: RuleState[];
  accounts: SettingsResult["accounts"];
}) {
  const setRule = useMutation(api.notifications.setRule);
  const toast = useToast();
  const anyEditable = rules.some((rule) => rule.canEdit);

  const save = async (rule: RuleState, patch: Partial<Pick<RuleState, "enabled" | "value" | "accountId">>) => {
    const next = { ...rule, ...patch };
    try {
      await setRule({
        societyId: society._id,
        rule: rule.rule,
        enabled: next.enabled,
        value: next.value,
        accountId: next.rule === "low_balance" ? next.accountId ?? null : undefined,
      });
    } catch (error: any) {
      toast.error("Couldn't save the threshold", error?.message);
    }
  };

  const order: NotificationRuleId[] = ["budget_line", "low_balance", "claim_waiting", "deadline_lead"];
  const sorted = [...rules].sort((a, b) => order.indexOf(a.rule) - order.indexOf(b.rule));

  return (
    <section className="card notif-settings__card" aria-labelledby="notif-rules-title">
      <div className="card__head">
        <div>
          <h2 className="card__title" id="notif-rules-title">Alert thresholds</h2>
          <div className="card__subtitle">
            Shared by the whole workspace. Alerts go to everyone who receives that kind above.
            {!anyEditable && " Ask someone with edit access to change them."}
          </div>
        </div>
      </div>
      <ul className="card__body notif-rules">
        {sorted.map((rule) => (
          <ThresholdRow key={rule.rule} rule={rule} accounts={accounts} onSave={(patch) => save(rule, patch)} />
        ))}
      </ul>
    </section>
  );
}

function ThresholdRow({
  rule,
  accounts,
  onSave,
}: {
  rule: RuleState;
  accounts: SettingsResult["accounts"];
  onSave: (patch: Partial<Pick<RuleState, "enabled" | "value" | "accountId">>) => Promise<void>;
}) {
  const def = notificationRule(rule.rule)!;
  const display = def.unit === "cents" ? formatMoney(rule.value, { trimWholeCents: true }) : String(rule.value);
  const [draft, setDraft] = useState(display);
  useEffect(() => setDraft(display), [display]);
  const disabled = !rule.canEdit;

  const commit = () => {
    const parsed = def.unit === "cents" ? parseMoneyInput(draft) : Number.parseInt(draft, 10);
    if (parsed === undefined || !Number.isFinite(parsed) || parsed < def.min || parsed > def.max) {
      setDraft(display);
      return;
    }
    if (parsed !== rule.value) void onSave({ value: parsed });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") (event.target as HTMLInputElement).blur();
    if (event.key === "Escape") {
      setDraft(display);
      (event.target as HTMLInputElement).blur();
    }
  };
  const input = (label: string, className = "") => (
    <input
      className={`input input--sm notif-rule__input ${className}`.trim()}
      inputMode={def.unit === "cents" ? "decimal" : "numeric"}
      aria-label={label}
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  );

  const watched = accounts.find((account) => account._id === rule.accountId)
    ?? accounts.find((account) => !account.isRestricted)
    ?? accounts[0];

  const sentence = (() => {
    switch (rule.rule) {
      case "budget_line":
        return <><span>Alert when spending on a budget line passes</span>{input("Budget threshold, percent of plan", "notif-rule__input--short")}<span>% of plan</span></>;
      case "low_balance":
        return (
          <>
            <span>Alert when</span>
            {accounts.length > 1 ? (
              <Select
                size="sm"
                className="notif-rule__account"
                aria-label="Account to watch"
                value={watched?._id ?? ""}
                disabled={disabled}
                onChange={(accountId) => void onSave({ accountId })}
                options={accounts.map((account) => ({ value: account._id, label: account.name }))}
              />
            ) : (
              <strong>{watched?.name ?? "the operating account"}</strong>
            )}
            <span>falls below</span>
            {input("Low balance amount", "notif-rule__input--money")}
          </>
        );
      case "claim_waiting":
        return <><span>Alert when an expense claim has waited more than</span>{input("Days a claim can wait", "notif-rule__input--short")}<span>days for approval</span></>;
      case "deadline_lead":
        return <><span>Alert</span>{input("Days before a deadline", "notif-rule__input--short")}<span>days before a deadline or filing is due</span></>;
    }
  })();

  const status = statusLine(rule, watched);

  return (
    <li className={`notif-rule${rule.enabled ? "" : " is-off"}`}>
      <Toggle size="sm" checked={rule.enabled} disabled={disabled} onChange={(enabled) => void onSave({ enabled })} label={<span className="sr-only">{ruleName(rule.rule)}</span>} />
      <div className="notif-rule__main">
        <div className="notif-rule__sentence">{sentence}</div>
        {status && <div className="notif-rule__status muted">{status}</div>}
      </div>
      {disabled && <Badge tone="neutral">View only</Badge>}
    </li>
  );
}

function ruleName(rule: NotificationRuleId) {
  switch (rule) {
    case "budget_line": return "Budget line alert";
    case "low_balance": return "Low balance alert";
    case "claim_waiting": return "Claims waiting alert";
    case "deadline_lead": return "Deadline lead time";
  }
}

function statusLine(rule: RuleState, account?: SettingsResult["accounts"][number]) {
  const matches = rule.preview?.matches ?? 0;
  switch (rule.rule) {
    case "budget_line":
      return matches
        ? `Right now ${matches} ${matches === 1 ? "line is" : "lines are"} at or past ${rule.value}%${rule.preview?.detail ? `: ${rule.preview.detail}` : ""}.`
        : `No budget line is at ${rule.value}% yet.`;
    case "low_balance":
      return account ? `Balance now: ${formatMoney(account.balanceCents, { currency: account.currency, trimWholeCents: true })}.` : "No bank account to watch yet.";
    case "claim_waiting":
      return matches ? `Right now ${matches} ${matches === 1 ? "claim has" : "claims have"} waited longer than that.` : "No claim has waited that long.";
    case "deadline_lead":
      return matches ? `Right now ${matches} ${matches === 1 ? "deadline, filing or report is" : "deadlines, filings or reports are"} due within ${rule.value} days or overdue.` : `Nothing is due within ${rule.value} days.`;
  }
}
