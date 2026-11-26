    /* ---------- 17. AI 提问表单。 ---------- */
    document.getElementById("chat-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (window.SiteAgent) { await window.SiteAgent.submit(document.getElementById("chat-input")); return; }
      if (!hasFullAccess()) { showAuthLock("ai"); return; }
      const input = document.getElementById("chat-input"); const status = document.getElementById("chat-status"); const submit = event.currentTarget.querySelector("button");
      const question = input.value.trim(); if (!question) return;
      addBubble("user", question); input.value = ""; submit.disabled = true; status.textContent = "AI 正在生成回答…";
      const answerBubble = addBubble("ai", ""); answerBubble.classList.add("streaming");
      try {
        await streamAiAnswer(question, answerBubble);
        status.textContent = "";
      } catch (streamError) {
        const partial = answerBubble.textContent.trim();
        if (partial) {
          // 已收到部分内容时保留现场，避免重新请求后出现两份重复回答。
          answerBubble.textContent = `${partial}\n\n[回答中断：${streamError.message}]`;
          status.textContent = "";
        } else {
          /*
           * 某些浏览器、校园网或代理会拦截长连接，但普通 JSON 请求仍然可用。
           * 流式连接在首段文字到达前失败时，自动使用非流式接口重试一次，
           * 访客无需理解网络差异，也不会只看到“服务器错误”。
           */
          status.textContent = "流式连接不可用，正在自动切换兼容模式…";
          try {
            const result = await api("/api/ai", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ question }),
            });
            answerBubble.textContent = result.answer || "AI 暂时没有返回内容。";
            status.textContent = "";
          } catch (fallbackError) {
            answerBubble.textContent = `暂时无法回答：${fallbackError.message}`;
            status.textContent = "";
          }
        }
      } finally {
        answerBubble.classList.remove("streaming");
        await typesetAiBubble(answerBubble);
        submit.disabled = false; input.focus();
      }
    });

    [installAppDialog, document.getElementById("reader-dialog"), externalLinkDialog, resourceDialog, imageDialog].forEach((dialog) => dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    }));

    initializeContentLocks();
