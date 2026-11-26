document.getElementById("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const notice = document.getElementById("settings-notice");
  const profileAccess = profileAccessPayload();
  if (!validateProfileAccess(profileAccess, notice)) return;
  try {
    app.settings = await api("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        site_title: document.getElementById("setting-site-title").value,
        owner_name: document.getElementById("setting-owner-name").value,
        site_version: document.getElementById("setting-site-version").value,
        school: document.getElementById("setting-school").value,
        intro: document.getElementById("setting-intro").value,
        usage_guide: document.getElementById("setting-usage-guide").value,
        contact_email: document.getElementById("setting-email").value,
        guest_daily_limit: document.getElementById("setting-guest-limit").value,
        about_heading: document.getElementById("setting-about-heading").value,
        about_intro: document.getElementById("setting-about-intro").value,
        about_school_label: document.getElementById("setting-about-school-label").value,
        about_learning_title: document.getElementById("setting-about-learning-title").value,
        about_learning_items: document.getElementById("setting-about-learning-items").value,
        about_contact_title: document.getElementById("setting-about-contact-title").value,
        contact_email_label: document.getElementById("setting-email-label").value,
        contact_email_intl: document.getElementById("setting-email-intl").value,
        contact_email_intl_label: document.getElementById("setting-email-intl-label").value,
        owner_user_id: document.getElementById("setting-owner-user").value,
        profileAccess
      })
    });
    notice.textContent = "网站设置和个人信息权限已保存。";
  } catch (error) {
    notice.textContent = error.message;
  }
});
