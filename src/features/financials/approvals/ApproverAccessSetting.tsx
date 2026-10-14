import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { Badge } from "../../../components/ui";
import { RadioGroup } from "../../../components/Controls";
import { useConfirm } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import { formatDate } from "../../../lib/format";
import type { ApproverAccess } from "../../../../shared/expenseApprovals";
import type { ApprovalQueue } from "./types";

const OPTIONS: { value: ApproverAccess; label: string; hint: string }[] = [
  {
    value: "finance_writers",
    label: "People with finance edit access (default)",
    hint: "Owners and admins. The rules below still set how many approvals a claim needs and who among them may give one.",
  },
  {
    value: "rule_roles",
    label: "Anyone named in an approval rule, including directors with read-only finance access",
    hint: "Directors listed in a rule can approve without being able to edit the books or mark claims paid.",
  },
];

/**
 * The workspace's approver-access setting: whether approving a claim needs
 * finance edit access (the default) or only a place in the matching rule.
 * The server enforces it on every approval; this only chooses it.
 */
export function ApproverAccessSetting({ queue, societyId }: { queue: ApprovalQueue; societyId: string }) {
  const save = useMutation(api.expenseReports.saveApproverAccess);
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, setPending] = useState<ApproverAccess | null>(null);
  const setting = queue.approverAccess;
  const canChange = setting.canChange;

  const choose = async (next: ApproverAccess) => {
    if (next === setting.value || pending) return;
    if (next === "rule_roles") {
      const ok = await confirm({
        title: "Let directors approve claims?",
        message: "Anyone named in the matching approval rule will be able to approve claims, including directors who can only view finances. Approval counts and the self-approval rule still apply.",
        confirmLabel: "Allow rule approvers",
      });
      if (!ok) return;
    }
    setPending(next);
    try {
      await save({ societyId: societyId as any, approverAccess: next });
      toast.success(
        "Approver access saved",
        next === "finance_writers" ? "Only people with finance edit access can approve claims." : "Anyone named in the matching rule can approve claims.",
      );
    } catch (error: any) {
      toast.error("Could not change who can approve", error?.message);
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="card approver-access" aria-labelledby="approver-access-title">
      <div className="card__head">
        <div>
          <h2 id="approver-access-title" className="card__title">Who can approve claims</h2>
          <span className="card__subtitle">Applies to every approval, including bulk approve and the Treasurer dashboard.</span>
        </div>
        {!setting.isDefault && <Badge tone="warn">Changed from default</Badge>}
      </div>
      <div className="card__body approver-access__body">
        <fieldset className="approver-access__options" disabled={!canChange || pending !== null}>
          <legend className="sr-only">Who can approve claims</legend>
          <RadioGroup<ApproverAccess>
            name="approver-access"
            value={pending ?? setting.value}
            onChange={(next) => void choose(next)}
            options={OPTIONS.map((option) => ({ ...option, disabled: !canChange }))}
          />
        </fieldset>
        <p className="approver-access__tradeoff">
          Finance edit access keeps approvals with the people who can pay and correct claims; opening it to rule approvers spreads the work but lets read-only directors approve spending.
        </p>
        {(!canChange || setting.updatedByName) && (
          <p className="approver-access__meta muted">
            {!canChange && "Only people with finance edit access can change this. "}
            {setting.updatedByName && setting.updatedAtISO && `Last changed by ${setting.updatedByName} on ${formatDate(setting.updatedAtISO)}.`}
          </p>
        )}
      </div>
    </section>
  );
}
