/* Shared upload lifecycle. A batch includes files that have not started yet. */
const studioUploadBatches = new Set();
let studioUploadGeneration = 0;

function yieldUploadThread() { return new Promise(resolve => setTimeout(resolve, 0)); }
function uploadAborted(signal) {
  if (signal?.aborted) throw new UploadCancelledError("上传已停止");
}
function beginStudioUploadBatch() {
  const controller = new AbortController();
  const batch = { signal: controller.signal, stop: () => controller.abort(),
    finish() { studioUploadBatches.delete(batch); syncStudioUploadStopControls(); } };
  studioUploadBatches.add(batch); syncStudioUploadStopControls(); return batch;
}
function syncStudioUploadStopControls() {
  const busy = studioUploadBatches.size > 0 || app.activeUploadJobs.size > 0 || preparingPhotos || sendingPhotos || photoThumbnailRunning;
  document.querySelectorAll("[data-stop-uploads]").forEach(control => { control.disabled = !busy; });
  const notice = document.getElementById("upload-stop-notice");
  if (!busy && notice.textContent.startsWith("正在停止")) notice.textContent = "上传已停止。已完成的文件保留；待上传照片和大文件已确认的断点可继续使用。";
}
function stopAllStudioUploads() {
  studioUploadGeneration += 1;
  for (const batch of studioUploadBatches) batch.stop();
  stopPhotoThumbnails();
  for (const job of app.activeUploadJobs) job.cancel({ preserveCheckpoint: true });
  const notice = document.getElementById("upload-stop-notice");
  notice.hidden = false;
  notice.textContent = "正在停止上传。已完成的文件保留；未开始的照片留在待上传列表，大文件已确认的断点可继续使用。";
  syncStudioUploadStopControls();
}
function initializeStudioUploadControls() {
  document.querySelectorAll("[data-stop-uploads]").forEach(control => control.addEventListener("click", stopAllStudioUploads));
  syncStudioUploadStopControls();
}
function photoMimeType(file) {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop().toLowerCase();
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif", heic: "image/heic", heif: "image/heif" })[extension] || "";
}
function uploadFileReadError(error) {
  const failure = new Error(`无法读取手机相册中的原片，请将照片保存到本机后重新选择。${error?.message ? `（${error.message}）` : ""}`);
  failure.code = "UPLOAD_FILE_READ"; failure.retryable = false; return failure;
}
function readUploadPhotoBytes(file, signal) {
  uploadAborted(signal);
  return new Promise((resolve, reject) => {
    let settled = false, reader = null;
    const finish = (callback, value) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", onAbort);
      if (reader) reader.onload = reader.onerror = reader.onabort = null;
      callback(value);
    };
    const onAbort = () => { finish(reject, new UploadCancelledError("照片读取已停止")); reader?.abort(); };
    const timer = setTimeout(() => { finish(reject, uploadFileReadError(new Error("相册文件读取超时"))); reader?.abort(); }, 60000);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    if (typeof FileReader === "function") {
      reader = new FileReader();
      reader.onload = () => finish(resolve, reader.result);
      reader.onerror = () => finish(reject, reader.error || uploadFileReadError());
      reader.onabort = () => finish(reject, new UploadCancelledError("照片读取已停止"));
      try { reader.readAsArrayBuffer(file); } catch (error) { finish(reject, error); }
    } else Promise.resolve().then(() => file.arrayBuffer()).then(bytes => finish(resolve, bytes), error => finish(reject, error));
  });
}
async function snapshotUploadPhoto(file, signal) {
  uploadAborted(signal);
  let bytes;
  try { bytes = await readUploadPhotoBytes(file, signal); } catch (error) { if (error.cancelled || error.code === "UPLOAD_FILE_READ") throw error; throw uploadFileReadError(error); }
  uploadAborted(signal);
  if (bytes.byteLength !== file.size) throw uploadFileReadError();
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
  uploadAborted(signal);
  // The POST and retries use immutable bytes, not a temporary Android/iOS photo-provider handle.
  return { file: new File([bytes], file.name, { type: photoMimeType(file), lastModified: file.lastModified }), hash };
}
async function postStudioPhoto(file, fields, { signal, scope = "section", requiredPreview = true, confirmDuplicate = false } = {}) {
  const batch = signal ? null : beginStudioUploadBatch(); signal ||= batch.signal;
  const job = createUploadJob(file, scope);
  const token = crypto.randomUUID(); job.setSessionId(token);
  let submitted = false;
  try {
    let form;
    while (true) {
      await job.waitUntilReady(); uploadAborted(signal);
      const controller = job.beginPartRequest();
      try {
        job.setState("正在读取原片并生成预览…"); await yieldUploadThread();
        const snapshot = await snapshotUploadPhoto(file, controller.signal);
        form = new FormData(); form.append("file", snapshot.file, file.name);
        Object.entries(fields).forEach(([key, value]) => form.append(key, String(value ?? "")));
        form.append("uploadToken", token);
        const prepared = await preparePhotoInWorker(snapshot.file, { signal: controller.signal });
        uploadAborted(controller.signal);
        if (prepared?.preview && prepared?.mosaic) {
          form.append("preview", prepared.preview, "preview.webp"); form.append("mosaic", prepared.mosaic, "mosaic.webp");
        } else await appendCompressedPreview(form, snapshot.file, { required: requiredPreview || isHeicPhoto(file) });
        uploadAborted(controller.signal); break;
      } catch (error) {
        job.throwIfStopped(); uploadAborted(signal);
        if (job.wasPausedAbort(controller) || job.wasNetworkAbort(controller)) continue;
        throw error;
      } finally { job.endPartRequest(controller); }
    }
    let result;
    submitted = true;
    try { result = await uploadPartWithRetry("/api/admin/media", form, job, { label: "照片" }); }
    catch (error) {
      if (error.status !== 409 || !confirmDuplicate || !confirm(`${error.message}\n仍然上传一份作为本文插图吗？`)) throw error;
      job.throwIfStopped(); uploadAborted(signal); form.set("allowDuplicate", "1");
      result = await uploadPartWithRetry("/api/admin/media", form, job, { label: "照片" });
    }
    job.throwIfStopped(); job.finish("照片已保存"); return result;
  } catch (error) {
    if (job.isCancelled() || error.cancelled) {
      try { if (submitted) await api(`/api/admin/photo-uploads/${token}`, { method: "DELETE" }); job.cancelled("上传已停止"); }
      catch (cleanupError) { job.cancelled(`上传已停止；清理未确认：${cleanupError.message}`, { autoRemove: false }); }
      throw new UploadCancelledError("上传已停止");
    }
    job.fail(error.message); throw error;
  } finally { batch?.finish(); }
}
async function runSectionPhotoUploads(files, context, noticeId) {
  if (!files.length) return;
  const batch = beginStudioUploadBatch(); const notice = document.getElementById(noticeId);
  let completed = 0; const failures = [];
  try {
    for (const file of files) {
      if (batch.signal.aborted) break;
      notice.textContent = `正在上传图片 ${completed + failures.length + 1}/${files.length}…`;
      try { await uploadSectionPhoto(file, { ...context, signal: batch.signal, caption: file.name }); completed++; }
      catch (error) { if (error.cancelled) break; failures.push(`${file.name}：${error.message}`); }
    }
    if (completed) await Promise.all([loadAlbumsAndMedia(), loadDashboard()]);
    notice.textContent = `${batch.signal.aborted ? "本批上传已停止；" : ""}已上传 ${completed}/${files.length} 张${failures.length ? `；${failures.length} 张失败：${failures.join("；")}` : ""}。`;
  } finally { batch.finish(); }
}
function preparePhotoInWorker(file, { thumbnail = false, signal } = {}) {
  uploadAborted(signal);
  if (typeof Worker !== "function") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    let worker;
    try { worker = new Worker("/photo-preparation-worker.js?v=20261107"); } catch { resolve(null); return; }
    let settled = false;
    const finish = (callback, result) => {
      if (settled) return; settled = true; clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort); worker.terminate(); callback(result);
    };
    const onAbort = () => finish(reject, new UploadCancelledError("图片处理已停止"));
    const timer = setTimeout(() => finish(resolve, null), 60000);
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = event => finish(resolve, event.data?.preview ? event.data : null);
    worker.onerror = event => { event.preventDefault?.(); finish(resolve, null); };
    if (signal?.aborted) { onAbort(); return; }
    try { worker.postMessage({ file, thumbnail }); } catch { finish(resolve, null); }
  });
}

