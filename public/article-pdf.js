/* Prepare an export-only image copy before html2pdf clones the document.
 * Embedded data URLs keep off-screen/lazy images in the PDF and avoid a second
 * media request while the canvas is being rendered. Callers enforce access. */
(() => {
  "use strict";
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
  async function prepareImages(root, { timeoutMs = 25000, onProgress = () => {} } = {}) {
    const images = [...root.querySelectorAll("img")], resources = new Map();
    const controller = new AbortController();
    let next = 0, completed = 0;
    function load(source) {
      if (!resources.has(source)) resources.set(source, deadline((async () => {
        if (/^data:image\//i.test(source)) return source;
        const response = await fetch(source, { credentials: "same-origin", referrerPolicy: "no-referrer", signal: controller.signal });
        if (!response.ok) throw new Error(`图片读取失败（${response.status}）`);
        const blob = await response.blob();
        if (!blob.size || !blob.type.startsWith("image/")) throw new Error("图片文件格式无效");
        return dataUrl(blob);
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
          image.src = await load(source);
          await decode(image, timeoutMs);
          // Reserve the decoded aspect ratio before html2pdf clones the image.
          if (image.naturalWidth > 0 && image.naturalHeight > 0) {
            image.setAttribute("width", String(image.naturalWidth));
            image.setAttribute("height", String(image.naturalHeight));
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
  async function render(root, options, { onProgress = () => {}, onCanvas = () => {} } = {}) {
    const engine = globalThis.html2pdf;
    if (typeof engine !== "function") throw new Error("PDF 组件尚未加载");
    const layout = engine().set(options);
    const size = await layout.get("pageSize");
    const pageHeight = size.inner.px.height;
    root.style.width = `${size.inner.width}${size.unit}`;
    root.style.maxWidth = "none"; root.style.boxSizing = "border-box";
    root.querySelectorAll("img").forEach(image => {
      image.style.maxWidth = "100%"; image.style.maxHeight = `${Math.max(1, pageHeight - 128)}px`;
      image.style.width = "auto"; image.style.height = "auto"; image.style.objectFit = "contain";
    });
    let overlay, pdf, ink = false;
    try {
      const container = await layout.from(root).toContainer().get("container");
      overlay = await layout.get("overlay");
      const height = Math.max(container.scrollHeight, Math.ceil(container.getBoundingClientRect().height));
      const pages = Math.max(1, Math.ceil(height / pageHeight));
      const bounds = container.getBoundingClientRect(), units = 72 / 96 / size.k;
      const links = [];
      if (options.enableLinks !== false) container.querySelectorAll("a[href]").forEach(anchor => {
        for (const rect of anchor.getClientRects()) links.push({
          url: anchor.href, page: Math.floor((rect.top - bounds.top) / pageHeight) + 1,
          x: (rect.left - bounds.left) * units + layout.opt.margin[1],
          y: ((rect.top - bounds.top) % pageHeight) * units + layout.opt.margin[0],
          width: rect.width * units, height: rect.height * units,
        });
      });
      for (let page = 0; page < pages; page++) {
        if (!overlay.isConnected) document.body.append(overlay);
        const capture = engine().set({
          ...options, container, overlay,
          html2canvas: {
            ...options.html2canvas,
            // Never allocate one canvas for the complete article: large image
            // articles exceed browser canvas limits, especially on phones.
            x: 0, y: page * pageHeight, height: Math.min(pageHeight, height - page * pageHeight),
            scrollX: 0, scrollY: 0, windowWidth: Math.max(1024, size.inner.px.width),
          },
        });
        const canvas = await capture.toCanvas().get("canvas");
        try {
          const visible = hasInk(canvas); ink = visible || ink;
          onCanvas(canvas, page + 1, pages, visible);
          if (pdf) pdf.addPage();
          pdf = await engine().set({ ...options, enableLinks: false, pdf }).from(canvas).toPdf().get("pdf");
        } finally {
          canvas.width = canvas.height = 0;
        }
        onProgress(page + 1, pages);
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
  globalThis.XYJArticlePdf = Object.freeze({ prepareImages, render });
})();
