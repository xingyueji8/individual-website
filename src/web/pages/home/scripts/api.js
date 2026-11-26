    /* ---------- 02. 通用工具：访客编号、日期和 API 请求。 ---------- */
    function randomId() {
      return globalThis.crypto?.randomUUID?.() || `v-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    const visitorId = (() => {
      let value = localStorage.getItem("xyj_visitor_id");
      if (!value) { value = randomId(); localStorage.setItem("xyj_visitor_id", value); }
      return value;
    })();

    function formatDate(value) {
      if (!value) return "";
      return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
    }

    /*
     * 文章与评论需要精确到分钟，因此不复用只显示年月日的 formatDate。
     * hourCycle: "h23" 可以避免部分浏览器把午夜显示成“24:00”。
     */
    function formatDateTime(value) {
      if (!value) return "";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      return new Intl.DateTimeFormat("zh-CN", {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).format(date);
    }

    function contentTimeLabels(item) {
      const published = formatDateTime(item?.published_at) || "未标注";
      // 兼容部署前已缓存的旧接口数据：没有 updated_at 时暂以发布时间代替。
      const updated = formatDateTime(item?.updated_at || item?.published_at) || "未标注";
      return {
        published: `发布时间：${published}`,
        updated: `最新修改：${updated}`,
      };
    }

    async function api(path, options = {}) {
      const headers = new Headers(options.headers);
      const tokens = contentGrantTokens(); if(tokens) headers.set("X-Content-Grants", tokens);
      options = { ...options, headers };
      const response = await fetch(path, options);
      const contentType = response.headers.get("content-type") || "";
      const data = contentType.includes("application/json") ? await response.json() : null;
      if (!response.ok) {
        const error = new Error(data?.error || `请求失败（${response.status}）`);
        error.status = response.status;
        error.code = data?.errorCode || "";
        if (error.code === "BOT_DETECTED") handleRuntimeBotDetected(error.message);
        throw error;
      }
      return data;
    }