let photoThumbnailRunning = false;
let photoThumbnailController = null;
let photoThumbnailObserver = null;
const pendingPhotoThumbnails = [];
const photoThumbnailCache = [];
function releasePhotoThumbnail(entry) {
  if (entry.url) URL.revokeObjectURL(entry.url);
  entry.url = null; entry.image?.removeAttribute("src");
  const index = photoThumbnailCache.indexOf(entry); if (index >= 0) photoThumbnailCache.splice(index, 1);
}
function stopPhotoThumbnails() {
  photoThumbnailController?.abort();
  pendingPhotoThumbnails.forEach(entry => { entry.thumbnailQueued = false; });
  pendingPhotoThumbnails.splice(0);
}
function observePhotoThumbnail(entry) {
  if (isHeicPhoto(entry.file)) return; // Avoid a synchronous HEIC conversion while choosing files.
  if (typeof IntersectionObserver === "function") {
    photoThumbnailObserver ||= new IntersectionObserver(records => {
      for (const record of records) {
        const selected = photoSelection.find(item => item.node === record.target);
        if (selected && record.isIntersecting) queuePhotoThumbnail(selected);
      }
    }, { rootMargin: "160px" });
    photoThumbnailObserver.observe(entry.node);
  } else if (photoSelection.indexOf(entry) < 8) queuePhotoThumbnail(entry);
}
function queuePhotoThumbnail(entry) {
  if (entry.url || entry.thumbnailQueued || !photoSelection.includes(entry)) return;
  entry.thumbnailQueued = true; pendingPhotoThumbnails.push(entry);
  void pumpPhotoThumbnails();
}
async function pumpPhotoThumbnails() {
  if (photoThumbnailRunning || sendingPhotos) return;
  photoThumbnailRunning = true;
  const controller = new AbortController(); photoThumbnailController = controller;
  syncStudioUploadStopControls();
  try {
    while (pendingPhotoThumbnails.length && !sendingPhotos && !controller.signal.aborted) {
      await yieldUploadThread();
      const entry = pendingPhotoThumbnails.shift(); entry.thumbnailQueued = false;
      if (!photoSelection.includes(entry)) continue;
      try {
        const prepared = await preparePhotoInWorker(entry.file, { thumbnail: true, signal: controller.signal });
        uploadAborted(controller.signal);
        const preview = prepared?.preview || await createCompressedPreview(entry.file, { maxEdge: 320, quality: .65 });
        uploadAborted(controller.signal);
        if (!photoSelection.includes(entry)) continue;
        entry.url = URL.createObjectURL(preview); entry.image.src = entry.url; photoThumbnailCache.push(entry);
        while (photoThumbnailCache.length > 16) releasePhotoThumbnail(photoThumbnailCache[0]);
      } catch { /* A thumbnail is optional. Upload reports an actual file-read error separately. */ }
    }
  } finally {
    photoThumbnailRunning = false; photoThumbnailController = null;
    syncStudioUploadStopControls();
  }
}
