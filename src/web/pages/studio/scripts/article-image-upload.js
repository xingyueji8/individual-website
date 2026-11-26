async function uploadInline(file, { signal, context, requiredPreview = false } = {}) {
  const visibility = context?.visibility ?? document.getElementById("content-visibility").value;
  const allowedUserIds = context?.allowedUserIds ?? selectedAudienceIds("content-user-picker");
  if (visibilityUsesAudience(visibility) && !allowedUserIds.length) {
    throw new Error("插入图片前，请至少勾选一个能够查看本文的已审核账号");
  }
  const item = await postStudioPhoto(
    file,
    {
      kind: "inline",
      contentId: context?.articleId ?? document.getElementById("content-id").value,
      visibility,
      allowedUserIds: JSON.stringify(allowedUserIds)
    },
    { signal, scope: "article", requiredPreview, confirmDuplicate: true }
  );
  app.media.unshift(item);
  if (!context || studioArticleImageContextActive(context)) studioArticleImages.uploaded.add(item.id);
  refreshCoverOptions();
  renderArticleAssets();
  return item;
}

function insertInlineImageAtEditorRange(item, file, { range: savedRange } = {}) {
  const editor = document.getElementById("content-editor");
  editor.focus();
  let range = (savedRange || app.editorRange)?.cloneRange();
  if (!range || !editor.contains(range.commonAncestorContainer)) {
    range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  }
  const image = studioArticleImageElement(item, file);
  const lineBreak = document.createElement("br");
  const fragment = document.createDocumentFragment();
  fragment.append(image, lineBreak);
  range.deleteContents();
  range.insertNode(fragment);
  range.setStartAfter(lineBreak);
  range.collapse(true);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  app.editorRange = range.cloneRange();
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  return range.cloneRange();
}

async function uploadSectionPhoto(
  file,
  {
    sectionId,
    subsectionId = "",
    caption = "",
    visibility = "public",
    allowedUserIds = [],
    signal,
    scope
  } = {}
) {
  if (!sectionId) throw new Error("请先选择所属大板块");
  const item = await postStudioPhoto(
    file,
    {
      kind: "photo",
      sectionId,
      subsectionId,
      caption,
      visibility,
      allowedUserIds: JSON.stringify(allowedUserIds)
    },
    { signal, scope: scope === "library-photo" ? "library" : "section" }
  );
  app.media.unshift(item);
  refreshCoverOptions();
  return item;
}
