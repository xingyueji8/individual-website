    /* ---------- 08. 文章阅读器、点赞/点踩和评论回复。 ---------- */
    async function openContent(id) {
      if (!(await ensureContentUnlocked("content", {id}))) return;
      const dialog = document.getElementById("reader-dialog");
      state.currentContent = null;
      syncProtectedDownloadControls();
      document.getElementById("reader-title").textContent = "正在读取…";
      document.getElementById("reader-body").replaceChildren();
      dialog.showModal();
      try {
        const [content, commentsData] = await Promise.all([
          api(`/api/content/${encodeURIComponent(id)}`),
          api(`/api/comments?contentId=${encodeURIComponent(id)}`),
        ]);
        state.currentContent = content; state.comments = commentsData.comments || [];
        const sectionName = content.section_name || (content.type === "guide" ? "北京旅行指南" : "文章");
        document.getElementById("reader-kind").textContent = sectionName;
        document.getElementById("reader-title").textContent = content.title;
        const timeLabels = contentTimeLabels(content);
        const readerMeta = document.getElementById("reader-meta");
        const published = document.createElement("span"); published.textContent = timeLabels.published;
        const updated = document.createElement("span"); updated.textContent = timeLabels.updated;
        readerMeta.replaceChildren(published, updated);
        renderReaderBody(content.body_html);
        syncProtectedDownloadControls();
        document.querySelector("#content-like span").textContent = content.like_count;
        document.querySelector("#content-dislike span").textContent = content.dislike_count;
        renderComments();
      } catch (error) {
        document.getElementById("reader-title").textContent = "无法读取内容";
        document.getElementById("reader-body").textContent = error.message;
      }
    }

    async function sendReaction(targetType, targetId, value, button) {
      if (!state.auth.authenticated) { showAuthLock("account"); return; }
      try {
        button.disabled = true;
        const result = await api("/api/reactions", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetType, targetId, value, visitorId }),
        });
        if (targetType === "content") {
          document.querySelector("#content-like span").textContent = result.like_count;
          document.querySelector("#content-dislike span").textContent = result.dislike_count;
        } else {
          const comment = state.comments.find((item) => item.id === targetId);
          if (comment) { comment.like_count = result.like_count; comment.dislike_count = result.dislike_count; renderComments(); }
        }
      } catch (error) { alert(error.message); }
      finally { button.disabled = false; }
    }

    function commentNode(comment, isReply = false) {
      const wrap = document.createElement("article"); wrap.className = `comment${isReply ? " reply" : ""}`;
      const head = document.createElement("div"); head.className = "comment-head";
      const author = document.createElement("button"); author.type = "button"; author.className = "comment-author-button";
      author.dataset.userId = comment.author_user_id || "";
      author.disabled = !comment.author_user_id;
      author.title = comment.author_user_id ? `与 ${comment.guest_name} 私信` : "游客评论";
      const avatar = document.createElement("span"); avatar.className = "comment-avatar"; avatar.textContent = String(comment.guest_name || "访").slice(0, 1);
      const name = document.createElement("span"); name.className = "comment-name"; name.textContent = comment.guest_name;
      author.append(avatar, name);
      if (Number(comment.is_admin)) {
        const badge = document.createElement("span"); badge.className = "admin-badge"; badge.textContent = "站长"; author.append(badge);
      }
      if (Number(comment.is_pinned)) {
        const pinned = document.createElement("span"); pinned.className = "comment-pin-badge"; pinned.textContent = "置顶"; author.append(pinned);
      }
      const date = document.createElement("span"); date.className = "comment-date";
      date.textContent = `${isReply ? "回复于" : "评论于"} ${formatDateTime(comment.created_at) || "时间未知"}`;
      head.append(author, date);
      const body = document.createElement("div"); body.className = "comment-body"; body.textContent = comment.body;
      const actions = document.createElement("div"); actions.className = "comment-actions";
      const like = document.createElement("button"); like.className = "text-button"; like.textContent = `👍 ${comment.like_count}`;
      const dislike = document.createElement("button"); dislike.className = "text-button"; dislike.textContent = `👎 ${comment.dislike_count}`;
      if (state.auth.authenticated) {
        like.addEventListener("click", () => sendReaction("comment", comment.id, 1, like));
        dislike.addEventListener("click", () => sendReaction("comment", comment.id, -1, dislike));
        actions.append(like, dislike);
      }
      if (!isReply && state.auth.authenticated) {
        const reply = document.createElement("button"); reply.className = "text-button"; reply.textContent = "回复";
        reply.addEventListener("click", () => showReplyForm(wrap, comment.id)); actions.append(reply);
      }
      wrap.append(head, body, actions);
      if (Number(comment.author_liked)) {
        const liked = document.createElement("small"); liked.className = "author-liked-note"; liked.textContent = "作者已赞"; wrap.append(liked);
      }
      return wrap;
    }

    function renderComments() {
      const list = document.getElementById("comment-list"); list.replaceChildren();
      const parents = state.comments.filter((item) => !item.parent_id);
      if (!parents.length) { list.append(empty("还没有评论，欢迎留下第一条留言。")); return; }
      parents.forEach((parent) => {
        const node = commentNode(parent); list.append(node);
        state.comments.filter((item) => item.parent_id === parent.id).forEach((reply) => list.append(commentNode(reply, true)));
      });
    }

    function showReplyForm(parentNode, parentId) {
      if (!state.auth.authenticated) { showAuthLock("account"); return; }
      document.querySelectorAll(".reply-form").forEach((form) => form.remove());
      const form = document.createElement("form"); form.className = "reply-form";
      const name = document.createElement("input"); name.required = true; name.maxLength = 30; name.placeholder = "游客署名"; name.value = state.auth.user?.nickname || localStorage.getItem("xyj_guest_name") || ""; name.readOnly = Boolean(state.auth.user);
      const body = document.createElement("input"); body.required = true; body.maxLength = 1000; body.placeholder = "回复内容";
      const submit = document.createElement("button"); submit.className = "btn small"; submit.type = "submit"; submit.textContent = "回复";
      form.append(name, body, submit);
      form.addEventListener("submit", async (event) => {
        event.preventDefault(); submit.disabled = true;
        try {
          localStorage.setItem("xyj_guest_name", name.value.trim());
          await api("/api/comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentId: state.currentContent.id, parentId, guestName: name.value, body: body.value }) });
          const data = await api(`/api/comments?contentId=${encodeURIComponent(state.currentContent.id)}`); state.comments = data.comments; renderComments();
        } catch (error) { alert(error.message); } finally { submit.disabled = false; }
      });
      parentNode.append(form); body.focus();
    }
