import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ASSET_LABEL_TYPES } from "./assetUtils";

const BARCODE_OPTIONS: Record<string, { bcid: string; scale?: number; height?: number }> = {
  code128: { bcid: "code128", scale: 3, height: 12 },
  code39: { bcid: "code39", scale: 3, height: 12 },
  datamatrix: { bcid: "datamatrix", scale: 4 },
  pdf417: { bcid: "pdf417", scale: 2, height: 10 },
  ean13: { bcid: "ean13", scale: 3, height: 14 },
  upca: { bcid: "upca", scale: 3, height: 14 },
  itf14: { bcid: "itf14", scale: 3, height: 14 },
};

export function AssetQrLabel({
  assetTag,
  name,
  url,
  labelType = "qr",
}: {
  assetTag: string;
  name: string;
  url: string;
  labelType?: string;
}) {
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  const label = ASSET_LABEL_TYPES.find((type) => type.value === labelType) ?? ASSET_LABEL_TYPES[0];
  const encodedValue = labelType === "qr" || labelType === "datamatrix" || labelType === "pdf417" ? url : assetTag;

  useEffect(() => {
    let cancelled = false;
    setError("");
    setSrc("");

    if (labelType === "qr") {
      QRCode.toDataURL(url, { margin: 1, width: 128, errorCorrectionLevel: "M" })
        .then((value) => {
          if (!cancelled) setSrc(value);
        })
        .catch((err) => {
          if (!cancelled) setError(String(err?.message ?? err));
        });
    } else {
      const options = BARCODE_OPTIONS[labelType] ?? BARCODE_OPTIONS.code128;
      void import("bwip-js/browser").then((module) => {
        if (cancelled) return;
        const canvas = document.createElement("canvas");
        const bwipjs = module.default ?? module;
        bwipjs.toCanvas(canvas, {
          ...options,
          text: encodedValue,
          includetext: labelType === "code128" || labelType === "code39" || labelType === "ean13" || labelType === "upca" || labelType === "itf14",
          textxalign: "center",
          backgroundcolor: "FFFFFF",
        });
        if (!cancelled) setSrc(canvas.toDataURL("image/png"));
      }).catch((err: any) => {
        if (!cancelled) setError(String(err?.message ?? err));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [assetTag, encodedValue, labelType, url]);

  return (
    <div className={`asset-label${labelType === "qr" || labelType === "datamatrix" ? "" : " asset-label--wide"}`} aria-label={`${label.label} label for ${assetTag}`}>
      <div className="asset-label__qr">
        {src ? <img src={src} alt="" /> : <span className="mono">{label.label}</span>}
      </div>
      <div className="asset-label__body">
        <strong>{assetTag}</strong>
        <span>{name}</span>
        <small>{label.label} · {label.payload}</small>
        <small>{encodedValue}</small>
        {error && <small className="asset-label__error">{error}</small>}
      </div>
    </div>
  );
}
