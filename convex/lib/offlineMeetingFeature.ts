/** Server-only opt-in; an absent setting leaves installed online workspaces unchanged. */
export function offlineMeetingPreparationEnabled() {
  return process.env.OFFLINE_MEETING_PREPARATION_ENABLED === "1";
}
export function assertOfflineMeetingPreparationEnabled() {
  if (!offlineMeetingPreparationEnabled()) throw new Error("OFFLINE_MEETING_PREPARATION_DISABLED");
}
