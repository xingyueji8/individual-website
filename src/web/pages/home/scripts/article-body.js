    /*
     * 从正文图片地址中识别本站 R2 媒体编号。只有本站 /media/:id 图片才有
     * 可验证的“原片”概念；外部图片可以放大预览，但不会伪造下载地址。
     */
    function mediaIdFromUrl(source) {
      const value = String(source || "").trim();
      if (!value) return null;
      try {
        const url = new URL(value, location.href);
        if (url.origin !== location.origin) return null;
        return url.pathname.match(/^\/media\/([A-Za-z0-9_-]{1,80})$/)?.[1] || null;
      } catch {
        return null;
      }
    }

    /*
     * 只接受明确写出的 http:// 或 https:// 网址。这里不接受 javascript:、data:
     * 或带用户名/密码的伪装地址；同一校验同时用于自动识别、卡片渲染和最终
     * 确认跳转，避免只在某一个入口做检查而被绕过。
     */
    function safeArticleHttpUrl(value) {
      const source = String(value || "").trim();
      if (!/^https?:\/\//i.test(source) || source.length > 2048) return null;
      try {
        const url = new URL(source);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
        return url;
      } catch {
        return null;
      }
    }

    /* 中文或英文句号、逗号经常紧跟在网址后面，它们属于正文而不是网址。 */
    function trimArticleUrlPunctuation(value) {
      let linkText = String(value || "");
      const trailing = /[.,!?;:，。！？；：、》〉】｝）)\]\}]/u;
      while (linkText && trailing.test(linkText.slice(-1))) linkText = linkText.slice(0, -1);
      return linkText;
    }

    function prepareArticleAnchor(anchor, url, label = "") {
      anchor.href = url.href;
      anchor.dataset.articleUrl = url.href;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer external";
      anchor.referrerPolicy = "no-referrer";
      anchor.classList.add("article-smart-link");
      anchor.title = `确认后访问 ${url.hostname}`;
      if (label) anchor.textContent = label;
      return anchor;
    }

    /*
     * 把正文中的纯文本网址转换成安全链接。TreeWalker 只访问文字节点，并跳过
     * 已有链接、代码块和表单内容，因此不会破坏作者写好的 HTML 或代码示例。
     */
    function autoLinkArticleText(root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);

      textNodes.forEach((textNode) => {
        const parent = textNode.parentElement;
        if (!parent || parent.closest("a, code, pre, script, style, textarea, noscript")) return;
        const source = textNode.nodeValue || "";
        const matches = [];
        const urlPattern = /https?:\/\/[^\s<>"'`]+/giu;
        for (const match of source.matchAll(urlPattern)) {
          const linkText = trimArticleUrlPunctuation(match[0]);
          const url = safeArticleHttpUrl(linkText);
          if (url && linkText) matches.push({ index: match.index, raw: match[0], linkText, url });
        }
        if (!matches.length) return;

        const fragment = document.createDocumentFragment();
        let cursor = 0;
        matches.forEach((match) => {
          fragment.append(document.createTextNode(source.slice(cursor, match.index)));
          const anchor = prepareArticleAnchor(document.createElement("a"), match.url, match.linkText);
          anchor.dataset.articleAutoLink = "true";
          fragment.append(anchor);
          /* 未计入 linkText 的末尾标点会由下一段普通文字切片原样保留。 */
          cursor = match.index + match.linkText.length;
        });
        fragment.append(document.createTextNode(source.slice(cursor)));
        textNode.replaceWith(fragment);
      });
    }

    /*
     * 只有“整段仅一个网址”才提升为预览卡；句子中的网址仍保持行内链接。
     * 卡片只包含浏览器本地解析出的域名与标准地址，不请求外站元数据。
     */
    function promoteStandaloneArticleLinks(root) {
      root.querySelectorAll("p").forEach((paragraph) => {
        const directLinks = Array.from(paragraph.children).filter((child) => child.matches("a.article-smart-link"));
        if (directLinks.length !== 1 || paragraph.querySelectorAll("a.article-smart-link").length !== 1) return;
        const anchor = directLinks[0];
        if (!anchor.textContent.trim() || anchor.querySelector("img, picture, video, audio, svg")) return;
        /* 只有自动识别的纯网址或作者直接把网址作为链接文字时才升级为卡片。 */
        if (anchor.dataset.articleAutoLink !== "true" && !/^https?:\/\//i.test(anchor.textContent.trim())) return;
        const hasOtherContent = Array.from(paragraph.childNodes).some((node) => {
          if (node === anchor) return false;
          return node.nodeType !== Node.TEXT_NODE || Boolean(node.textContent.trim());
        });
        if (hasOtherContent) return;

        const url = safeArticleHttpUrl(anchor.dataset.articleUrl);
        if (!url) return;
        const icon = document.createElement("span"); icon.className = "article-link-icon"; icon.textContent = "↗";
        const copy = document.createElement("span"); copy.className = "article-link-copy";
        const label = document.createElement("span"); label.textContent = "外部链接";
        const host = document.createElement("strong"); host.textContent = url.hostname.replace(/^www\./i, "") || url.origin;
        const address = document.createElement("small"); address.textContent = url.href;
        copy.append(label, host, address);
        const action = document.createElement("span"); action.className = "article-link-action"; action.textContent = "确认后访问";
        anchor.classList.add("article-link-card");
        anchor.setAttribute("aria-label", `确认后访问外部网站 ${host.textContent}`);
        anchor.replaceChildren(icon, copy, action);
        paragraph.replaceWith(anchor);
      });
    }

    function enhanceArticleLinks(root) {
      /* Studio 已经插入的链接与自动识别出的纯文本网址使用同一套安全规则。 */
      root.querySelectorAll("a[href]").forEach((anchor) => {
        const url = safeArticleHttpUrl(anchor.getAttribute("href"));
        if (url) prepareArticleAnchor(anchor, url);
      });
      autoLinkArticleText(root);
      promoteStandaloneArticleLinks(root);
    }

    function showArticleLinkConfirmation(value) {
      const url = safeArticleHttpUrl(value);
      if (!url) return;
      document.getElementById("external-link-host").textContent = url.hostname.replace(/^www\./i, "") || url.origin;
      document.getElementById("external-link-address").textContent = url.href;
      document.getElementById("external-link-continue").href = url.href;
      const dialog = document.getElementById("external-link-dialog");
      if (!dialog.open) dialog.showModal();
    }

    /*
     * 安全地装载文章正文，并把正文中的图片接入与照片专栏相同的大图弹窗。
     * 旧文章可能保存的是 /media/:id 原片地址，所以在节点进入页面前统一改写为
     * ?preview=1；这样游客浏览正文时只会请求压缩预览，不会误取原片。
     */
    function renderReaderBody(html, { root = document.getElementById("reader-body"), content = state.currentContent } = {}) {
      const template = document.createElement("template");
      template.innerHTML = html || "<p>暂无正文。</p>";

      template.content.querySelectorAll("img").forEach((image) => {
        image.setAttribute("loading", "lazy");
        image.setAttribute("decoding", "async");
        const source = image.getAttribute("src") || "";
        const mediaId = mediaIdFromUrl(source);
        if (!mediaId) return;
        const previewUrl = new URL(source, location.href);
        previewUrl.searchParams.delete("download");
        previewUrl.searchParams.set("preview", "1");
        image.setAttribute("src", protectedMediaUrl(`${previewUrl.pathname}${previewUrl.search}${previewUrl.hash}`));
      });

      /*
       * Studio 插入正文的资源只有 type + id。公开页面从当前身份的 bootstrap
       * 中查找元数据并替换为真实卡片；无权访问或已删除的资源不会泄露名称。
       */
      template.content.querySelectorAll(".resource-embed[data-resource-type][data-resource-id]").forEach((placeholder) => {
        const type = placeholder.dataset.resourceType;
        const id = placeholder.dataset.resourceId;
        const item = type === "folder"
          ? null
          : (state.data?.articleAssets || []).find((asset) => asset.id === id && asset.status === "ready");
        const replacement = item
          ? (type === "folder" ? resourceCardForFolder(item) : resourceCardForAsset(item))
          : empty("该资源不存在，或当前账号没有访问权限。");
        placeholder.replaceWith(replacement);
      });

      root.replaceChildren(template.content);
      enhanceArticleLinks(root);
      enhanceReaderImages(root, { content });
    }

    function enhanceReaderImages(root, { content = state.currentContent } = {}) {
      const images = Array.from(root.querySelectorAll("img"));
      const photos = images.map((image, index) => {
        const source = image.getAttribute("src") || image.src;
        const mediaId = mediaIdFromUrl(source);
        const caption = String(image.getAttribute("alt") || image.getAttribute("title") || "").trim();
        const access = (content?.inlineMedia || []).find(item => item.id === mediaId);
        return {
          ...(access || {}), mediaId,
          // 同一张图片可能在一篇文章出现多次，因此预览序列使用“文章 + 位置”作为唯一编号。
          id: `reader-${content?.id || "content"}-${index}`,
          previewUrl: source,
          url: source,
          canDownload: Boolean(access?.canDownload),
          downloadUrl: access?.canDownload && mediaId ? `/media/${encodeURIComponent(mediaId)}?download=1` : "",
          caption,
        };
      });

      images.forEach((image, index) => {
        const photo = photos[index];
        image.classList.add("reader-inline-image");
        image.tabIndex = 0;
        image.setAttribute("role", "button");
        image.setAttribute("aria-label", photo.caption ? `查看图片：${photo.caption}` : "查看文章图片");
        if (!image.title) image.title = "点击放大查看";

        const openPreview = (event) => {
          event.preventDefault();
          event.stopPropagation();
          openImage(photo, photos);
        };
        image.addEventListener("click", openPreview);
        image.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          openPreview(event);
        });
      });
    }
