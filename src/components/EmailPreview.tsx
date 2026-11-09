import { useEffect, useMemo, useRef, useState } from "react";
import { Download, ImageOff, Paperclip } from "lucide-react";
import type { EmailAttachmentPreview, EmailPreview as EmailPreviewData } from "../lib/emailReceipt";
import { buildEmailDocument, bytesToDataUrl, plainTextEmailHtml } from "../lib/emailHtml";
import { imageMimeType } from "../lib/filePreviewSignatures";
import { formatBytes } from "../lib/documentOpen";

function inlineImageMime(bytes: ArrayBuffer) {
  const known = imageMimeType(bytes);
  if (known) return known;
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 12));
  const ascii = String.fromCharCode(...head);
  return ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP" ? "image/webp" : undefined;
}

function formatDate(value: string | undefined) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Renders a parsed .eml the way a mail client would: header block, the HTML
 * body in a sandboxed frame (no scripts, remote images off until asked), and
 * the attachments as downloads.
 */
export function EmailPreview({ email }: { email: EmailPreviewData }) {
  const [allowRemoteImages, setAllowRemoteImages] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frameHeight, setFrameHeight] = useState(320);

  const inlineImages = useMemo(() => {
    const map = new Map<string, string>();
    for (const attachment of email.attachments) {
      if (!attachment.contentId) continue;
      const mime = inlineImageMime(attachment.bytes);
      if (mime) map.set(attachment.contentId, bytesToDataUrl(attachment.bytes, mime));
    }
    return map;
  }, [email.attachments]);

  const body = useMemo(() => {
    const html = email.html ?? (email.text ? plainTextEmailHtml(email.text) : "");
    if (!html) return null;
    return buildEmailDocument(html, { inlineImages, allowRemoteImages });
  }, [email.html, email.text, inlineImages, allowRemoteImages]);

  // The frame is same-origin but script-free, so the parent can measure it and
  // grow it to its content instead of nesting a second scrollbar.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !body) return;
    let observer: ResizeObserver | undefined;
    const measure = () => {
      const root = frame.contentDocument?.documentElement;
      if (root) setFrameHeight(Math.max(120, Math.ceil(root.scrollHeight)));
    };
    const onLoad = () => {
      measure();
      observer?.disconnect();
      const root = frame.contentDocument?.documentElement;
      if (root && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(measure);
        observer.observe(root);
      }
    };
    frame.addEventListener("load", onLoad);
    if (frame.contentDocument?.readyState === "complete" && frame.contentDocument.body?.childNodes.length) onLoad();
    return () => {
      frame.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [body]);

  const attachments = email.attachments.filter((attachment) => !(attachment.inline && attachment.contentId && inlineImages.has(attachment.contentId)));
  const headers: Array<[string, string | undefined]> = [
    ["From", email.from],
    ["To", email.to.join(", ") || undefined],
    ["Cc", email.cc.join(", ") || undefined],
    ["Date", formatDate(email.date)],
  ];

  return (
    <article className="email-preview" aria-label="Email preview">
      <header className="email-preview__head">
        <h3 className="email-preview__subject">{email.subject ?? "(no subject)"}</h3>
        <dl className="email-preview__headers">
          {headers.filter(([, value]) => value).map(([label, value]) => (
            <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      </header>
      {body && body.blockedRemoteImages > 0 && !allowRemoteImages && (
        <div className="email-preview__notice">
          <ImageOff size={13} aria-hidden />
          <span>{body.blockedRemoteImages} remote image{body.blockedRemoteImages === 1 ? "" : "s"} blocked to protect your privacy.</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAllowRemoteImages(true)}>Show images</button>
        </div>
      )}
      {body ? (
        <iframe
          ref={frameRef}
          className="email-preview__frame"
          title={email.subject ? `Email body: ${email.subject}` : "Email body"}
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          srcDoc={body.srcdoc}
          style={{ height: frameHeight }}
        />
      ) : (
        <p className="muted email-preview__empty">This email has no message body.</p>
      )}
      {attachments.length > 0 && (
        <section className="email-preview__attachments" aria-label="Attachments">
          <h4><Paperclip size={13} aria-hidden /> {attachments.length} attachment{attachments.length === 1 ? "" : "s"}</h4>
          <ul>
            {attachments.map((attachment, index) => <AttachmentRow key={`${attachment.filename}-${index}`} attachment={attachment} />)}
          </ul>
        </section>
      )}
    </article>
  );
}

function AttachmentRow({ attachment }: { attachment: EmailAttachmentPreview }) {
  const download = () => {
    // Always download as opaque bytes; the browser never renders the part inline.
    const url = URL.createObjectURL(new Blob([attachment.bytes], { type: "application/octet-stream" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = attachment.filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  return (
    <li>
      <span className="email-preview__attachment-name">{attachment.filename}</span>
      <span className="muted">{[attachment.mimeType, formatBytes(attachment.bytes.byteLength)].filter(Boolean).join(" · ")}</span>
      <button type="button" className="btn btn--ghost btn--sm" onClick={download} aria-label={`Download ${attachment.filename}`}>
        <Download size={12} aria-hidden /> Download
      </button>
    </li>
  );
}
