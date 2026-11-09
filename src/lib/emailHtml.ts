/**
 * Turns an email's HTML body into a self-contained `srcdoc` for a sandboxed
 * iframe. The iframe is the real security boundary (no scripts, no forms, no
 * top navigation); this pass is defence in depth and privacy:
 *  - scripts, frames, plugins, forms and <base>/<meta>/<link> are dropped,
 *    as are inline event handlers and script: URLs;
 *  - `cid:` images are swapped for data: URLs built from the email's own parts;
 *  - remote images stay blocked (tracking pixels) unless the reader opts in,
 *    enforced by a CSP inside the frame, not just by rewriting attributes;
 *  - links open in a new tab without a referrer.
 */

const DROP_ELEMENTS = "script, iframe, frame, frameset, object, embed, applet, portal, form, base, meta, link, template";
const URL_ATTRIBUTES = ["href", "src", "action", "formaction", "background", "poster", "xlink:href", "srcset"];
const UNSAFE_URL = /^\s*(?:javascript|vbscript|data:(?!image\/(?:png|jpe?g|gif|webp)[;,]))/i;
const REMOTE_URL = /^\s*(?:https?:)?\/\//i;

export type EmailHtmlDocument = { srcdoc: string; blockedRemoteImages: number };

export function buildEmailDocument(
  html: string,
  { inlineImages, allowRemoteImages }: { inlineImages: Map<string, string>; allowRemoteImages: boolean },
): EmailHtmlDocument {
  // DOMParser documents are inert: nothing here runs scripts or loads images.
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll(DROP_ELEMENTS).forEach((element) => element.remove());
  let blockedRemoteImages = 0;

  for (const element of Array.from(doc.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) element.removeAttribute(attribute.name);
      else if (URL_ATTRIBUTES.includes(name) && UNSAFE_URL.test(attribute.value)) element.removeAttribute(attribute.name);
    }
    const tag = element.tagName.toLowerCase();
    if (tag === "img" || element.hasAttribute("background")) {
      const attr = tag === "img" ? "src" : "background";
      const value = element.getAttribute(attr) ?? "";
      if (/^\s*cid:/i.test(value)) {
        const resolved = inlineImages.get(decodeCid(value));
        if (resolved) element.setAttribute(attr, resolved);
        else element.removeAttribute(attr);
      } else if (REMOTE_URL.test(value)) {
        if (!allowRemoteImages) {
          element.removeAttribute(attr);
          if (tag === "img") blockedRemoteImages += 1;
        }
      } else if (!/^\s*data:/i.test(value)) {
        // A relative path would resolve against the app, not the sender.
        element.removeAttribute(attr);
      }
      if (tag === "img" && !allowRemoteImages) element.removeAttribute("srcset");
    }
    if (tag === "a" && element.hasAttribute("href")) {
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
    }
  }

  const imgSrc = allowRemoteImages ? "data: https: http:" : "data:";
  const head = doc.head;
  head.insertAdjacentHTML(
    "afterbegin",
    `<meta charset="utf-8">`
      + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'">`
      + `<meta name="referrer" content="no-referrer">`
      + `<style>html{color-scheme:light}body{margin:0;padding:16px;background:#fff;color:#1f2328;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}</style>`,
  );
  return { srcdoc: `<!doctype html>${doc.documentElement.outerHTML}`, blockedRemoteImages };
}

/** Wraps a plain-text body so it renders in the same frame as HTML mail. */
export function plainTextEmailHtml(text: string) {
  const escaped = text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
  return `<pre style="font:inherit;margin:0">${escaped}</pre>`;
}

function decodeCid(value: string) {
  const raw = value.trim().replace(/^cid:/i, "");
  try {
    return decodeURIComponent(raw).replace(/^<|>$/g, "").toLowerCase();
  } catch {
    return raw.replace(/^<|>$/g, "").toLowerCase();
  }
}

export function bytesToDataUrl(bytes: ArrayBuffer, mimeType: string) {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let index = 0; index < view.length; index += 0x8000) {
    binary += String.fromCharCode(...view.subarray(index, index + 0x8000));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}
