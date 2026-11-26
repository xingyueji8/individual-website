    window.MathJax = {
      loader: { load: ["ui/safe"] },
      tex: {
        inlineMath: [["\\(", "\\)"]],
        displayMath: [["\\[", "\\]"], ["$$", "$$"]],
        processEscapes: true,
      },
      options: {
        safeOptions: {
          allow: { URLs: "safe", classes: "safe", cssIDs: "safe", styles: "safe" },
        },
      },
    };
