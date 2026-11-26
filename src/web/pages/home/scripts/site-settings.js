    /*
     * 使用说明以纯文本存进 D1：空行分段，普通换行会保留在同一段内。
     * 全程只使用 textContent 生成节点，后台内容不会被当作 HTML 执行。
     */
    function renderUsageGuide(value) {
      const guide = document.getElementById("usage-guide");
      const content = document.getElementById("usage-guide-content");
      const text = String(value || "").replace(/\r\n?/g, "\n");
      content.replaceChildren();
      if (!text.trim()) { guide.hidden = true; return; }

      text.split(/\n{2,}/).filter((paragraph) => paragraph.trim()).forEach((paragraph) => {
        const node = document.createElement("p");
        node.textContent = paragraph;
        content.append(node);
      });
      guide.hidden = !content.childElementCount;
    }

    function applySettings() {
      const settings = state.data?.settings || {};
      const title = settings.site_title || "星月集";
      document.title = `${title} - 个人主页`;
      document.getElementById("brand-title").textContent = title;
      // 后台仍可修改站名；主页标题会自动补上“的个人网站”，避免把页面文案覆盖成短标题。
      document.getElementById("home-title").textContent = `${title}的个人网站`;
      /*
       * 主页副标题默认为空，因此不会再显示“这里是星月集的个人网站”。
       * 如果站长日后在后台填写新的主页介绍，这里会自动取消 hidden 并显示新内容。
       */
      const intro = String(settings.intro || "").trim();
      const introNode = document.getElementById("home-intro");
      introNode.textContent = intro;
      introNode.hidden = !intro;
      renderUsageGuide(settings.usage_guide);
      document.getElementById("site-version").textContent = `网站版本 v${settings.site_version || "2.2.0.0"}`;

      const validAboutSections = ["intro", "school", "learning", "contact"];
      const visibleAboutSections = new Set(Array.isArray(settings.about_visible_sections)
        ? settings.about_visible_sections.filter((item) => validAboutSections.includes(item))
        : validAboutSections);
      const aboutVisible = visibleAboutSections.size > 0;
      document.getElementById("about-nav-button").hidden = !aboutVisible;
      document.getElementById("about").hidden = !aboutVisible;
      document.getElementById("about-heading").textContent = settings.about_heading || "关于我";

      const aboutIntro = String(settings.about_intro || "");
      const aboutIntroNode = document.getElementById("about-intro");
      aboutIntroNode.textContent = visibleAboutSections.has("intro") ? aboutIntro : "";
      aboutIntroNode.hidden = !visibleAboutSections.has("intro") || !aboutIntro.trim();

      const schoolSection = document.getElementById("about-school-section");
      schoolSection.hidden = !visibleAboutSections.has("school");
      document.getElementById("about-school-label").textContent = settings.about_school_label || "就读院校与专业";
      document.getElementById("about-school").textContent = visibleAboutSections.has("school") ? String(settings.school || "") : "";

      const learningSection = document.getElementById("about-learning-section");
      learningSection.hidden = !visibleAboutSections.has("learning");
      document.getElementById("about-learning-title").textContent = settings.about_learning_title || "目前学习方向";
      const learning = document.getElementById("about-learning-items");learning.replaceChildren();
      if(visibleAboutSections.has("learning"))String(settings.about_learning_items || "")
        .split(/\n+/).map((item) => item.trim()).filter(Boolean).forEach((item) => {
          const badge = document.createElement("span"); badge.className = "badge"; badge.textContent = item; learning.append(badge);
        });

      const contactSection = document.getElementById("about-contact-section");
      contactSection.hidden = !visibleAboutSections.has("contact");
      document.getElementById("about-contact-title").textContent = settings.about_contact_title || "联系方式";
      document.getElementById("contact-email-label").textContent = settings.contact_email_label || "国内邮箱";
      const email = visibleAboutSections.has("contact") ? String(settings.contact_email || "") : "";
      const contact = document.getElementById("contact-email");contact.textContent = email;contact.toggleAttribute("href",Boolean(email));if(email)contact.href = `mailto:${email}`;
      document.getElementById("contact-email-intl-label").textContent = settings.contact_email_intl_label || "国际邮箱";
      const intlEmail = visibleAboutSections.has("contact") ? String(settings.contact_email_intl || "") : "";
      const intlContact = document.getElementById("contact-email-intl");intlContact.textContent = intlEmail;intlContact.toggleAttribute("href",Boolean(intlEmail));if(intlEmail)intlContact.href = `mailto:${intlEmail}`;
    }
