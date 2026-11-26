document.getElementById("content-share").addEventListener("click", () =>
  openStudioShare(
    "content",
    app.content.find((item) => item.id === document.getElementById("content-id").value)
  )
);
document.getElementById("subsection-share").addEventListener("click", () =>
  openStudioShare(
    "subsection",
    app.subsections.find((item) => item.id === document.getElementById("subsection-id").value)
  )
);
document.getElementById("asset-share-board").addEventListener("click", openStudioAssetBoardShare);
document
  .getElementById("rename-current-board")
  .addEventListener("click", () => openStudioBoardRename());
document
  .getElementById("asset-rename-board")
  .addEventListener("click", () => openStudioBoardRename(true));
