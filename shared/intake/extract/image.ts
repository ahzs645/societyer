/** Document images (a scanned letter, a signed form, a certificate photographed or scanned)
 * → OCR → the same positioned-text layout as a PDF page. */
import { finalizeBlocks, INTAKE_EXTRACT_VERSION, type IntakeExtract } from "../blocks";
import { itemsFromRecognition, MIN_DOCUMENT_IMAGE_CONFIDENCE, MIN_DOCUMENT_IMAGE_WORDS, ocrPageSummary, recognizeUpright, type OcrHost } from "./ocr";
import { layoutPages, linesFromItems } from "./pdf";

/** Images are recognised at their own resolution; this nominal DPI converts pixels to points. */
const IMAGE_DPI = 300;

function unsupported(reason: string): IntakeExtract {
  return { method: "unsupported", methodVersion: INTAKE_EXTRACT_VERSION, blocks: [], text: "", warnings: [reason] };
}

export async function extractImage(fileName: string, bytes: Uint8Array, ocr: OcrHost | undefined): Promise<IntakeExtract> {
  if (!ocr) return unsupported("Image (catalogued; OCR is not enabled in this runtime).");
  const maxPixels = ocr.maxPixels ?? 20_000_000;
  const decode = async (rotation: number, probe: boolean) => {
    const image = ocr.decodeImage ? await ocr.decodeImage(bytes, fileName, { rotation, maxPixels: probe ? Math.min(maxPixels, 2_500_000) : maxPixels }) : rotation === 0 ? { bytes, width: 0, height: 0 } : null;
    if (!image) throw new UnreadableImage(`This image format (${fileName.replace(/^.*\./, ".")}) cannot be decoded for OCR here.`);
    return image;
  };
  if (ocr.budget && !ocr.budget.take()) return unsupported(`Image not read: the run's OCR page budget (${ocr.budget.limit} pages) is used up.`);
  let read: Awaited<ReturnType<typeof recognizeUpright>>;
  try {
    read = await recognizeUpright(ocr.engine, decode);
  } catch (error) {
    if (error instanceof UnreadableImage) return unsupported(error.message);
    throw error;
  }
  const { recognition, rotation } = read;
  const pixelsPerPoint = IMAGE_DPI / 72;
  const summary = ocrPageSummary(recognition, { page: 1, rotation, dpi: IMAGE_DPI, keepLines: ocr.keepLineBoxes });
  // A photo, logo or poster yields a few words at best: it is not a document.
  if (summary.words < MIN_DOCUMENT_IMAGE_WORDS || summary.confidence < MIN_DOCUMENT_IMAGE_CONFIDENCE) {
    return { ...unsupported(`Image without readable document text (OCR found ${summary.words} word(s) at ${Math.round(summary.confidence * 100)}% confidence); catalogued as an image.`), ocr: { engine: ocr.engine.name, pages: [{ ...summary, lines: undefined }] } };
  }
  const { drafts } = layoutPages([{ pageNumber: 1, lines: linesFromItems(itemsFromRecognition(recognition, pixelsPerPoint)) }]);
  const { blocks, text } = finalizeBlocks(drafts);
  return {
    method: "ocr",
    methodVersion: `${INTAKE_EXTRACT_VERSION}+${ocr.engine.name}`,
    blocks,
    text,
    pageCount: 1,
    ocr: { engine: ocr.engine.name, pages: [summary] },
    warnings: [`OCR read this image (confidence ${Math.round(summary.confidence * 100)}%${rotation ? `; rotated ${rotation}°` : ""}).`],
  };
}

class UnreadableImage extends Error {}
