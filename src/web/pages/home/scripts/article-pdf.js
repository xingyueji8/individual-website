    /* ---------- 08. PDF：在浏览器内生成文件并直接下载，不再打开打印窗口。 ---------- */
    async function ensurePdfLibrary() {
      if (typeof window.html2pdf === "function") return;
      if (!state.pdfLibraryPromise) {
        /*
         * 一些浏览器扩展会拦截页面初次加载的工具脚本。此处从本站同源地址重新
         * 读取已经随项目部署的固定版本，并通过临时 Blob 执行，避免点击后失效。
         */
        state.pdfLibraryPromise = (async () => {
          const response = await fetch("/pdf-engine.js", { cache: "force-cache" });
          if (!response.ok) throw new Error(`PDF 组件读取失败（${response.status}）`);
          const source = await response.text();
          const objectUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
          try {
            await new Promise((resolve, reject) => {
              const script = document.createElement("script");
              script.src = objectUrl;
              script.onload = () => { script.remove(); resolve(); };
              script.onerror = () => { script.remove(); reject(new Error("PDF 组件执行失败")); };
              document.head.append(script);
            });
          } finally {
            URL.revokeObjectURL(objectUrl);
          }
          if (typeof window.html2pdf !== "function") throw new Error("PDF 组件未正确初始化");
        })().catch((error) => {
          state.pdfLibraryPromise = null;
          throw error;
        });
      }
      await state.pdfLibraryPromise;
    }

    function pdfFilename(title) {
      const safeTitle = String(title || "星月集文章")
        .normalize("NFKC")
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
      return `${safeTitle || "星月集文章"}.pdf`;
    }

    /*
     * jsPDF 自带字体通常不包含中文，直接调用 pdf.text("星月集") 会出现空白或乱码。
     * 因此先用浏览器 Canvas 把中文绘制成透明 PNG，再盖到 PDF 的每一页中央。
     */
    function createPdfWatermarkDataUrl() {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 420;
      const context = canvas.getContext("2d");
      if (!context) return "";
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate(-18 * Math.PI / 180);
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = '800 150px "Microsoft YaHei", "PingFang SC", sans-serif';
      context.fillStyle = "rgba(49, 191, 200, 0.13)";
      context.fillText("星月集", 0, 0);
      return canvas.toDataURL("image/png");
    }

    function applyPdfWatermark(pdf) {
      const watermark = createPdfWatermarkDataUrl();
      if (!watermark || !pdf?.internal) return;
      const pageCount = pdf.internal.getNumberOfPages();
      for (let page = 1; page <= pageCount; page += 1) {
        pdf.setPage(page);
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const watermarkWidth = Math.min(pageWidth * 0.72, 155);
        const watermarkHeight = watermarkWidth * (420 / 1200);
        pdf.addImage(
          watermark,
          "PNG",
          (pageWidth - watermarkWidth) / 2,
          (pageHeight - watermarkHeight) / 2,
          watermarkWidth,
          watermarkHeight,
          "xingyueji-watermark",
          "FAST",
        );
      }
    }

    async function downloadCurrentContentPdf(button) {
      // 前端隐藏只是界面层保护；这里再次校验，防止通过控制台直接调用函数。
      if (!state.currentContent?.canDownload) { showAuthLock("download"); return; }
      if (!state.currentContent || state.pdfDownloading) return;

      const contentId = state.currentContent.id;
      const originalLabel = button.textContent;
      let exportRoot = null;
      state.pdfDownloading = true;
      document.querySelectorAll("#reader-print, #content-pdf").forEach((item) => { item.disabled = true; });
      button.dataset.pdfError = "";
      button.textContent = "确认下载权限…";

      try {
        const exportContent = await api(`/api/content/${encodeURIComponent(contentId)}?download=1`);
        // 只复制文章信息和正文；评论、点赞按钮及弹窗工具栏不会进入下载文件。
        exportRoot = document.createElement("article");
        exportRoot.className = "pdf-export";

        const kind = document.createElement("p");
        kind.className = "pdf-kind";
        kind.textContent = exportContent.section_name || (exportContent.type === "guide" ? "北京旅行指南" : "文章");

        const title = document.createElement("h1");
        title.textContent = exportContent.title || "未命名文章";

        const meta = document.createElement("p");
        meta.className = "pdf-meta";
        const timeLabels = contentTimeLabels(exportContent);
        meta.textContent = `${timeLabels.published}\n${timeLabels.updated}`;

        // Use the freshly authorised body, not a lazy/partially loaded reader copy.
        const body = document.createElement("div");
        body.className = "reader-body pdf-body";
        body.innerHTML = exportContent.body_html || "<p>暂无正文。</p>";
        enhanceArticleLinks(body);
        // PDF permission does not silently export separately protected images.
        body.querySelectorAll("img").forEach(image => {
          const mediaId = image.dataset.mediaId || mediaIdFromUrl(image.getAttribute("src"));
          if (mediaId && !(exportContent.inlineMedia || []).some(item => item.id === mediaId && item.canDownload && !item.locked)) {
            const placeholder = document.createElement("p"); placeholder.textContent = "此图片未开放下载"; image.replaceWith(placeholder);
          } else if (mediaId) {
            const source = new URL(image.getAttribute("src"), location.href);
            source.searchParams.delete("download"); source.searchParams.set("preview", "1");
            image.src = protectedMediaUrl(`${source.pathname}${source.search}`);
          }
        });
        body.querySelectorAll("video,audio,iframe,.resource-card,.resource-embed").forEach(item => item.remove());
        exportRoot.append(kind, title, meta, body);
        const { chooseImageRatio, prepareImages, render } = globalThis.XYJArticlePdf;
        if (state.currentContent?.id !== contentId || !state.currentContent.canDownload) return;
        const imageRatio = await chooseImageRatio(exportRoot);
        if (imageRatio === null || state.currentContent?.id !== contentId || !state.currentContent.canDownload) return;
        button.textContent = "加载组件…";
        await ensurePdfLibrary();

        await prepareImages(exportRoot, { imageRatio, onProgress: (done, total) => { button.textContent = `准备图片 ${done}/${total}…`; } });
        document.body.append(exportRoot);
        button.textContent = "生成中…";
        const pdf = await render(exportRoot, {
          margin: [12, 12, 14, 12],
          filename: pdfFilename(exportContent.title),
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["css", "legacy"], avoid: ["img", "pre", "blockquote", "table"] },
        }, { imageRatio, onProgress: (page, total) => { button.textContent = `生成第 ${page}/${total} 页…`; } });

        applyPdfWatermark(pdf);
        await api(`/api/content/${encodeURIComponent(contentId)}?download=1`);
        await pdf.save(pdfFilename(exportContent.title));
        return true;
      } catch (error) {
        console.error("PDF download failed", error);
        button.dataset.pdfError = error.message || "未知错误";
        alert(`PDF 生成失败：${button.dataset.pdfError}。请刷新页面后重试。`);
      } finally {
        exportRoot?.remove();
        state.pdfDownloading = false;
        document.querySelectorAll("#reader-print, #content-pdf").forEach((item) => { item.disabled = false; });
        button.textContent = originalLabel;
      }
    }
