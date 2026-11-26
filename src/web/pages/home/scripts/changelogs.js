    /* ---------- 04. 首页最新日志 + 下一级完整历史。 ---------- */
    function changelogNode(log) {
      const item = document.createElement("article"); item.className = "timeline-item";
      const side = document.createElement("div");
      const version = document.createElement("div"); version.className = "version"; version.textContent = `v${log.version}`;
      const date = document.createElement("div"); date.className = "date"; date.textContent = formatDate(log.published_at);
      side.append(version, date);
      const main = document.createElement("div");
      const title = document.createElement("h3"); title.textContent = log.title;
      const body = document.createElement("p"); body.textContent = log.body;
      main.append(title, body); item.append(side, main);
      return item;
    }

    function renderChangelogs() {
      const preview = document.getElementById("timeline");
      const history = document.getElementById("timeline-history");
      preview.replaceChildren(); history.replaceChildren();
      const logs = state.data?.changelogs || [];
      if (!logs.length) {
        preview.append(empty("还没有更新记录。"));
        history.append(empty("还没有更新记录。"));
        return;
      }
      preview.append(changelogNode(logs[0]));
      logs.forEach((log) => history.append(changelogNode(log)));
    }
