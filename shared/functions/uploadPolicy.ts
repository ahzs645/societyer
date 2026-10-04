import type { Permission } from "./permissions";

export type UploadPurpose = "document" | "meeting" | "asset" | "inventory";

/** Purpose selects the same permission as the eventual attachment sink.
 * It never authorizes a document attachment or bypasses that document's ACL. */
export function uploadPermission(purpose: UploadPurpose = "document"): Permission {
  switch (purpose) {
    case "document": return "documents:write";
    case "meeting": return "meetings:write";
    case "asset": case "inventory": return "financials:write";
    default: throw new Error("Unsupported upload purpose.");
  }
}
