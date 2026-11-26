/* Prepare an export-only image copy before html2pdf clones the document.
 * Embedded data URLs keep off-screen/lazy images in the PDF and avoid a second
 * media request while the canvas is being rendered. Callers enforce access. */
(() => {
  "use strict";
  const presets = new Map([
    [1, { scale: 2, jpegQuality: .98, pages: 1 }],
    [.75, { scale: 1.7, jpegQuality: .93, pages: 1 }],
    [.5, { scale: 1.4, jpegQuality: .89, pages: 2 }],
    [.25, { scale: 1.1, jpegQuality: .86, pages: 3 }],
  ]);
  let lastImageRatio = .5;
  async function chooseImageRatio(root) {
    if (!root.querySelector("img")) return 1;
    const dialog = document.createElement("dialog");
    dialog.className = "pdf-options-dialog";
    dialog.setAttribute("aria-labelledby", "pdf-options-title");
    dialog.setAttribute("aria-describedby", "pdf-options-hint");
    dialog.innerHTML = `
      <form class="pdf-options-form">
        <h2 id="pdf-options-title">PDF 图片清晰度</h2>
        <label for="pdf-image-ratio">保留图片尺寸</label>
        <select id="pdf-image-ratio" autofocus>
          <option value="1">100% · 保留清晰度</option>
          <option value="0.75">75% · 轻度压缩</option>
          <option value="0.5">50% · 均衡（推荐）</option>
          <option value="0.25">25% · 快速导出</option>
        </select>
        <p id="pdf-options-hint">比例按图片宽、高计算，排版大小不变。压缩档通常生成更快、文件更小，图片和小字的细节也会减少。</p>
        <div class="pdf-options-actions">
          <button class="btn ghost" type="button">取消</button>
          <button class="btn" type="submit">生成 PDF</button>
        </div>
      </form>`;
    const select = dialog.querySelector("select");
    select.value = String(lastImageRatio);
    let chosen = null;
    try {
      return await new Promise((resolve, reject) => {
        dialog.addEventListener("close", () => resolve(chosen), { once: true });
        dialog.querySelector('button[type="button"]').addEventListener("click", () => dialog.close());
        dialog.querySelector("form").addEventListener("submit", event => {
          event.preventDefault();
          const value = Number(select.value);
          lastImageRatio = chosen = presets.has(value) ? value : .5;
          dialog.close();
        });
        document.body.append(dialog);
        try { dialog.showModal(); }
        catch (error) { reject(error); }
      });
    } finally {
      dialog.remove();
    }
  }
  function deadline(promise, timeoutMs, message) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    })]).finally(() => clearTimeout(timer));
  }
  function dataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("图片文件读取失败"));
      reader.readAsDataURL(blob);
    });
  }
  async function decode(image, timeoutMs) {
    if (typeof image.decode === "function") {
      await deadline(image.decode(), timeoutMs, "图片解码超时");
      return;
    }
    await new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => {
        clearTimeout(timer); image.removeEventListener("load", loaded); image.removeEventListener("error", failed);
      };
      const loaded = () => { cleanup(); image.naturalWidth > 0 ? resolve() : reject(new Error("图片内容无效")); };
      const failed = () => { cleanup(); reject(new Error("图片无法解码")); };
      image.addEventListener("load", loaded); image.addEventListener("error", failed);
      timer = setTimeout(() => { cleanup(); reject(new Error("图片加载超时")); }, timeoutMs);
      if (image.complete) loaded();
    });
  }
  async function resizeForExport(url, ratio, timeoutMs, signal) {
    const image = document.createElement("img");
    image.setAttribute("loading", "eager"); image.setAttribute("decoding", "sync");
    image.src = url;
    try {
      await decode(image, timeoutMs);
      if (signal.aborted) throw new Error("图片准备已停止");
      const width = image.naturalWidth, height = image.naturalHeight;
      if (!width || !height) throw new Error("图片尺寸无效");
      // Keep even unusually large, externally hosted sources within a small
      // bitmap budget. Ordinary site previews are resized by the chosen ratio.
      const scale = Math.min(ratio, 1800 / Math.max(width, height));
      const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
      if (w === width && h === height) return { url, width, height };
      const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
      try {
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法创建图片压缩画布");
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 0, 0, w, h);
        // WebP keeps transparency, with the browser's PNG fallback. JPEG
        // sources are already opaque and can stay JPEG.
        const type = /^data:image\/jpeg[;,]/i.test(url) ? "image/jpeg" : "image/webp";
        const resized = canvas.toDataURL(type, .86);
        if (!resized.startsWith("data:image/")) throw new Error("图片压缩失败");
        return { url: resized, width, height };
      } finally {
        canvas.width = canvas.height = 0;
      }
    } finally {
      image.removeAttribute("src");
    }
  }
  async function prepareImages(root, { imageRatio = 1, timeoutMs = 25000, onProgress = () => {} } = {}) {
    if (!presets.has(imageRatio)) imageRatio = 1;
    const images = [...root.querySelectorAll("img")], resources = new Map();
    const controller = new AbortController();
    let next = 0, completed = 0;
    function load(source) {
      if (!resources.has(source)) resources.set(source, deadline((async () => {
        let url = source;
        if (!/^data:image\//i.test(source)) {
          const response = await fetch(source, { credentials: "same-origin", referrerPolicy: "no-referrer", signal: controller.signal });
          if (!response.ok) throw new Error(`图片读取失败（${response.status}）`);
          const blob = await response.blob();
          if (!blob.size || !blob.type.startsWith("image/")) throw new Error("图片文件格式无效");
          url = await dataUrl(blob);
        }
        return imageRatio < 1 ? resizeForExport(url, imageRatio, timeoutMs, controller.signal) : { url };
      })(), timeoutMs, "图片读取超时"));
      return resources.get(source);
    }
    async function worker() {
      while (next < images.length && !controller.signal.aborted) {
        const index = next++, image = images[index];
        try {
          const source = image.getAttribute("src");
          if (!source) throw new Error("缺少图片地址");
          image.setAttribute("loading", "eager"); image.setAttribute("decoding", "sync");
          image.removeAttribute("srcset");
          const prepared = await load(source);
          if (controller.signal.aborted) return;
          image.src = prepared.url;
          await decode(image, timeoutMs);
          // The printed box uses the source dimensions, even if its pixels
          // were downsampled. This keeps page breaks the same in every mode.
          const width = prepared.width || image.naturalWidth, height = prepared.height || image.naturalHeight;
          if (width > 0 && height > 0) {
            image.setAttribute("width", String(width));
            image.setAttribute("height", String(height));
          }
          onProgress(++completed, images.length);
        } catch (error) {
          controller.abort();
          throw new Error(`第 ${index + 1} 张图片未能准备好：${error.message}`);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, images.length) }, worker));
  }
  function hasInk(canvas) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context || !canvas.width || !canvas.height) throw new Error("PDF 页面画布创建失败");
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < pixels.length; i += 16) {
      if (pixels[i + 3] && Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 245) return true;
    }
    return false;
  }
  async function render(root, options, { imageRatio = 1, onProgress = () => {}, onCanvas } = {}) {
    const engine = globalThis.html2pdf;
    if (typeof engine !== "function") throw new Error("PDF 组件尚未加载");
    const layout = engine().set(options);
    const size = await layout.get("pageSize");
    const pageHeight = size.inner.px.height, preset = presets.get(imageRatio) || presets.get(1);
    const scale = Math.min(options.html2canvas?.scale || 2, preset.scale);
    root.style.width = `${size.inner.width}${size.unit}`;
    root.style.maxWidth = "none"; root.style.boxSizing = "border-box";
    root.querySelectorAll("img").forEach(image => {
      const heightLimit = Math.max(1, pageHeight - 128);
      const width = Number(image.getAttribute("width")), height = Number(image.getAttribute("height"));
      image.style.maxWidth = "100%"; image.style.maxHeight = `${heightLimit}px`;
      image.style.width = width && height ? `${Math.min(width, width * heightLimit / height)}px` : "auto";
      image.style.height = "auto"; image.style.objectFit = "contain";
      if (width && height) image.style.aspectRatio = `${width} / ${height}`;
    });
    let overlay, pdf, ink = false;
    try {
      const container = await layout.from(root).toContainer().get("container");
      overlay = await layout.get("overlay");
      const height = Math.max(container.scrollHeight, Math.ceil(container.getBoundingClientRect().height));
      const pages = Math.max(1, Math.ceil(height / pageHeight));
      const bounds = container.getBoundingClientRect(), units = 72 / 96 / size.k;
      // Lower-resolution modes can capture several pages at once without
      // exceeding the pixel budget of the previous single-page renderer.
      const pagePixels = Math.ceil(bounds.width * scale) * Math.ceil(pageHeight * scale);
      const batchSize = Math.max(1, Math.min(preset.pages, Math.floor(3_000_000 / pagePixels)));
      const links = [];
      if (options.enableLinks !== false) container.querySelectorAll("a[href]").forEach(anchor => {
        for (const rect of anchor.getClientRects()) links.push({
          url: anchor.href, page: Math.floor((rect.top - bounds.top) / pageHeight) + 1,
          x: (rect.left - bounds.left) * units + layout.opt.margin[1],
          y: ((rect.top - bounds.top) % pageHeight) * units + layout.opt.margin[0],
          width: rect.width * units, height: rect.height * units,
        });
      });
      for (let start = 0; start < pages; start += batchSize) {
        if (!overlay.isConnected) document.body.append(overlay);
        const count = Math.min(batchSize, pages - start), top = start * pageHeight;
        const capture = engine().set({
          ...options, container, overlay,
          html2canvas: {
            ...options.html2canvas,
            // Never allocate one canvas for the complete article: large image
            // articles exceed browser canvas limits, especially on phones.
            scale, x: 0, y: top, height: Math.min(count * pageHeight, height - top),
            scrollX: 0, scrollY: 0, windowWidth: Math.max(1024, size.inner.px.width),
            ignoreElements: element => (
              element.parentNode === document.body && element !== overlay && !["STYLE", "LINK"].includes(element.tagName)
            ) || options.html2canvas?.ignoreElements?.(element),
          },
        });
        const canvas = await capture.toCanvas().get("canvas");
        try {
          if (!canvas.width || !canvas.height) throw new Error("PDF 页面画布创建失败");
          const maxPageHeight = Math.floor(canvas.width * (size.inner.height / size.inner.width));
          for (let page = 0; page < count; page++) {
            const firstRow = Math.floor(page * pageHeight * scale);
            const rows = Math.min(canvas.height, Math.floor((page + 1) * pageHeight * scale)) - firstRow;
            if (rows <= 0) throw new Error("PDF 页面范围无效");
            const part = count === 1 && rows <= maxPageHeight ? canvas : document.createElement("canvas");
            try {
              if (part !== canvas) {
                part.width = canvas.width; part.height = Math.min(rows, maxPageHeight);
                const context = part.getContext("2d");
                if (!context) throw new Error("无法创建 PDF 页面");
                context.drawImage(canvas, 0, firstRow, canvas.width, rows, 0, 0, part.width, part.height);
              }
              const visible = (!ink || onCanvas) ? hasInk(part) : true;
              ink ||= visible;
              onCanvas?.(part, start + page + 1, pages, visible);
              if (pdf) pdf.addPage();
              pdf = await engine().set({
                ...options, image: { ...options.image, quality: preset.jpegQuality }, enableLinks: false, pdf,
              }).from(part).toPdf().get("pdf");
            } finally {
              if (part !== canvas) part.width = part.height = 0;
            }
            onProgress(start + page + 1, pages);
          }
        } finally {
          canvas.width = canvas.height = 0;
        }
      }
      if (!ink) throw new Error("PDF 渲染结果为空，已停止下载，请重试或联系站长");
      for (const link of links) {
        pdf.setPage(link.page); pdf.link(link.x, link.y, link.width, link.height, { url: link.url });
      }
      pdf.setPage(pdf.internal.getNumberOfPages());
      return pdf;
    } finally {
      overlay?.remove();
    }
  }
  globalThis.XYJArticlePdf = Object.freeze({ chooseImageRatio, prepareImages, render });
})();
