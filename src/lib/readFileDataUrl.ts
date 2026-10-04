/** Inline image storage for browser and desktop local workspaces. */
export function readFileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image."));
    reader.onabort = () => reject(new Error("Image read was cancelled."));
    reader.readAsDataURL(file);
  });
}
