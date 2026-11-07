/* One photo per short-lived worker; large bitmaps never block the UI thread. */
self.onmessage = async ({ data: { file, thumbnail } }) => {
  let bitmap, canvas;
  try {
    if (typeof OffscreenCanvas !== "function" || typeof createImageBitmap !== "function") { self.postMessage({ unsupported: true }); return; }
    bitmap = await createImageBitmap(file, thumbnail
      ? { imageOrientation: "from-image", resizeWidth: 320, resizeQuality: "low" }
      : { imageOrientation: "from-image" });
    const maxEdge = thumbnail ? 320 : 2560;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close(); bitmap = null;
    const preview = await canvas.convertToBlob({ type: "image/webp", quality: thumbnail ? .65 : .88 });
    if (preview.type !== "image/webp") throw new Error("WebP encoding is unavailable");
    let mosaic = null;
    if (!thumbnail) {
      const small = new OffscreenCanvas(8, 8); small.getContext("2d").drawImage(canvas, 0, 0, 8, 8);
      mosaic = await small.convertToBlob({ type: "image/webp", quality: .6 });
      small.width = small.height = 1;
    }
    self.postMessage({ preview, mosaic });
  } catch { self.postMessage({ unsupported: true }); }
  finally { bitmap?.close(); if (canvas) canvas.width = canvas.height = 1; }
};
