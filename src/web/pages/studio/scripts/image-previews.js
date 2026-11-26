/* =========================================================
       浏览器端图片压缩
       ---------------------------------------------------------
       原片不做任何改写；Canvas 只额外生成最长边 2560px、质量 0.88
       的 WebP 高清压缩预览。它仍不是原片，游客也不会取得原片地址；较高
       分辨率用于避免电脑全屏登录背景把 1280px 旧预览放大后产生明显模糊。
       ========================================================= */
const PREVIEW_MAX_EDGE = 2560;
const PREVIEW_WEBP_QUALITY = 0.88;

async function decodeLocalImage(file) {
  if (isHeicPhoto(file)) file = await decodeHeicPhoto(file);
  // 新版浏览器优先使用 createImageBitmap，能正确读取大多数照片的 EXIF 方向。
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close?.()
      };
    } catch {
      /* Safari 的部分格式不支持 ImageBitmap，继续使用普通 Image。 */
    }
  }
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = objectUrl;
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("浏览器无法读取这张图片"));
    };
  });
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    close: () => URL.revokeObjectURL(objectUrl)
  };
}

async function createCompressedPreview(
  file,
  { maxEdge = PREVIEW_MAX_EDGE, quality = PREVIEW_WEBP_QUALITY } = {}
) {
  const decoded = await decodeLocalImage(file);
  let canvas;
  try {
    const scale = Math.min(1, maxEdge / Math.max(decoded.width, decoded.height));
    canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("浏览器无法建立图片压缩画布");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    if (!blob || blob.type !== "image/webp")
      throw new Error("当前浏览器不支持 WebP 预览压缩，请更新浏览器后重试");
    const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${baseName}-preview.webp`, { type: "image/webp" });
  } finally {
    decoded.close();
    if (canvas) canvas.width = canvas.height = 1;
  }
}

async function appendCompressedPreview(form, file, { required = false } = {}) {
  try {
    const preview = await createCompressedPreview(file);
    form.append("preview", preview, preview.name);
    form.append("mosaic", await createPhotoMosaic(preview), "mosaic.webp");
    return preview;
  } catch (error) {
    if (required) throw error;
    // 文章插图不因旧浏览器缺少 WebP 编码而阻断；图片专栏上传则要求预览成功。
    console.warn("Preview compression skipped", error);
    return null;
  }
}
