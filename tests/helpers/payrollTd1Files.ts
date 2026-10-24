import { readFile } from "node:fs/promises";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
export async function officialTd1Fixture(form: "td1" | "td1bc") {
  const document = await pdfjs.getDocument({
    data: new Uint8Array(
      await readFile(`scripts/fixtures/payroll-td1/${form}-fill-26e.pdf`),
    ),
    enableXfa: false,
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
  const fields = Object.values(
    (await document.getFieldObjects()) ?? {},
  ).flat() as any[];
  for (const field of fields) {
    const isText = field.type === "text";
    if (
      isText &&
      new RegExp(`number${form === "td1" ? 13 : 11}_subform`).test(field.name)
    )
      document.annotationStorage.setValue(field.id, {
        value: form === "td1" ? "20,000.00" : "0",
      });
    if (/\.MoreThan_chk\[0\]$|\.More_than\[0\]$/.test(field.name))
      document.annotationStorage.setValue(field.id, {
        value: form === "td1bc",
      });
    if (/\.TotalIncome_chk\[0\]$/.test(field.name))
      document.annotationStorage.setValue(field.id, { value: false });
    if (/\.Subform2\[0\]\.Amount2\[0\]$/.test(field.name))
      document.annotationStorage.setValue(field.id, { value: "25.50" });
    if (/\.Subform2\[0\]\.Amount1\[0\]$/.test(field.name))
      document.annotationStorage.setValue(field.id, { value: "0" });
    if (isText && /Last_name/.test(field.name))
      document.annotationStorage.setValue(field.id, {
        value: "PRIVATE-SYNTHETIC-NAME",
      });
    if (/SIN_Comb\[0\]$/.test(field.name))
      document.annotationStorage.setValue(field.id, { value: "046454286" });
  }
  const bytes = await document.saveDocument();
  await document.destroy();
  return {
    name: `PRIVATE-SYNTHETIC-${form}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from(bytes),
  };
}
