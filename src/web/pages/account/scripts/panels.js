    function setNotice(node, message, kind = "") {
      node.textContent = message;
      node.className = `notice${kind ? ` ${kind}` : ""}`;
    }

    function showPanel(name) {
      document.querySelectorAll(".panel").forEach((panel) => { panel.hidden = panel.id !== `panel-${name}`; });
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
