// pdf.js ships no type declarations for its worker entry points.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
declare module "pdfjs-dist/build/pdf.worker.min.mjs?url" {
  const url: string;
  export default url;
}
