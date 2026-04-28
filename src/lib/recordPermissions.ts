import type { FieldMetadata, ObjectMetadata, View } from "@/modules/object-record";

export type RecordPermissionContext = {
  role?: string | null;
  moduleKeys?: string[];
};

export type RecordPermissionConfig = {
  readableRoles?: string[];
  updatableRoles?: string[];
  hiddenFromRoles?: string[];
  requiredModules?: string[];
};

export function canReadObjectMetadata(
  objectMetadata: ObjectMetadata,
  context: RecordPermissionContext = {},
) {
  return canReadConfig(readPermissionConfig(objectMetadata as any), context);
}

export function canReadFieldMetadata(
  field: FieldMetadata,
  context: RecordPermissionContext = {},
) {
  if (field.isHidden) return false;
  return canReadConfig(readPermissionConfig(field), context);
}

export function canUpdateFieldMetadata(
  field: FieldMetadata,
  context: RecordPermissionContext = {},
) {
  if (field.isReadOnly || !canReadFieldMetadata(field, context)) return false;
  const config = readPermissionConfig(field);
  if (!config.updatableRoles?.length) return true;
  return roleMatches(config.updatableRoles, context.role);
}

export function canReadView(view: View, context: RecordPermissionContext = {}) {
  return canReadConfig(readPermissionConfig(view as any), context);
}

function canReadConfig(config: RecordPermissionConfig, context: RecordPermissionContext) {
  if (config.hiddenFromRoles?.length && roleMatches(config.hiddenFromRoles, context.role)) {
    return false;
  }
  if (config.readableRoles?.length && !roleMatches(config.readableRoles, context.role)) {
    return false;
  }
  if (config.requiredModules?.length) {
    const enabled = new Set(context.moduleKeys ?? []);
    return config.requiredModules.every((moduleKey) => enabled.has(moduleKey));
  }
  return true;
}

function readPermissionConfig(source: { config?: Record<string, any>; permissionConfig?: unknown }) {
  const raw = source.permissionConfig ?? source.config?.permissions ?? source.config?.permissionConfig;
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as RecordPermissionConfig)
    : {};
}

function roleMatches(allowed: string[], role?: string | null) {
  const normalizedRole = role?.trim().toLowerCase();
  return allowed.some((entry) => entry.trim().toLowerCase() === normalizedRole || entry === "*");
}
