import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function AssetQrLabel({
  assetTag,
  name,
  url,
}: {
  assetTag: string;
  name: string;
  url: string;
}) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { margin: 1, width: 128, errorCorrectionLevel: "M" })
      .then((value) => {
        if (!cancelled) setSrc(value);
      })
      .catch(() => {
        if (!cancelled) setSrc("");
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div className="asset-label" aria-label={`QR label for ${assetTag}`}>
      <div className="asset-label__qr">
        {src ? <img src={src} alt="" /> : <span className="mono">QR</span>}
      </div>
      <div className="asset-label__body">
        <strong>{assetTag}</strong>
        <span>{name}</span>
        <small>{url}</small>
      </div>
    </div>
  );
}
