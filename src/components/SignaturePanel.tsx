import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../convex/_generated/dataModel";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { Badge, Field } from "./ui";
import { useToast } from "./Toast";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pen, Trash2, Upload } from "lucide-react";
import { formatDateTime } from "../lib/format";
import { NameAutocomplete } from "./NameAutocomplete";
import { SignaturePad } from "./SignaturePad";

type SignMode = "typed" | "drawn" | "uploaded";

type SignerOption = {
  name: string;
  role: string;
  directorId?: string;
  memberId?: string;
};

function normalizeSignerName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function isAllowedSignatureDataUrl(dataUrl: string): boolean {
  return /^data:image\/(png|jpe?g|svg\+xml);/i.test(dataUrl);
}

function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "");
}

async function readSignatureFile(file: File): Promise<{ dataUrl: string; mimeType: string }> {
  const mimeType = file.type || (file.name.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "");
  if (!["image/png", "image/jpeg", "image/jpg", "image/svg+xml"].includes(mimeType)) {
    throw new Error("Upload a PNG, JPG, or SVG signature image.");
  }
  if (file.size > 350_000) throw new Error("Signature image must be under 350 KB.");

  if (mimeType === "image/svg+xml") {
    const svg = sanitizeSvg(await file.text());
    return {
      dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      mimeType,
    };
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read signature image."));
    reader.readAsDataURL(file);
  });
  if (!isAllowedSignatureDataUrl(dataUrl)) throw new Error("Upload a PNG, JPG, or SVG signature image.");
  return { dataUrl, mimeType };
}

function profileMatchesSigner(profile: any, signer: SignerOption | undefined, typedName: string): boolean {
  if (signer?.directorId && profile.directorId === signer.directorId) return true;
  if (signer?.memberId && profile.memberId === signer.memberId) return true;
  return profile.normalizedSignerName === normalizeSignerName(signer?.name ?? typedName);
}

