const MAX_RESUMABLE_FILE_BYTES = 100 * 1024 * 1024 * 1024;
const UPLOAD_CHECKPOINT_DB = "xingyueji-upload-checkpoints";
const UPLOAD_CHECKPOINT_STORE = "uploads";
const UPLOAD_CHECKPOINT_FALLBACK = "xingyueji-upload-checkpoints-v1";
const UPLOAD_STALL_TIMEOUT_MS = 30 * 1000;
const UPLOAD_RESPONSE_TIMEOUT_MS = 120 * 1000;
let uploadCheckpointDbPromise = null;

class UploadCancelledError extends Error {
  constructor(message = "上传已取消") {
    super(message);
    this.name = "UploadCancelledError";
    this.cancelled = true;
  }
}

function openUploadCheckpointDb() {
  if (!("indexedDB" in window)) return Promise.reject(new Error("当前浏览器不支持 IndexedDB"));
  if (uploadCheckpointDbPromise) return uploadCheckpointDbPromise;
  uploadCheckpointDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(UPLOAD_CHECKPOINT_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(UPLOAD_CHECKPOINT_STORE)) {
        const store = db.createObjectStore(UPLOAD_CHECKPOINT_STORE, { keyPath: "sessionId" });
        store.createIndex("fileIdentity", "fileIdentity", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开上传检查点"));
    request.onblocked = () => reject(new Error("上传检查点数据库被其他页面占用"));
  });
  return uploadCheckpointDbPromise;
}
function readFallbackUploadCheckpoints() {
  try {
    const value = JSON.parse(localStorage.getItem(UPLOAD_CHECKPOINT_FALLBACK) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
function writeFallbackUploadCheckpoints(records) {
  try {
    localStorage.setItem(UPLOAD_CHECKPOINT_FALLBACK, JSON.stringify(records));
    return true;
  } catch {
    return false;
  }
}
async function listUploadCheckpoints() {
  const fallback = readFallbackUploadCheckpoints();
  try {
    const db = await openUploadCheckpointDb();
    const stored = await new Promise((resolve, reject) => {
      const request = db
        .transaction(UPLOAD_CHECKPOINT_STORE, "readonly")
        .objectStore(UPLOAD_CHECKPOINT_STORE)
        .getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    const merged = new Map(fallback.map((item) => [item.sessionId, item]));
    for (const item of stored) merged.set(item.sessionId, item);
    return [...merged.values()];
  } catch {
    return fallback;
  }
}
async function saveUploadCheckpoint(record) {
  const value = { ...record, savedAt: new Date().toISOString() };
  try {
    const db = await openUploadCheckpointDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(UPLOAD_CHECKPOINT_STORE, "readwrite");
      tx.objectStore(UPLOAD_CHECKPOINT_STORE).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    writeFallbackUploadCheckpoints(
      readFallbackUploadCheckpoints().filter((item) => item.sessionId !== value.sessionId)
    );
    return true;
  } catch {
    const records = readFallbackUploadCheckpoints().filter(
      (item) => item.sessionId !== value.sessionId
    );
    records.push(value);
    return writeFallbackUploadCheckpoints(records);
  }
}
async function deleteUploadCheckpoint(sessionId) {
  try {
    const db = await openUploadCheckpointDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(UPLOAD_CHECKPOINT_STORE, "readwrite");
      tx.objectStore(UPLOAD_CHECKPOINT_STORE).delete(sessionId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {}
  writeFallbackUploadCheckpoints(
    readFallbackUploadCheckpoints().filter((item) => item.sessionId !== sessionId)
  );
}
async function pruneUploadCheckpoints() {
  const records = await listUploadCheckpoints();
  const now = Date.now();
  const valid = [];
  for (const record of records) {
    if (!record?.sessionId || !record.expiresAt || Date.parse(record.expiresAt) <= now) {
      if (record?.sessionId) await deleteUploadCheckpoint(record.sessionId);
    } else valid.push(record);
  }
  return valid;
}
function uploadFileIdentity(file) {
  return JSON.stringify([
    file.name,
    Number(file.size),
    Number(file.lastModified || 0),
    file.webkitRelativePath || ""
  ]);
}
function uploadTargetSignature(context) {
  return JSON.stringify({
    scope: String(context.scope || "library"),
    folderId: String(context.folderId || ""),
    relativePath: String(context.relativePath || ""),
    assetId: String(context.assetId || ""),
    variantLabel: String(context.variantLabel || ""),
    sectionId: String(context.sectionId || ""),
    subsectionId: String(context.subsectionId || ""),
    albumId: String(context.albumId || ""),
    contentId: String(context.contentId || "")
  });
}
function completedCheckpointAsset(checkpoint, variantLabel = "") {
  const item = app.assets.find((asset) => asset.id === checkpoint.assetId);
  if (!item) return null;
  if (variantLabel)
    return item.variants?.some(
      (variant) => variant.label === variantLabel && variant.status === "ready"
    )
      ? item
      : null;
  return item.status === "ready" ? item : null;
}
async function findUploadCheckpoint(file, targetSignature) {
  const identity = uploadFileIdentity(file);
  const records = await pruneUploadCheckpoints();
  return (
    records
      .filter((item) => item.fileIdentity === identity && item.targetSignature === targetSignature)
      .sort((a, b) => Date.parse(b.savedAt || 0) - Date.parse(a.savedAt || 0))[0] || null
  );
}
async function showPendingUploadNotice() {
  const records = await pruneUploadCheckpoints().catch(() => []);
  const serverUploads = app.assets.flatMap((item) => item.uploads || []);
  if (!records.length && !serverUploads.length) return;
  const notice = document.getElementById("asset-notice");
  if (notice && !notice.textContent.trim())
    notice.textContent = serverUploads.length
      ? `检测到 ${serverUploads.length} 个未完成上传；点击“选择原文件继续”即可从服务器已确认的分片续传。`
      : `检测到 ${records.length} 个本机断点记录；重新选择同一文件时会自动核对服务器进度。`;
}
function uploadQueueForScope(scope = "library") {
  if (scope === "photo") return document.getElementById("photo-upload-queue");
  return document.getElementById(
    scope === "article"
      ? "article-upload-queue"
      : scope === "gallery"
        ? "media-video-upload-queue"
        : scope === "section"
          ? "content-section-upload-queue"
          : "asset-upload-queue"
  );
}
function recoveredUploadContext(item, upload) {
  if (upload.variant_label)
    return {
      assetId: item.id,
      variantLabel: upload.variant_label,
      scope: item.scope || "library",
      downloadPolicy: item.download_policy
    };
  return {
    folderId: item.folder_id || "",
    relativePath: item.relative_path || item.filename,
    sectionId: item.section_id || "",
    subsectionId: item.subsection_id || "",
    albumId: item.album_id || "",
    contentId: item.content_id || "",
    scope: item.scope || "library",
    visibility: item.visibility,
    allowedUserIds: item.allowed_user_ids || [],
    note: item.note || "",
    downloadPolicy: item.download_policy
  };
}
function checkpointMatchesFile(checkpoint, file) {
  if (!checkpoint?.fileIdentity) return true;
  try {
    const [name, size, lastModified] = JSON.parse(checkpoint.fileIdentity);
    return (
      String(name) === file.name &&
      Number(size) === file.size &&
      (!Number(lastModified) || Number(lastModified) === Number(file.lastModified || 0))
    );
  } catch {
    return false;
  }
}
function uploadSessionIsActive(sessionId) {
  return [...document.querySelectorAll(".upload-job:not(.is-recovered)[data-upload-session-id]")].some(
    (node) =>
      node.dataset.uploadSessionId === String(sessionId) && node.dataset.uploadTerminal !== "true"
  );
}
function removeUploadSessionCards(sessionId) {
  document.querySelectorAll(".upload-job[data-upload-session-id]").forEach((node) => {
    if (node.dataset.uploadSessionId === String(sessionId)) node.remove();
  });
}
async function cancelPendingAssetUpload(item, upload, control) {
  if (app.resumingUploadSessions.has(upload.id) || uploadSessionIsActive(upload.id)) {
    alert("这个文件正在续传，请使用正在上传卡片中的“取消”按钮。");
    return;
  }
  if (!confirm(`确定取消“${upload.file_name || item.display_name}”并删除服务器上的已上传分片吗？`))
    return;
  const oldText = control.textContent;
  control.disabled = true;
  control.textContent = "正在取消…";
  try {
    await api(`/api/admin/asset-uploads/${upload.id}`, { method: "DELETE" });
    await deleteUploadCheckpoint(upload.id);
    removeUploadSessionCards(upload.id);
    document.getElementById("asset-notice").textContent =
      `“${upload.file_name || item.display_name}”的未完成上传已取消并清理。`;
    await Promise.all([loadAssets(), loadDashboard()]);
  } catch (error) {
    control.disabled = false;
    control.textContent = oldText;
    alert(`取消上传失败：${error.message}`);
  }
}
function selectFileForRecoveredUpload(item, upload) {
  if (app.resumingUploadSessions.has(upload.id) || uploadSessionIsActive(upload.id)) {
    alert("这个文件已经在续传中。");
    return;
  }
  const input = document.createElement("input");
  input.type = "file";
  input.className = "hidden";
  if (upload.variant_label === "preview") input.accept = "application/pdf";
  else if (["360p", "480p", "720p", "1080p"].includes(upload.variant_label)) input.accept = "video/*";
  document.body.append(input);
  input.addEventListener("cancel", () => input.remove(), { once: true });
  input.addEventListener(
    "change",
    async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      const expectedSize = Number(upload.expected_size);
      if (file.size !== expectedSize) {
        alert(
          `文件大小不一致。应为 ${formatBytes(expectedSize)}，所选文件为 ${formatBytes(file.size)}。`
        );
        return;
      }
      const records = await listUploadCheckpoints().catch(() => []);
      const local = records.find((record) => record.sessionId === upload.id);
      if (local && !checkpointMatchesFile(local, file)) {
        alert("这不是刷新前选择的同一文件，请重新选择原文件。");
        return;
      }
      const expectedName =
        local?.fileName || upload.file_name || (!upload.variant_label ? item.filename : "");
      if (!local && expectedName && file.name !== expectedName) {
        alert(`文件名不一致，请选择原文件“${expectedName}”。`);
        return;
      }
      let context = recoveredUploadContext(item, upload);
      if (local?.targetSignature) {
        try {
          context = { ...context, ...JSON.parse(local.targetSignature) };
        } catch {}
      }
      const signatureContext = {
        folderId: context.folderId || "",
        relativePath: context.relativePath || file.webkitRelativePath || file.name,
        assetId: context.assetId || "",
        variantLabel: context.variantLabel || "",
        sectionId: context.sectionId || "",
        subsectionId: context.subsectionId || "",
        albumId: context.albumId || "",
        contentId: context.contentId || "",
        scope: context.scope || "library"
      };
      const checkpoint = {
        ...local,
        sessionId: upload.id,
        assetId: item.id,
        variantLabel: String(upload.variant_label || ""),
        fileIdentity: local?.fileIdentity || uploadFileIdentity(file),
        targetSignature: local?.targetSignature || uploadTargetSignature(signatureContext),
        fileName: file.name,
        sizeBytes: file.size,
        lastModified: Number(file.lastModified || 0),
        relativePath: signatureContext.relativePath,
        scope: signatureContext.scope,
        partSize: Number(upload.part_size),
        expiresAt: upload.expires_at
      };
      app.resumingUploadSessions.add(upload.id);
      removeUploadSessionCards(upload.id);
      const notice = document.getElementById(
        signatureContext.scope === "section"
          ? "content-section-asset-notice"
          : signatureContext.scope === "gallery"
            ? "media-notice"
            : "asset-notice"
      );
      notice.textContent = `正在恢复“${file.name}”的上传…`;
      try {
        await uploadAssetFile(file, { ...context, resumeCheckpoint: checkpoint });
        notice.textContent = `“${file.name}”已上传完成。`;
        await Promise.all([loadAssets(), loadDashboard()]);
      } catch (error) {
        notice.textContent = error?.cancelled
          ? `“${file.name}”上传已取消`
          : `“${file.name}”续传失败：${error.message}`;
        await loadAssets().catch(() => null);
      } finally {
        app.resumingUploadSessions.delete(upload.id);
      }
    },
    { once: true }
  );
  input.click();
}
function renderRecoveredUploadCards() {
  document.querySelectorAll(".upload-job.is-recovered").forEach((node) => node.remove());
  const visibleSessions = new Set(
    [...document.querySelectorAll(".upload-job:not(.is-recovered)[data-upload-session-id]")].map(
      (node) => node.dataset.uploadSessionId
    )
  );
  app.assets.forEach((item) =>
    (item.uploads || []).forEach((upload) => {
      if (visibleSessions.has(String(upload.id))) return;
      const queue = uploadQueueForScope(item.scope);
      if (!queue) return;
      const job = document.createElement("div");
      job.className = "upload-job is-recovered";
      job.dataset.uploadSessionId = upload.id;
      const head = document.createElement("div");
      head.className = "upload-job-head";
      const name = document.createElement("strong");
      name.textContent =
        upload.file_name ||
        `${item.display_name}${upload.variant_label ? `（${upload.variant_label}）` : ""}`;
      const controls = document.createElement("div");
      controls.className = "upload-job-controls";
      const state = document.createElement("span");
      state.textContent = "刷新后待续传";
      const confirmed = document.createElement("span");
      confirmed.className = "upload-job-rate";
      confirmed.textContent = `已确认 ${formatBytes(upload.uploaded_size)} / ${formatBytes(upload.expected_size)}`;
      const resume = button("选择原文件继续", "btn small");
      resume.addEventListener("click", () => selectFileForRecoveredUpload(item, upload));
      const cancel = button("取消并删除", "btn small danger");
      cancel.addEventListener("click", () => cancelPendingAssetUpload(item, upload, cancel));
      controls.append(state, confirmed, resume, cancel);
      head.append(name, controls);
      const progress = document.createElement("div");
      progress.className = "upload-progress";
      const bar = document.createElement("span");
      bar.style.width = `${Math.max(0, Math.min(100, (Number(upload.uploaded_size) / Math.max(1, Number(upload.expected_size))) * 100))}%`;
      progress.append(bar);
      job.append(head, progress);
      queue.append(job);
    })
  );
}
