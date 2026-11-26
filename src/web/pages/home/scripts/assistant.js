    /* ---------- 10. AI 聊天气泡与 LaTeX 公式排版。 ---------- */
    function addBubble(role, text) {
      const bubble = document.createElement("div"); bubble.className = `bubble ${role}`; bubble.textContent = text;
      const messages = document.getElementById("chat-messages"); messages.append(bubble); messages.scrollTop = messages.scrollHeight; return bubble;
    }

    async function typesetAiBubble(bubble) {
      if (!bubble || !window.MathJax?.typesetPromise) return;
      try {
        // 如果同一气泡曾被排版过，先清理 MathJax 的内部记录再处理最终文本。
        window.MathJax.typesetClear?.([bubble]);
        await window.MathJax.typesetPromise([bubble]);
      } catch (error) {
        console.warn("LaTeX 排版失败，已保留原始文字", error);
      }
    }

    /*
     * 流式读取 AI 回答：
     * - fetch 收到响应头后就立即返回，不等待整段回答生成完毕；
     * - reader.read() 每取得一小段文字，就更新同一个 AI 气泡；
     * - TextDecoder 的 stream 选项可避免一个汉字被两个网络数据块拆开时出现乱码。
     */
    async function streamAiAnswer(question, bubble, signal) {
      const response = await fetch("/api/ai?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "text/plain" },
        body: JSON.stringify({ question }),
        signal,
      });

      if (!response.ok) {
        const raw = await response.text();
        let message = `请求失败（${response.status}）`;
        try { message = JSON.parse(raw)?.error || message; } catch { if (raw.trim()) message = raw.trim(); }
        throw new Error(message);
      }

      // 极旧浏览器没有 ReadableStream 时，退化为一次性显示，不影响基本问答功能。
      if (!response.body?.getReader) {
        const answer = await response.text();
        if (!answer.trim()) throw new Error("AI 没有返回内容");
        bubble.textContent = answer;
        return answer;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const messages = document.getElementById("chat-messages");
      let answer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        bubble.textContent = answer;
        messages.scrollTop = messages.scrollHeight;
      }
      answer += decoder.decode();
      bubble.textContent = answer;
      if (!answer.trim()) throw new Error("AI 没有返回内容");
      return answer;
    }
