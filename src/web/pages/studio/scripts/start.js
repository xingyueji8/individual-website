// 用户在线状态每60秒更新一次；未登录后台时不会发起刷新请求。
window.setInterval(() => {
  if (!document.getElementById("studio").classList.contains("hidden")) loadUsers().catch(() => null);
}, 60_000);
initializeEmbeddedContentEditors();
initializeStudioSafetyNavigation();
initializeStudioContentWorkspace();
initializePhotoManagement();
initializeStudioUploadControls();
initializeEntryBackgroundSettings();
initializeStudioRichText();
resetSubsectionForm();
resetSectionForm();
resetContentForm();
resetChangelog();
syncContentManagerMeta();
checkSession();
