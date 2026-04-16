import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { Badge, Field } from "./ui";
import { useToast } from "./Toast";
import { useState } from "react";
import { Pen, Trash2 } from "lucide-react";
import { formatDateTime } from "../lib/format";

export function SignaturePanel({
  societyId,
  entityType,
  entityId,
  title,
}: {
  societyId: Id<"societies">;
  entityType: string;
  entityId: string;
  title?: string;
}) {
  const signatures = useQuery(api.signatures.listForEntity, {
    entityType,
    entityId,
  });
  const sign = useMutation(api.signatures.sign);
  const revoke = useMutation(api.signatures.revoke);
  const user = useCurrentUser();
  const toast = useToast();
  const [typedName, setTypedName] = useState("");

  const already = (signatures ?? []).find(
    (s) => s.userId === user?._id || s.signerName === typedName,
  );

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card__head">
        <h3 className="card__title" style={{ fontSize: "var(--fs-md)" }}>
          <Pen size={13} style={{ verticalAlign: -1, marginRight: 6 }} />
          {title ?? "Signatures"}
        </h3>
        <span className="card__subtitle">
          {(signatures ?? []).length} signature(s) on file
        </span>
      </div>
      <div className="card__body">
        {(signatures ?? []).length === 0 && (
          <div className="muted" style={{ fontSize: "var(--fs-md)", marginBottom: 8 }}>
            Nobody has signed yet. Type your full name below and click Sign.
          </div>
        )}

        {(signatures ?? []).map((s) => (
          <div
            className="signature-list-row"
            key={s._id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 0",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <strong>{s.signerName}</strong>
            {s.signerRole && <span className="muted">· {s.signerRole}</span>}
            <Badge tone="info">{s.method}</Badge>
            {s.demo && <Badge>demo</Badge>}
            <div className="signature-list-row__spacer" style={{ flex: 1 }} />
            <span className="muted mono" style={{ fontSize: "var(--fs-sm)" }}>
              {formatDateTime(s.signedAtISO)}
            </span>
            <button
              className="btn btn--ghost btn--sm btn--icon"
              aria-label={`Revoke signature from ${s.signerName}`}
              onClick={() => revoke({ id: s._id })}
              title="Revoke"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}

        {!already && (
          <div className="signature-form-row">
            <Field label="Type your full name to sign">
              <input
                className="input"
                value={typedName || user?.displayName || ""}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder="e.g. Jane Doe"
              />
            </Field>
            <button
              className="btn btn--accent"
              onClick={async () => {
                const name = typedName || user?.displayName;
                if (!name) {
                  toast.error("Pick a user in the header or type your name.");
                  return;
                }
                await sign({
                  societyId,
                  entityType,
                  entityId,
                  userId: user?._id,
                  signerName: name,
                  signerRole: user?.role,
                  method: "typed",
                  typedName: name,
                  demo: true,
                });
                setTypedName("");
                toast.success("Signature captured");
              }}
            >
              <Pen size={12} /> Sign
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
