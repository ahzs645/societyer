import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { Drawer, Field } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { RadioGroup } from "../../../components/Controls";
import { useToast } from "../../../components/Toast";
import { errorMessage, type BankAccountRow, type BankAccountsOverview } from "./types";

type Mode = "own" | "existing";

/**
 * Link an account to its ledger account: the account itself (creating a chart
 * code when it has none) or another bank, credit, asset or liability account.
 */
export function LinkLedgerDrawer({
  account,
  ledgerOptions,
  onClose,
}: {
  account: BankAccountRow | null;
  ledgerOptions: BankAccountsOverview["ledgerOptions"];
  onClose: () => void;
}) {
  const link = useMutation(api.bankAccounts.linkLedgerAccount);
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("own");
  const [ledgerId, setLedgerId] = useState("");
  const [busy, setBusy] = useState(false);
  const linkedId = account?.ledgerAccount && !account.ledgerAccount.isSelf ? account.ledgerAccount._id : "";
  useEffect(() => {
    setMode(linkedId ? "existing" : "own");
    setLedgerId(linkedId);
  }, [account?._id, linkedId]);

  if (!account) return null;
  const options = ledgerOptions.filter((option) => option._id !== account._id);

  const save = async () => {
    setBusy(true);
    try {
      if (mode === "existing") {
        if (!ledgerId) {
          toast.info("Choose a ledger account");
          return;
        }
        const result = await link({ id: account._id, ledgerAccountId: ledgerId });
        toast.success("Ledger account linked", `${account.name} posts to ${result.code}.`);
      } else if (account.code) {
        await link({ id: account._id, unlink: true });
        toast.success("Ledger account updated", `${account.name} is its own ledger account, ${account.code}.`);
      } else {
        const result = await link({ id: account._id, createLedgerAccount: true });
        toast.success("Ledger account created", `${account.name} is ledger account ${result.code}.`);
      }
      onClose();
    } catch (error: unknown) {
      toast.error("Could not link the ledger account", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title="Link to ledger account"
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" type="button" disabled={busy} onClick={() => void save()}>Save</button>
        </>
      }
    >
      <p className="muted bank-account-drawer__intro">
        The ledger account is where {account.name}'s transactions sit in the chart of accounts and the statements.
      </p>
      <RadioGroup<Mode>
        name="ledger-link"
        value={mode}
        onChange={setMode}
        options={[
          {
            value: "own",
            label: account.code ? `Its own ledger account (${account.code})` : "Create its own ledger account",
            hint: account.code ? "The account is already in the chart of accounts." : "Adds it to the chart of accounts under the next free code for its type.",
          },
          { value: "existing", label: "An existing ledger account", hint: "For a feed that mirrors an account already in your chart, such as 1000 Cash and bank." },
        ]}
      />
      {mode === "existing" && (
        <Field label="Ledger account">
          <Select
            value={ledgerId}
            onChange={setLedgerId}
            searchable
            placeholder="Choose a ledger account"
            options={options.map((option) => ({ value: option._id, label: option.label, hint: option.inUse ? "Linked to another account" : option.accountType }))}
          />
        </Field>
      )}
    </Drawer>
  );
}
