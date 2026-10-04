import { useEffect, useState } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { usePermissionedMutation } from "@/hooks/usePermissionedMutation";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../convex/_generated/dataModel";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { normalizeAssetForm } from "./assetUtils";
import {
  AssetFormFields,
  makeAssetFormDefaults,
  useAssetFormData,
  type AssetFormInitialValues,
  type AssetFormValue,
} from "./AssetFormFields";

export function AssetCreateModal(props: Parameters<typeof AssetCreateModalForm>[0]) {
  const { can } = usePermissions();
  if (!props.open || !can("financials:write")) return null;
  return <AssetCreateModalForm {...props} />;
}

function AssetCreateModalForm({
  open,
  onClose,
  societyId,
  initialValues,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  societyId: Id<"societies">;
  initialValues?: AssetFormInitialValues;
  onCreated?: (assetId: Id<"assets">) => void;
}) {
  const { can } = usePermissions();
  const canCreate = can("financials:write");
  const create = usePermissionedMutation(api.assets.create, canCreate);
  const toast = useToast();
  const data = useAssetFormData(societyId);

  const [form, setForm] = useState<AssetFormValue>(() =>
    makeAssetFormDefaults(initialValues, data.assets),
  );
  const [saving, setSaving] = useState(false);

  // Reset the form whenever the modal is reopened. Recompute the next asset
  // tag from the latest asset list so it reflects assets created elsewhere in
  // the meantime. Deps deliberately exclude `initialValues` — most callers
  // pass a new object each render, which would wipe edits during typing.
  useEffect(() => {
    if (open) {
      setForm(makeAssetFormDefaults(initialValues, data.assets));
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data.assets]);

  const save = async () => {
    if (!open || !canCreate) return;
    const payload = normalizeAssetForm(form);
    if (!payload.assetTag || !payload.name) {
      toast.error("Asset tag and name are required");
      return;
    }
    setSaving(true);
    try {
      const id = await create({ societyId, ...payload } as any);
      toast.success("Asset created", payload.name);
      onCreated?.(id as Id<"assets">);
      onClose();
    } catch (error: any) {
      toast.error("Could not create asset", error?.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New asset"
      size="lg"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn--accent" onClick={save} disabled={!canCreate || saving}>
            {saving ? "Creating…" : "Create"}
          </button>
        </>
      }
    >
      <AssetFormFields
        value={form}
        onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
        data={data}
      />
    </Modal>
  );
}
