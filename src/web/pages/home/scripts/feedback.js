    /* ---------- 09. 公开留言板。联系方式永远不会由公开接口返回。 ---------- */
    function renderFeedback() {
      const list = document.getElementById("feedback-list"); list.replaceChildren();
      if (!state.publicFeedback.length) { list.append(empty("还没有公开留言。")); return; }
      const categoryNames = { message: "留言", bug: "网站问题", suggestion: "功能建议" };
      state.publicFeedback.forEach((item) => {
        const card = document.createElement("article"); card.className = "feedback-item";
        const header = document.createElement("header");
        const name = document.createElement("strong"); name.textContent = `${item.guest_name} · ${categoryNames[item.category] || "留言"}`;
        const date = document.createElement("span"); date.textContent = formatDate(item.created_at);
        const body = document.createElement("p"); body.textContent = item.body;
        header.append(name, date); card.append(header, body);
        if (item.admin_reply) {
          const reply = document.createElement("section"); reply.className = "feedback-owner-reply";
          const replyHeader = document.createElement("header");
          const replyName = document.createElement("strong"); replyName.textContent = "站长回复";
          const replyDate = document.createElement("span"); replyDate.textContent = formatDate(item.admin_replied_at);
          const replyBody = document.createElement("p"); replyBody.textContent = item.admin_reply;
          replyHeader.append(replyName, replyDate); reply.append(replyHeader, replyBody); card.append(reply);
        }
        list.append(card);
      });
    }
