/**
 * Procurement review reads a snapshot the local Zoer publishes to one
 * SharePoint folder per workspace (zoer/docs/societyer-review-contract.md §3).
 * These checks are the whole of what Societyer may read there: the folder a
 * workspace configured, and inside it only the manifest, catalog parts and
 * content-addressed document blobs.
 */

export const PROCUREMENT_REVIEW_FOLDER_MAX_LENGTH = 400;

const FOLDER_SEGMENT = /^[A-Za-z0-9 ._-]+$/;

/** `<UTC yyyymmddThhmmssZ>-<first 12 hex of the catalog sha256>` */
export const SNAPSHOT_ID_PATTERN = /^\d{8}T\d{6}Z-[a-f0-9]{12}$/;
export const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const BLOB_PATHS = [
  /^manifest\.json$/,
  /^snapshots\/\d{8}T\d{6}Z-[a-f0-9]{12}\/catalog\.part-\d{3}$/,
  /^files\/[a-f0-9]{64}(?:\.part-\d{3})?$/,
];

/**
 * A drive-relative folder: segments of letters, digits, space, dot, underscore
 * and hyphen; no empty, `.` or `..` segments; no leading or trailing slash.
 * Returns the folder with surrounding whitespace removed.
 */
export function validateProcurementReviewFolder(value: unknown): string {
  if (typeof value !== "string") throw new Error("Enter the SharePoint folder path.");
  const folder = value.trim();
  if (!folder) throw new Error("Enter the SharePoint folder path.");
  if (folder.length > PROCUREMENT_REVIEW_FOLDER_MAX_LENGTH) throw new Error(`Use a folder path of at most ${PROCUREMENT_REVIEW_FOLDER_MAX_LENGTH} characters.`);
  if (folder.startsWith("/") || folder.endsWith("/")) throw new Error("Enter the folder path without a leading or trailing slash, for example Zoer/bc-bid-monitor/our-society.");
  for (const segment of folder.split("/")) {
    if (!segment) throw new Error("The folder path has an empty segment (two slashes in a row).");
    if (segment === "." || segment === "..") throw new Error("The folder path can't contain . or .. segments.");
    if (!FOLDER_SEGMENT.test(segment)) throw new Error("Folder names may use letters, digits, spaces, dots, underscores and hyphens only.");
    if (segment !== segment.trim() || segment.endsWith(".")) throw new Error("Folder segments cannot start or end with spaces or end with a dot.");
  }
  return folder;
}

/** Workspace administrators cannot claim an arbitrary existing tenant folder. */
export function workspaceProcurementReviewRoot(societyId: string): string {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(societyId)) throw new Error("Invalid workspace identity.");
  return `Zoer/bc-bid-monitor/${societyId}`;
}

export function validateWorkspaceProcurementReviewFolder(societyId: string, value: unknown): string {
  const folder = validateProcurementReviewFolder(value);
  const root = workspaceProcurementReviewRoot(societyId).toLowerCase();
  const canonical = folder.toLowerCase();
  if (canonical !== root && !canonical.startsWith(root + "/")) throw new Error("Choose this workspace's own SharePoint folder or a folder inside it.");
  return folder;
}

/** Whether two folders are the same or one contains the other (SharePoint paths are case-insensitive). */
export function procurementReviewFoldersOverlap(a: string, b: string): boolean {
  const left = `${a.toLowerCase()}/`;
  const right = `${b.toLowerCase()}/`;
  return left.startsWith(right) || right.startsWith(left);
}

/** Whether a snapshot-relative path is one of the files the contract lets Societyer read. */
export function isProcurementReviewBlobPath(path: unknown): path is string {
  return typeof path === "string" && path.length <= 200 && BLOB_PATHS.some((pattern) => pattern.test(path));
}

/** The drive-relative path of one snapshot file, or an error when either part is outside the contract. */
export function procurementReviewDrivePath(folder: string, blobPath: string): string {
  const root = validateProcurementReviewFolder(folder);
  if (root !== folder) throw new Error("Invalid procurement review folder.");
  if (!isProcurementReviewBlobPath(blobPath)) throw new Error("That file is not part of a published procurement snapshot.");
  return `${root}/${blobPath}`;
}
