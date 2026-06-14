import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Field } from "./ui";
import { useToast } from "./Toast";
import { isDemoMode } from "../lib/demoMode";

export type ImageValue = { imageStorageId?: string; imageUrl?: string };

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Image picker that works in both runtimes:
 * - demo / static runtime stores an inline data URL (no Convex storage available)
 * - backend runtime uploads to Convex storage and keeps the storageId
 */
export function ImageUploadField({
  label = "Photo",
  hint,
  value,
  onChange,
}: {
  label?: string;
  hint?: string;
  value: ImageValue;
  onChange: (value: ImageValue) => void;
}) {
  const toast = useToast();
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = value.imageUrl;

  const pickFile = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file.");
      return;
    }
    setBusy(true);
    try {
      if (isDemoMode()) {
        const dataUrl = await readAsDataUrl(file);
        onChange({ imageStorageId: undefined, imageUrl: dataUrl });
      } else {
        const uploadUrl = await generateUploadUrl({});
        const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file });
        if (!res.ok) throw new Error("Upload failed");
        const { storageId } = await res.json();
        onChange({ imageStorageId: storageId, imageUrl: URL.createObjectURL(file) });
      }
    } catch (error: any) {
      toast.error(error?.message ?? "Could not upload image.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Field label={label} hint={hint}>
      <div className="row" style={{ gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div
          style={{
            width: 72,
            height: 72,
            flex: "0 0 auto",
            borderRadius: 8,
            border: "1px solid var(--border, #d8dadf)",
            background: "var(--surface-muted, #f3f4f6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            color: "var(--muted, #8a8f98)",
          }}
        >
          {preview ? (
            <img src={preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <ImagePlus size={18} />
          )}
        </div>
        <div className="stack stack--xs" style={{ flex: "1 1 200px", minWidth: 180 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn--sm" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? <Loader2 size={12} className="spin" /> : <ImagePlus size={12} />} {preview ? "Replace" : "Upload"}
            </button>
            {preview && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange({ imageStorageId: undefined, imageUrl: undefined })}>
                <Trash2 size={12} /> Remove
              </button>
            )}
          </div>
          <input
            className="input"
            placeholder="…or paste an image URL"
            value={value.imageStorageId ? "" : value.imageUrl ?? ""}
            onChange={(e) => onChange({ imageStorageId: undefined, imageUrl: e.target.value || undefined })}
          />
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
        </div>
      </div>
    </Field>
  );
}
