import { Image, View } from "@formepdf/react";
import { documentImageDimensions } from "../../../shared/documentRichContent";
import type { DocumentBackground } from "../../../shared/invoiceCommerce";
/** Passive artwork with real dimensions, independent opacity and containment/cropping. */
export function DocumentArtworkPdf({ background, width, height }: { background: DocumentBackground; width: number; height: number }) {
  if (!background.image) return null;
  const dimensions = documentImageDimensions(background.image), scale = background.fit === "cover" ? Math.max(width / dimensions.width, height / dimensions.height) : Math.min(width / dimensions.width, height / dimensions.height);
  const imageWidth = background.fit === "stretch" ? width : dimensions.width * scale, imageHeight = background.fit === "stretch" ? height : dimensions.height * scale;
  const x = background.position.includes("left") ? 0 : background.position.includes("right") ? width - imageWidth : (width - imageWidth) / 2;
  const y = background.position.includes("top") ? 0 : background.position.includes("bottom") ? height - imageHeight : (height - imageHeight) / 2;
  return <View style={{ position: "absolute", left: 0, top: 0, width, height, overflow: "hidden", opacity: background.opacity }}><Image src={background.image} width={imageWidth} height={imageHeight} style={{ position: "absolute", left: x, top: y }} /></View>;
}
