import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Id } from "../../convex/_generated/dataModel";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { Badge, Field } from "./ui";
import { useToast } from "./Toast";
import { useMemo, useState } from "react";
import { Pen, Trash2 } from "lucide-react";
import { formatDateTime } from "../lib/format";
import { NameAutocomplete } from "./NameAutocomplete";
import { SignaturePad } from "./SignaturePad";

export function SignaturePanel({
  societyId,
  entityType,
  entityId,
  title,
  signerScope = "people",
}: {
  societyId: Id<"societies">;
  entityType: string;
  entityId: string;
  title?: string;
  signerScope?: "people" | "directors";
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
  const [signMode, setSignMode] = useState<"typed" | "drawn">("typed");
  const [drawnDataUrl, setDrawnDataUrl] = useState<string | null>(null);
  const [localSignatures, setLocalSignatures] = useState<any[]>([]);

  const directorSigners = useMemo(
    () =>
      (directors ?? [])
        .filter((director: any) => director.status !== "Resigned" && !director.resignedAt)
        .map((director: any) => ({
          name: `${director.firstName ?? ""} ${director.lastName ?? ""}`.trim(),
          role: director.position || "Director",
          directorId: director._id,
          memberId: director.memberId,
        }))
        .filter((director) => director.name),
    [directors],
  );
  const memberSigners = useMemo(
    () =>
      (members ?? [])
        .map((member: any) => ({
          name: `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim(),
          role: "Member",
          memberId: member._id,
        }))
        .filter((member) => member.name),
    [members],
  );
  const signerOptions = useMemo(() => {
    const options = signerScope === "directors" ? directorSigners : [...directorSigners, ...memberSigners];
    const byName = new Map<string, { name: string; role: string; directorId?: string; memberId?: string }>();
    for (const option of options) {
      const key = option.name.toLowerCase();
      if (!byName.has(key) || option.role !== "Member") byName.set(key, option);
    }
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [directorSigners, memberSigners, signerScope]);
  const nameOptions = useMemo(() => signerOptions.map((option) => option.name), [signerOptions]);
  const selectedSigner = useMemo(
    () => signerOptions.find((option) => option.name.toLowerCase() === typedName.trim().toLowerCase()),
    [signerOptions, typedName],
  );

  const displayedSignatures = useMemo(() => {
    const persisted = signatures ?? [];
    const persistedIds = new Set(persisted.map((signature: any) => signature._id));
    const persistedNames = new Set(persisted.map((signature: any) => signature.signerName.trim().toLowerCase()));
    return [
      ...persisted,
      ...localSignatures.filter(
        (signature) => !persistedIds.has(signature._id) && !persistedNames.has(signature.signerName.trim().toLowerCase()),
      ),
    ];
  }, [localSignatures, signatures]);
  const signedNames = useMemo<Set<string>>(
    () => new Set<string>(displayedSignatures.map((s: any) => s.signerName.trim().toLowerCase()).filter(Boolean)),
    [displayedSignatures],
  );
  const normalizedTypedName = typedName.trim().toLowerCase();
  const alreadySigned = !!normalizedTypedName && signedNames.has(normalizedTypedName);
  const selectedSignerUserId =
    selectedSigner &&
    user &&
    (selectedSigner.directorId === user.directorId ||
      selectedSigner.memberId === user.memberId ||
      selectedSigner.name.toLowerCase() === user.displayName?.trim().toLowerCase())
      ? user._id
      : undefined;

  return (
    <div className="card">
      <div className="card__head">
        <h3 className="card__title" style={{ fontSize: "var(--fs-md)" }}>
          <Pen size={13} style={{ verticalAlign: -1, marginRight: 6 }} />
          {title ?? "Signatures"}
        </h3>
      </div>
      <div className="card__body">
        {displayedSignatures.map((s) => (
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
            {s.imageDataUrl ? (
              <img
                src={s.imageDataUrl}
                alt={`${s.signerName} signature`}
                style={{ height: 28, maxWidth: 120, objectFit: "contain" }}
              />
            ) : null}
            <strong>{s.signerName}</strong>
            {s.signerRole && <Badge>{s.signerRole}</Badge>}
            <div className="signature-list-row__spacer" style={{ flex: 1 }} />
            <span className="muted mono" style={{ fontSize: "var(--fs-sm)" }}>
              {formatDateTime(s.signedAtISO)}
            </span>
            <button
              className="btn btn--ghost btn--sm btn--icon"
              aria-label={`Revoke signature from ${s.signerName}`}
              disabled={!user}
              onClick={() => {
                if (!user) return;
                if (s.localOnly) {
                  setLocalSignatures((current) => current.filter((signature) => signature._id !== s._id));
                  return;
                }
                void revoke({ id: s._id, actingUserId: user._id });
              }}
              title="Revoke"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}

        <div className="signature-mode-toggle" role="tablist" aria-label="Signature method">
          <button
            type="button"
            role="tab"
            aria-selected={signMode === "typed"}
            className={`btn btn--sm${signMode === "typed" ? " btn--accent" : " btn--ghost"}`}
            onClick={() => setSignMode("typed")}
          >
            Type
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={signMode === "drawn"}
            className={`btn btn--sm${signMode === "drawn" ? " btn--accent" : " btn--ghost"}`}
            onClick={() => setSignMode("drawn")}
          >
            Draw
          </button>
        </div>
        {signMode === "drawn" && (
          <Field label="Draw signature">
            <SignaturePad onChange={setDrawnDataUrl} ariaLabel="Draw your signature" />
          </Field>
        )}
        <div className="signature-form-row">
          <Field label={signerScope === "directors" ? "Director who signed" : "Person who signed"}>
            <NameAutocomplete
              value={typedName}
              onChange={setTypedName}
              options={nameOptions}
              excludeOptions={signedNames}
              placeholder={signerScope === "directors" ? "Director name…" : "First Last"}
            />
          </Field>
          <button
            className="btn btn--accent"
            disabled={!user || !typedName.trim() || alreadySigned || (signMode === "drawn" && !drawnDataUrl)}
            onClick={async () => {
              if (!user) {
                toast.error("Pick a user in the header before signing.");
                return;
              }
              const name = typedName.trim();
              if (!name) {
                toast.error("Type a signer name.");
                return;
              }
              if (signedNames.has(name.toLowerCase())) {
                toast.error(`${name} already signed.`);
                return;
              }
              if (signMode === "drawn" && !drawnDataUrl) {
                toast.error("Draw a signature before saving.");
                return;
              }
              const signerRole = selectedSigner?.role ?? (signerScope === "directors" ? "Director" : undefined);
              const imageDataUrl = signMode === "drawn" ? drawnDataUrl ?? undefined : undefined;
              const signatureId = await sign({
                societyId,
                entityType,
                entityId,
                userId: selectedSignerUserId,
                actingUserId: user._id,
                signerName: name,
                signerRole,
                method: signMode,
                typedName: signMode === "typed" ? name : undefined,
                imageDataUrl,
                demo: true,
              });
              setLocalSignatures((current) => [
                ...current,
                {
                  _id: signatureId ?? `local-signature-${Date.now()}`,
                  signerName: name,
                  signerRole,
                  imageDataUrl,
                  signedAtISO: new Date().toISOString(),
                  userId: selectedSignerUserId,
                  localOnly: !signatureId,
                },
              ]);
              setTypedName("");
              setDrawnDataUrl(null);
              toast.success("Signature captured");
            }}
          >
            <Pen size={12} /> Add signature
          </button>
        </div>
      </div>
    </div>
  );
}
