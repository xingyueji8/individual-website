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
          onProgress(++completed, images.length);
        } catch (error) {
          controller.abort();
          throw new Error(`第 ${index + 1} 张图片未能准备好：${error.message}`);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, images.length) }, worker));
  }
  globalThis.XYJArticlePdf = Object.freeze({ prepareImages });
})();
