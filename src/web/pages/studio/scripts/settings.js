function refreshOwnerOptions() {
  const select = document.getElementById("setting-owner-user");
  const current = app.settings.owner_user_id || select.value;
  clear(select);
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "尚未绑定";
  select.append(none);
  approvedAudienceUsers().forEach((user) => {
    const option = document.createElement("option");
    option.value = user.id;
    option.textContent = `${user.nickname}（@${user.username}）`;
    select.append(option);
  });
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}
async function loadSettings() {
  app.settings = await api("/api/admin/settings");
  const values = {
    "setting-site-title": "site_title",
    "setting-owner-name": "owner_name",
    "setting-site-version": "site_version",
    "setting-school": "school",
    "setting-intro": "intro",
    "setting-usage-guide": "usage_guide",
    "setting-email": "contact_email",
    "setting-guest-limit": "guest_daily_limit",
    "setting-about-heading": "about_heading",
    "setting-about-intro": "about_intro",
    "setting-about-school-label": "about_school_label",
    "setting-about-learning-title": "about_learning_title",
    "setting-about-learning-items": "about_learning_items",
    "setting-about-contact-title": "about_contact_title",
    "setting-email-label": "contact_email_label",
    "setting-email-intl": "contact_email_intl",
    "setting-email-intl-label": "contact_email_intl_label"
  };
  Object.entries(values).forEach(([id, key]) => {
    document.getElementById(id).value = app.settings[key] || "";
  });
  Object.entries(profileAccessControls).forEach(([sectionKey, [selectId, pickerId]]) => {
    const access = app.settings.profile_access?.[sectionKey] || {
      visibility: "public",
      allowedUserIds: []
    };
    document.getElementById(selectId).value = access.visibility || "public";
    syncAudiencePicker(selectId, pickerId, access.allowedUserIds || []);
  });
  refreshOwnerOptions();
}
