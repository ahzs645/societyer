/**
 * Camera-based asset scanner. Wraps html5-qrcode to read a QR/barcode from the
 * device camera (works on mobile Safari/Chrome and desktop webcams) and hands
 * the decoded text back to the caller, which resolves it to an asset.
 *
 * A manual-entry box is always shown as a fallback for devices without a
 * camera, when permission is denied, or when a code won't scan cleanly.
 */
import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Modal } from "../../components/Modal";
import { Field } from "../../components/ui";

const SCANNER_ELEMENT_ID = "asset-scanner-region";

export function AssetScanner({
  open,
  onClose,
  onDetected,
  title = "Scan asset",
  hint = "Point the camera at an asset's QR code or barcode.",
  continuous = false,
}: {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
  title?: string;
  hint?: string;
  /** Keep the camera running after a hit so several codes can be scanned in a
   * row (e.g. a verification sweep). Defaults to single-shot. */
  continuous?: boolean;
}) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  // Last code handled + its timestamp, so the same code held in frame (which
  // decodes many times per second) only fires once per cooldown window.
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  useEffect(() => {
    if (!open) return;
    lastRef.current = { code: "", at: 0 };
    setCameraError(null);
    let cancelled = false;

    const start = async () => {
      try {
        const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID, { verbose: false });
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (decodedText) => {
            const now = Date.now();
            const last = lastRef.current;
            // Ignore the same code within a 2.5s cooldown. In single-shot mode
            // ignore everything after the first hit until the modal reopens.
            if (decodedText === last.code && now - last.at < 2500) return;
            if (!continuous && last.at !== 0) return;
            lastRef.current = { code: decodedText, at: now };
            onDetected(decodedText);
          },
          () => {
            // Per-frame decode failures are normal; ignore them.
          },
        );
      } catch (error: any) {
        if (!cancelled) {
          setCameraError(
            error?.message?.includes("Permission") || error?.name === "NotAllowedError"
              ? "Camera access was blocked. Enter the asset tag below instead."
              : "No camera available. Enter the asset tag below instead.",
          );
        }
      }
    };
    void start();

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner) {
        scanner
          .stop()
          .catch(() => {})
          .finally(() => {
            try {
              scanner.clear();
            } catch {
              // already torn down
            }
          });
      }
    };
  }, [open, onDetected]);

  const submitManual = () => {
    const code = manual.trim();
    if (!code) return;
    lastRef.current = { code, at: Date.now() };
    onDetected(code);
    setManual("");
  };

  return (
    <Modal open={open} onClose={onClose} title={title} size="md">
      <p className="muted" style={{ marginTop: 0 }}>{hint}</p>
      <div
        id={SCANNER_ELEMENT_ID}
        style={{
          width: "100%",
          minHeight: cameraError ? 0 : 240,
          borderRadius: 8,
          overflow: "hidden",
          background: "var(--bg-subtle, #11151c)",
        }}
      />
      {cameraError && <p className="muted">{cameraError}</p>}
      <Field label="Asset tag or code" hint="Type or paste a code if the camera can't read it.">
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            value={manual}
            placeholder="AST-0001"
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitManual();
            }}
          />
          <button className="btn btn--accent" onClick={submitManual} disabled={!manual.trim()}>
            Look up
          </button>
        </div>
      </Field>
    </Modal>
  );
}
