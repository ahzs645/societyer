import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Id } from "../../convex/_generated/dataModel";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { Field } from "./ui";
import { useToast } from "./Toast";
import { useMemo, useState } from "react";
import { Pen, Trash2 } from "lucide-react";
import { formatDateTime } from "../lib/format";
import { NameAutocomplete } from "./NameAutocomplete";

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
  const members = useQuery(api.members.list, { societyId });
  const directors = useQuery(api.directors.list, { societyId });
  const user = useCurrentUser();
  const toast = useToast();
  const [typedName, setTypedName] = useState("");

  const nameOptions = useMemo(() => {
    const names = new Set<string>();
    for (const m of members ?? []) {
      const n = `${(m as any).firstName ?? ""} ${(m as any).lastName ?? ""}`.trim();
      if (n) names.add(n);
    }
    for (const d of directors ?? []) {
      const n = `${(d as any).firstName ?? ""} ${(d as any).lastName ?? ""}`.trim();
      if (n) names.add(n);
    }
    return Array.from(names).sort();
  }, [members, directors]);

  const already = (signatures ?? []).find(
    (s) => s.userId === user?._id || s.signerName === typedName,
  );

  return (
    <div className="card">
      <div className="card__head">
        <h3 className="card__title" style={{ fontSize: "var(--fs-md)" }}>
          <Pen size={13} style={{ verticalAlign: -1, marginRight: 6 }} />
          {title ?? "Signatures"}
        </h3>
      </div>
      <div className="card__body">
        
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
            <div className="signature-list-row__spacer" style={{ flex: 1 }} />
            <span className="muted mono" style={{ fontSize: "var(--fs-sm)" }}>
              {formatDateTime(s.signedAtISO)}
            </span>
            <button
              className="btn btn--ghost btn--sm btn--icon"
              aria-label={`Revoke signature from ${s.signerName}`}
              disabled={!user}
              onClick={() => user && revoke({ id: s._id, actingUserId: user._id })}
              title="Revoke"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}

        {!already && (
          <div className="signature-form-row">
            <Field label="Type your full name to sign">
              <NameAutocomplete
                value={typedName}
                onChange={setTypedName}
                options={nameOptions}
                placeholder="FirstName LastName"
              />
            </Field>
            <button
              className="btn btn--accent"
              disabled={!user || !typedName.trim()}
              onClick={async () => {
                if (!user) {
                  toast.error("Pick a user in the header before signing.");
                  return;
                }
                const name = typedName.trim();
                if (!name) {
                  toast.error("Type your name to sign.");
                  return;
                }
                const normalized = name.toLowerCase();
                const isDirector = (directors ?? []).some(
                  (d: any) => `${d.firstName ?? ""} ${d.lastName ?? ""}`.trim().toLowerCase() === normalized,
                );
                await sign({
                  societyId,
                  entityType,
                  entityId,
                  userId: user?._id,
                  actingUserId: user._id,
                  signerName: name,
                  signerRole: isDirector ? "Director" : undefined,
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
