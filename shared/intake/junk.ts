/** Stage 1: junk and exclusion filter. Deterministic; every exclusion carries a reason. */

export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
export const EMPTY_MD5 = "d41d8cd98f00b204e9800998ecf8427e";

export type Disposition = "pending" | "extract" | "catalogue" | "excluded" | "junk" | "duplicate" | "restricted";
export type JunkVerdict = { disposition: "junk" | "excluded" | "catalogue" | "keep"; reason?: string };

const JUNK_SEGMENTS = /(?:^|\/)(?:\.LexarDataShield|\.fseventsd|\.Spotlight-V100|\.Trashes|\.TemporaryItems|\.DocumentRevisions-V100|System Volume Information|\$RECYCLE\.BIN|__MACOSX|\.git)(?:\/|$)/i;
const JUNK_NAMES = /^(?:\.DS_Store|Thumbs\.db|desktop\.ini|ehthumbs\.db|Icon\r?|\.localized|\.apdisk|\.dropbox(?:\.attr)?|\.~lock\..*#)$/i;
const LOCK_OR_TEMP = /^(?:~\$|~WRL\d+\.tmp$|\.~lock\.)|\.(?:tmp|temp|crdownload|download|part|partial|lnk|url|webloc)$/i;
const EXECUTABLE = /\.(?:exe|msi|dmg|pkg|app|bat|cmd|com|scr|dll|jar|apk)$/i;
const FONT = /\.(?:otf|ttf|woff2?|eot|fon|pfb|pfm|dfont)$/i;
const DESIGN = /\.(?:ai|psd|indd|idml|eps|sketch|xd|fig|cdr)$/i;
const MEDIA = /\.(?:jpe?g|png|gif|bmp|tiff?|heic|webp|svg|mp3|m4a|wav|aac|flac|ogg|mp4|mov|avi|wmv|mkv|m4v)$/i;
const ARCHIVE = /\.(?:zip|rar|7z|tar|gz|tgz)$/i;

export function junkVerdict(file: { name: string; path?: string; sizeBytes?: number; sha256?: string; md5?: string }): JunkVerdict {
  const name = file.name.trim();
  const path = (file.path ?? "").replace(/\\/g, "/");
  if (name.startsWith("._")) return { disposition: "junk", reason: "AppleDouble resource fork (._*)" };
  if (JUNK_NAMES.test(name) || name === "Icon\r" || name === "Icon") return { disposition: "junk", reason: "Operating-system metadata file" };
  if (JUNK_SEGMENTS.test(path) || JUNK_SEGMENTS.test(`/${name}/`)) return { disposition: "junk", reason: "Operating-system or device metadata folder" };
  if (LOCK_OR_TEMP.test(name)) return { disposition: "junk", reason: "Office lock, temporary, partial download or shortcut file" };
  if (file.sizeBytes === 0) return { disposition: "junk", reason: "Zero-byte file" };
  if (file.sha256 === EMPTY_SHA256 || file.md5 === EMPTY_MD5) return { disposition: "junk", reason: "Empty content (hash of zero bytes): failed download or empty file" };
  if (EXECUTABLE.test(name)) return { disposition: "excluded", reason: "Executable or installer" };
  if (FONT.test(name)) return { disposition: "excluded", reason: "Font file" };
  if (DESIGN.test(name)) return { disposition: "catalogue", reason: "Design source file (catalogued, not extracted)" };
  if (MEDIA.test(name)) return { disposition: "catalogue", reason: "Image, audio or video (catalogued; OCR or transcription is a separate step)" };
  if (ARCHIVE.test(name)) return { disposition: "catalogue", reason: "Archive (expand and re-run intake on its contents)" };
  return { disposition: "keep" };
}

/** True for a hash that must never be used to group files as duplicates. */
export function isUsableContentHash(hash?: string | null): hash is string {
  return Boolean(hash && hash !== EMPTY_SHA256 && hash !== EMPTY_MD5 && /^[0-9a-f]{32,64}$/i.test(hash));
}
