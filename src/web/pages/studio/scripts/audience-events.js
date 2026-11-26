document
  .getElementById("visibility-editor-mode")
  .addEventListener("change", () =>
    syncAudiencePicker(
      "visibility-editor-mode",
      "visibility-editor-users",
      selectedAudienceIds("visibility-editor-users")
    )
  );
Object.values(profileAccessControls).forEach(([selectId, pickerId]) =>
  document
    .getElementById(selectId)
    .addEventListener("change", () =>
      syncAudiencePicker(selectId, pickerId, selectedAudienceIds(pickerId))
    )
);
document.getElementById("visibility-editor-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const dialog = document.getElementById("visibility-editor-dialog");
  const editor = app.visibilityEditor;
  if (!editor) return;
  if (event.submitter?.value === "cancel") {
    app.visibilityEditor = null;
    dialog.close("cancel");
    editor.resolve(null);
    return;
  }
  const choice = visibilityPayload("visibility-editor-mode", "visibility-editor-users");
  if (!validateVisibilityChoice(choice)) return;
  app.visibilityEditor = null;
  dialog.close("save");
  editor.resolve(choice);
});
document.getElementById("visibility-editor-dialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  const editor = app.visibilityEditor;
  app.visibilityEditor = null;
  event.currentTarget.close("cancel");
  editor?.resolve(null);
});
