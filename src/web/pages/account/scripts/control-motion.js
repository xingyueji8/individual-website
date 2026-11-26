    installLiquidGlassControlMotion({ selector: "button, a.btn, .home-link" });

    /* “返回登录”统一回到根页面，并保留用户最初想访问的板块 hash。 */
    document.querySelectorAll("[data-canonical-login]").forEach((link) => {
      link.href = canonicalLoginPath;
    });
