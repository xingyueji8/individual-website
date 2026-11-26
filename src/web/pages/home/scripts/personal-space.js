    /* ---------- 05. 动态个人空间：大板块、文章、相册与图片。 ---------- */
    function portfolioSections() {
      const configured = state.data?.sections;
      // 仅用于兼容浏览器中尚未失效的旧 bootstrap 缓存。
      const sections = Array.isArray(configured) ? [...configured] : [
        { id: "section-essays", name: "随笔", kind: "content", show_all: 1 },
        { id: "section-photos", name: "拍摄照片", kind: "gallery", show_all: 1 },
        { id: "section-guides", name: "北京旅行指南", kind: "content", show_all: 1 },
      ];
      return sections;
    }

    function contentBelongsToSection(item, section) {
      if (item.section_id) return item.section_id === section.id;
      if (section.id === "section-guides") return item.type === "guide";
      return section.id === "section-essays" && item.type !== "guide";
    }

    function contentCard(item, section) {
      const card = document.createElement("article"); card.className = "content-card"; card.tabIndex = 0; card.setAttribute("role", "button");
      const kind = document.createElement("span"); kind.className = "kind"; kind.textContent = section.name;
      const title = document.createElement("h3"); title.textContent = item.title;
      const timeLabels = contentTimeLabels(item);
      const times = document.createElement("div"); times.className = "content-time-lines";
      const published = document.createElement("span"); published.textContent = timeLabels.published;
      const updated = document.createElement("span"); updated.textContent = timeLabels.updated;
      times.append(published, updated);
      const excerpt = document.createElement("p"); excerpt.textContent = item.excerpt || "点击阅读全文";
      const meta = document.createElement("div"); meta.className = "card-meta";
      const reactions = document.createElement("span"); reactions.textContent = `👍 ${item.like_count} · 👎 ${item.dislike_count}`;
      const cover = personalSpaceArticleCover(item); if (cover) card.append(cover);
      meta.append(reactions); card.append(kind, title, times, excerpt, meta);
      const open = () => personalSpaceActivate(card, () => openContent(item.id));
      card.addEventListener("click", open);
      card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
      return card;
    }


    function renderPortfolioPanel() { renderOrganizedPanel(); }

    function renderPortfolio() { renderOrganizedPortfolio(); }
