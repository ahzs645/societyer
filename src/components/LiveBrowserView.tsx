import { useCallback, useEffect, useRef, useState } from "react";
import RFB from "@novnc/novnc/lib/rfb.js";
import { ClipboardPaste, MonitorPlay, WifiOff } from "lucide-react";

type LiveBrowserViewProps = {
  sessionId: string;
  webSocketUrl: string;
  onPasteText: (text: string) => Promise<void>;
};

export function LiveBrowserView({ sessionId, webSocketUrl, onPasteText }: LiveBrowserViewProps) {
  const targetRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<RFB | null>(null);
  const pasteInFlightRef = useRef(false);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [lastPasteCount, setLastPasteCount] = useState<number | null>(null);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    target.innerHTML = "";
    setStatus("connecting");
    const rfb = new RFB(target, webSocketUrl, { shared: true });
    rfb.scaleViewport = true;
    rfb.resizeSession = false;
    rfb.clipViewport = false;
    rfb.focusOnClick = true;
    rfb.background = "rgb(12, 12, 12)";
    rfbRef.current = rfb;

    const handleConnect = () => setStatus("connected");
    const handleDisconnect = () => setStatus("disconnected");
    rfb.addEventListener("connect", handleConnect);
    rfb.addEventListener("disconnect", handleDisconnect);

    return () => {
      rfb.removeEventListener("connect", handleConnect);
      rfb.removeEventListener("disconnect", handleDisconnect);
      rfb.disconnect();
      rfbRef.current = null;
      target.innerHTML = "";
    };
  }, [webSocketUrl]);

  const pasteText = useCallback(async (text: string) => {
    if (!text || pasteInFlightRef.current) return;
    pasteInFlightRef.current = true;
    try {
      rfbRef.current?.clipboardPasteFrom(text);
      await onPasteText(text);
      setLastPasteCount(text.length);
      rfbRef.current?.focus();
    } finally {
      pasteInFlightRef.current = false;
    }
  }, [onPasteText]);

  const readClipboardAndPaste = useCallback(async () => {
    const text = await navigator.clipboard.readText();
    await pasteText(text);
  }, [pasteText]);

  return (
    <div
      className="live-browser"
      tabIndex={0}
      onPasteCapture={(event) => {
        const text = event.clipboardData.getData("text/plain");
        if (!text) return;
        event.preventDefault();
        event.stopPropagation();
        void pasteText(text);
      }}
      onKeyDownCapture={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
          event.preventDefault();
          event.stopPropagation();
          void readClipboardAndPaste();
        }
      }}
      style={{
        position: "relative",
        minHeight: 720,
        background: "#0c0c0c",
        outline: "none",
      }}
    >
      <div
        ref={targetRef}
        style={{
          width: "100%",
          height: 720,
          overflow: "hidden",
        }}
      />
      <div
        className="row"
        style={{
          position: "absolute",
          left: 12,
          top: 12,
          gap: 8,
          padding: "6px 8px",
          borderRadius: 8,
          background: "rgba(0, 0, 0, 0.68)",
          color: "#fff",
          fontSize: 12,
          pointerEvents: "none",
        }}
      >
        {status === "connected" ? <MonitorPlay size={13} /> : <WifiOff size={13} />}
        <span>{status === "connected" ? "Live browser" : status}</span>
        <span className="mono" style={{ opacity: 0.75 }}>{sessionId.slice(0, 8)}</span>
      </div>
      <button
        className="btn btn--sm"
        type="button"
        onClick={readClipboardAndPaste}
        style={{
          position: "absolute",
          right: 12,
          top: 12,
          background: "rgba(255, 255, 255, 0.94)",
        }}
      >
        <ClipboardPaste size={12} /> Paste
      </button>
      {lastPasteCount !== null && (
        <div
          style={{
            position: "absolute",
            right: 12,
            top: 50,
            padding: "5px 8px",
            borderRadius: 8,
            background: "rgba(0, 0, 0, 0.68)",
            color: "#fff",
            fontSize: 12,
            pointerEvents: "none",
          }}
        >
          Pasted {lastPasteCount} chars
        </div>
      )}
    </div>
  );
}