function profilePreview(profile: any, signerName: string) {
  if (profile?.imageDataUrl) {
    return (
      <img
        className="signature-profile-preview__img"
        src={profile.imageDataUrl}
        alt={`${signerName} saved signature`}
      />
    );
  }
  return <span className="signature-profile-preview__typed">{profile?.typedName ?? signerName}</span>;
}

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
  const signatureProfiles = useQuery(api.signatures.listProfilesForSociety, { societyId });
  const sign = useMutation(api.signatures.sign);
  const revoke = useMutation(api.signatures.revoke);
  const members = useQuery(api.members.list, { societyId });
  const directors = useQuery(api.directors.list, { societyId });
  const user = useCurrentUser();
  const toast = useToast();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [typedName, setTypedName] = useState("");
  const [signMode, setSignMode] = useState<SignMode>("typed");
  const [drawnDataUrl, setDrawnDataUrl] = useState<string | null>(null);
  const [uploadedDataUrl, setUploadedDataUrl] = useState<string | null>(null);
  const [uploadedMimeType, setUploadedMimeType] = useState<string | null>(null);
  const [saveToProfile, setSaveToProfile] = useState(true);
  const [customizeSignature, setCustomizeSignature] = useState(false);
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
    const byName = new Map<string, SignerOption>();
    for (const option of options) {
      const key = option.name.toLowerCase();
      if (!byName.has(key) || option.role !== "Member") byName.set(key, option);
    }
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [directorSigners, memberSigners, signerScope]);
  const nameOptions = useMemo(() => signerOptions.map((option) => option.name), [signerOptions]);
  const nameOptionMeta = useMemo(() => {
    const meta: Record<string, string> = {};
    for (const option of signerOptions) {
      const profile = (signatureProfiles ?? []).find((row: any) => profileMatchesSigner(row, option, option.name));
      meta[option.name] = profile ? `${option.role} · saved signature` : option.role;
    }
    return meta;
  }, [signatureProfiles, signerOptions]);
  const selectedSigner = useMemo(
    () => signerOptions.find((option) => option.name.toLowerCase() === typedName.trim().toLowerCase()),
    [signerOptions, typedName],
  );
  const selectedProfile = useMemo(
    () => (signatureProfiles ?? []).find((profile: any) => profileMatchesSigner(profile, selectedSigner, typedName)),
    [selectedSigner, signatureProfiles, typedName],
  );

  useEffect(() => {
    setCustomizeSignature(false);
    setDrawnDataUrl(null);
    setUploadedDataUrl(null);
    setUploadedMimeType(null);
    setSignMode("typed");
  }, [typedName]);

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
  const normalizedTypedName = normalizeSignerName(typedName);
  const alreadySigned = !!normalizedTypedName && signedNames.has(normalizedTypedName);
  const selectedSignerUserId =
    selectedSigner &&
    user &&
    (selectedSigner.directorId === user.directorId ||
      selectedSigner.memberId === user.memberId ||
      selectedSigner.name.toLowerCase() === user.displayName?.trim().toLowerCase())
      ? user._id
      : undefined;
  const useSavedProfile = !!selectedProfile && !customizeSignature;
  const activeImageDataUrl =
    useSavedProfile ? selectedProfile.imageDataUrl :
      signMode === "drawn" ? drawnDataUrl ?? undefined :
        signMode === "uploaded" ? uploadedDataUrl ?? undefined :
          undefined;
  const activeImageMimeType =
    useSavedProfile ? selectedProfile.imageMimeType :
      signMode === "drawn" ? "image/png" :
        signMode === "uploaded" ? uploadedMimeType ?? undefined :
          undefined;
  const activeMethod = useSavedProfile ? selectedProfile.method : signMode;
  const activeTypedName = useSavedProfile
    ? selectedProfile.typedName ?? typedName.trim()
    : signMode === "typed"
      ? typedName.trim()
      : undefined;
  const signatureReady =
    !!typedName.trim() &&
    !alreadySigned &&
    (useSavedProfile || signMode === "typed" || (signMode === "drawn" && !!drawnDataUrl) || (signMode === "uploaded" && !!uploadedDataUrl));

  const resetCapture = () => {
    setTypedName("");
    setDrawnDataUrl(null);
    setUploadedDataUrl(null);
    setUploadedMimeType(null);
    setCustomizeSignature(false);
    setSignMode("typed");
  };

  return (
    <div className="card">
      <div className="card__head">
        <h3 className="card__title" style={{ fontSize: "var(--fs-md)" }}>
          <Pen size={13} style={{ verticalAlign: -1, marginRight: 6 }} />
          {title ?? "Signatures"}
        </h3>
      </div>
      <div className="card__body signature-panel__body">
        {displayedSignatures.map((s) => (
          <div className="signature-list-row" key={s._id}>
            {s.imageDataUrl ? (
              <img
                className="signature-list-row__img"
                src={s.imageDataUrl}
                alt={`${s.signerName} signature`}
              />
            ) : <span className="signature-list-row__img" aria-hidden />}
            <div className="signature-list-row__head">
              <span className="signature-list-row__name">{s.signerName}</span>
              {s.signerRole && <Badge>{s.signerRole}</Badge>}
            </div>
            <span className="signature-list-row__meta muted mono">
              {formatDateTime(s.signedAtISO)}
            </span>
            <button
              className="signature-list-row__trash btn btn--ghost btn--sm btn--icon"
              aria-label={`Revoke signature from ${s.signerName}`}
              onClick={async () => {
                if (s.localOnly) {
                  setLocalSignatures((current) => current.filter((signature) => signature._id !== s._id));
                  return;
                }
                try {
                  await revoke({ id: s._id, actingUserId: user?._id });
                  setLocalSignatures((current) => current.filter((signature) => signature._id !== s._id));
                } catch (error) {
                  console.error("[signatures.revoke]", error);
                  toast.error("Couldn't revoke signature", error instanceof Error ? error.message : String(error));
                }
              }}
              title="Revoke"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}

        <div className="signature-form-row">
          <Field label={signerScope === "directors" ? "Director who signed" : "Person who signed"}>
            <NameAutocomplete
              value={typedName}
              onChange={setTypedName}
              options={nameOptions}
              optionMeta={nameOptionMeta}
              excludeOptions={signedNames}
              placeholder={signerScope === "directors" ? "Director name…" : "First Last"}
            />
          </Field>
          <button
            className="btn btn--accent"
            disabled={!signatureReady}
            onClick={async () => {
              const name = typedName.trim();
              if (!name) {
                toast.error("Type a signer name.");
                return;
              }
              if (signedNames.has(name.toLowerCase())) {
                toast.error(`${name} already signed.`);
                return;
              }
              if (!signatureReady) {
                toast.error("Choose or capture a signature before saving.");
                return;
              }
              const signerRole = selectedSigner?.role ?? (signerScope === "directors" ? "Director" : undefined);
              try {
                const result = await sign({
                  societyId,
                  entityType,
                  entityId,
                  userId: selectedSignerUserId,
                  directorId: selectedSigner?.directorId as Id<"directors"> | undefined,
                  memberId: selectedSigner?.memberId as Id<"members"> | undefined,
                  signatureProfileId: selectedProfile?._id,
                  actingUserId: user?._id,
                  signerName: name,
                  signerRole,
                  method: activeMethod,
                  typedName: activeTypedName,
                  imageDataUrl: activeImageDataUrl,
                  imageMimeType: activeImageMimeType,
                  saveToProfile: !useSavedProfile && saveToProfile,
                  demo: true,
                });
                const signatureId =
                  typeof result === "object" && result && "signatureId" in result
                    ? result.signatureId
                    : result;
                setLocalSignatures((current) => [
                  ...current,
                  {
                    _id: signatureId ?? `local-signature-${Date.now()}`,
                    signerName: name,
                    signerRole,
                    imageDataUrl: activeImageDataUrl,
                    signedAtISO: new Date().toISOString(),
                    userId: selectedSignerUserId,
                    localOnly: !signatureId,
                  },
                ]);
                resetCapture();
                toast.success(saveToProfile && !useSavedProfile ? "Signature captured and saved to profile" : "Signature captured");
              } catch (error) {
                console.error("[signatures.sign]", error);
                toast.error("Couldn't capture signature", error instanceof Error ? error.message : String(error));
              }
            }}
          >
            <Pen size={12} /> {useSavedProfile ? "Use saved signature" : "Add signature"}
          </button>
        </div>

        {selectedProfile && !customizeSignature && (
          <div className="signature-profile-preview">
            <div>
              <span className="muted">Saved profile signature</span>
              <strong>{selectedProfile.signerName}</strong>
            </div>
            {profilePreview(selectedProfile, typedName.trim())}
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCustomizeSignature(true)}>
              Replace
            </button>
          </div>
        )}

        {(!selectedProfile || customizeSignature) && (
          <>
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
              <button
                type="button"
                role="tab"
                aria-selected={signMode === "uploaded"}
                className={`btn btn--sm${signMode === "uploaded" ? " btn--accent" : " btn--ghost"}`}
                onClick={() => setSignMode("uploaded")}
              >
                <Upload size={12} /> Upload
              </button>
            </div>
            {signMode === "drawn" && (
              <Field label="Draw signature">
                <SignaturePad onChange={setDrawnDataUrl} ariaLabel="Draw your signature" />
              </Field>
            )}
            {signMode === "uploaded" && (
              <Field label="Upload signature image">
                <input
                  ref={uploadInputRef}
                  className="input"
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    try {
                      const next = await readSignatureFile(file);
                      setUploadedDataUrl(next.dataUrl);
                      setUploadedMimeType(next.mimeType);
                    } catch (error) {
                      setUploadedDataUrl(null);
                      setUploadedMimeType(null);
                      if (uploadInputRef.current) uploadInputRef.current.value = "";
                      toast.error("Couldn't use signature image", error instanceof Error ? error.message : String(error));
                    }
                  }}
                />
                {uploadedDataUrl && (
                  <img className="signature-upload-preview" src={uploadedDataUrl} alt="Uploaded signature preview" />
                )}
              </Field>
            )}
            <label className="signature-save-profile-row">
              <input
                type="checkbox"
                checked={saveToProfile}
                onChange={(event) => setSaveToProfile(event.target.checked)}
              />
              <span>Save this signature to the signer profile</span>
            </label>
          </>
        )}

        {nameOptions.length === 0 && (
          <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 8 }}>
            {signerScope === "directors"
              ? <>No directors on file — add one in <a href="/directors">Directors</a> to enable autocomplete.</>
              : <>No members or directors on file — add one in <a href="/directors">Directors</a> or <a href="/members">Members</a> to enable autocomplete.</>}
          </div>
        )}
      </div>
    </div>
  );
}
