function uploadConcurrency() {
  const connection = navigator.connection;
  if (connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType)) return 1;
  if (connection?.effectiveType === "3g") return 2;
  return Number(navigator.hardwareConcurrency || 4) >= 8 ? 4 : 3;
}

window.addEventListener("beforeunload", (event) => {
  if (!app.activeUploadJobs.size && !studioDirtyForms.size && !photoSelection.length) return;
  event.preventDefault();
  event.returnValue = "";
});

function createUploadJob(file, scope = "library") {
  const queue = uploadQueueForScope(scope);
  const job = document.createElement("div");
  job.className = "upload-job";
  const head = document.createElement("div");
  head.className = "upload-job-head";
  const name = document.createElement("strong");
  name.textContent = file.name;
  const controls = document.createElement("div");
  controls.className = "upload-job-controls";
  const state = document.createElement("span");
  state.textContent = "等待上传";
  const rate = document.createElement("span");
  rate.className = "upload-job-rate";
  rate.textContent = "上传速率 --";
  const pause = button("暂停", "btn small ghost");
  pause.setAttribute("aria-label", `暂停上传 ${file.name}`);
  const cancel = button("取消", "btn small danger");
  cancel.setAttribute("aria-label", `取消上传 ${file.name}`);
  controls.append(state, rate, pause, cancel);
  head.append(name, controls);
  const progress = document.createElement("div");
  progress.className = "upload-progress";
  const bar = document.createElement("span");
  progress.append(bar);
  job.append(head, progress);
  queue.append(job);

  let paused = false;
  let terminal = false;
  let cancelled = false;
  let finalizing = false;
  let preserveCheckpoint = false;
  let failureError = null;
  let lastState = "等待上传";
  let resumeWaiters = [];
  const activeControllers = new Set();
  const stopListeners = new Set();
  const pauseAbortedRequests = new WeakSet();
  const networkAbortedRequests = new WeakSet();
  const stoppedError = () => (cancelled ? new UploadCancelledError() : failureError);
  const throwIfStopped = () => {
    const error = stoppedError();
    if (error) throw error;
  };
  const settleStopped = (error) => {
    const waiters = resumeWaiters;
    resumeWaiters = [];
    waiters.forEach((item) => item.reject(error));
    for (const listener of stopListeners) listener(error);
    stopListeners.clear();
  };
  const setRate = (value) => {
    rate.textContent = paused ? "上传速率 已暂停" : `上传速率 ${formatUploadRate(value)}`;
  };
  const setState = (text) => {
    lastState = text;
    if (!paused) state.textContent = text;
  };
  const waitUntilResumed = () => {
    throwIfStopped();
    return paused
      ? new Promise((resolve, reject) => resumeWaiters.push({ resolve, reject }))
      : Promise.resolve();
  };
  const waitForOnline = () => {
    throwIfStopped();
    if (navigator.onLine !== false) return Promise.resolve();
    setState("网络已断开，恢复联网后会继续…");
    setRate(0);
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        window.removeEventListener("online", onOnline);
        stopListeners.delete(onStop);
      };
      const onOnline = () => {
        cleanup();
        resolve();
      };
      const onStop = (error) => {
        cleanup();
        reject(error);
      };
      stopListeners.add(onStop);
      window.addEventListener("online", onOnline, { once: true });
      if (navigator.onLine !== false) {
        cleanup();
        resolve();
      }
    });
  };
  const waitUntilReady = async () => {
    while (true) {
      await waitUntilResumed();
      await waitForOnline();
      throwIfStopped();
      if (!paused && navigator.onLine !== false) return;
    }
  };
  const waitForRetry = (ms) => {
    throwIfStopped();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        stopListeners.delete(onStop);
        resolve();
      }, ms);
      const onStop = (error) => {
        clearTimeout(timer);
        stopListeners.delete(onStop);
        reject(error);
      };
      stopListeners.add(onStop);
    });
  };
  const abortForNetwork = (message) => {
    if (terminal || cancelled) return;
    setState(message);
    setRate(0);
    for (const controller of activeControllers) {
      networkAbortedRequests.add(controller);
      controller.abort();
    }
  };
  let observedConnectionType = navigator.connection?.type || "";
  const onOffline = () => abortForNetwork("网络已断开，恢复联网后会自动重连…");
  const onConnectionChange = () => {
    const nextType = navigator.connection?.type || "";
    if (observedConnectionType && nextType && observedConnectionType !== nextType)
      abortForNetwork("检测到网络切换，正在重新连接…");
    observedConnectionType = nextType;
  };
  const cleanupNetworkListeners = () => {
    window.removeEventListener("offline", onOffline);
    navigator.connection?.removeEventListener?.("change", onConnectionChange);
  };
  window.addEventListener("offline", onOffline);
  navigator.connection?.addEventListener?.("change", onConnectionChange);
  const resume = () => {
    paused = false;
    pause.textContent = "暂停";
    pause.setAttribute("aria-label", `暂停上传 ${file.name}`);
    lastState = "正在恢复上传…";
    state.textContent = lastState;
    setRate(0);
    const waiters = resumeWaiters;
    resumeWaiters = [];
    waiters.forEach((item) => item.resolve());
  };
  pause.addEventListener("click", () => {
    if (terminal) return;
    if (paused) {
      resume();
      return;
    }
    paused = true;
    pause.textContent = "恢复";
    pause.setAttribute("aria-label", `恢复上传 ${file.name}`);
    state.textContent = "已暂停（恢复后会安全重传当前分片）";
    setRate(0);
    for (const controller of activeControllers) {
      pauseAbortedRequests.add(controller);
      controller.abort();
    }
  });
  const cancelUpload = ({ preserveCheckpoint: preserve = false } = {}) => {
    if (terminal || finalizing || cancelled) return;
    preserveCheckpoint = preserve;
    cancelled = true;
    paused = false;
    pause.disabled = true;
    cancel.disabled = true;
    cancel.textContent = "正在停止…";
    state.textContent = "正在停止上传…";
    const error = new UploadCancelledError();
    for (const controller of activeControllers) controller.abort();
    settleStopped(error);
  };
  cancel.addEventListener("click", () => {
    if (terminal) {
      job.remove();
      return;
    }
    cancelUpload();
  });
  const update = (percent, text) => {
    bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    lastState = text;
    if (!paused) state.textContent = text;
  };
  const apiObject = {
    element: job,
    update,
    setState,
    setRate,
    waitUntilResumed,
    waitForOnline,
    waitUntilReady,
    waitForRetry,
    setSessionId(value) {
      if (value) job.dataset.uploadSessionId = String(value);
    },
    beginPartRequest() {
      throwIfStopped();
      const controller = new AbortController();
      activeControllers.add(controller);
      return controller;
    },
    endPartRequest(controller) {
      activeControllers.delete(controller);
    },
    wasPausedAbort(controller) {
      return pauseAbortedRequests.has(controller);
    },
    wasNetworkAbort(controller) {
      return networkAbortedRequests.has(controller);
    },
    throwIfStopped,
    isCancelled() {
      return cancelled;
    },
    cancel: cancelUpload,
    shouldPreserveCheckpoint() {
      return preserveCheckpoint;
    },
    abortForFailure(error) {
      if (failureError || cancelled) return;
      failureError = error;
      for (const controller of activeControllers) controller.abort();
      settleStopped(error);
    },
    lock(text) {
      finalizing = true;
      if (paused) resume();
      cleanupNetworkListeners();
      pause.disabled = true;
      cancel.disabled = true;
      pause.textContent = "处理中";
      setRate(0);
      update(100, text);
    },
    finish(text) {
      terminal = true;
      job.dataset.uploadTerminal = "true";
      cleanupNetworkListeners();
      pause.disabled = true;
      cancel.disabled = true;
      pause.textContent = "完成";
      rate.textContent = "上传速率 已完成";
      update(100, text);
      app.activeUploadJobs.delete(apiObject);
      job.remove();
      syncStudioUploadStopControls();
    },
    fail(text) {
      terminal = true;
      job.dataset.uploadTerminal = "true";
      if (paused) resume();
      cleanupNetworkListeners();
      pause.hidden = true;
      cancel.disabled = false;
      cancel.textContent = "移除此提示";
      rate.textContent = "上传速率 已停止";
      job.classList.add("is-failed");
      lastState = text;
      state.textContent = text;
      app.activeUploadJobs.delete(apiObject);
      syncStudioUploadStopControls();
    },
    cancelled(text, { autoRemove = true } = {}) {
      terminal = true;
      job.dataset.uploadTerminal = "true";
      cleanupNetworkListeners();
      pause.hidden = true;
      rate.textContent = "上传速率 已停止";
      job.classList.add("is-cancelled");
      lastState = text;
      state.textContent = text;
      app.activeUploadJobs.delete(apiObject);
      if (autoRemove) {
        cancel.hidden = true;
        setTimeout(() => job.remove(), 600);
      } else {
        cancel.disabled = false;
        cancel.textContent = "移除此提示";
      }
      syncStudioUploadStopControls();
    }
  };
  app.activeUploadJobs.add(apiObject);
  syncStudioUploadStopControls();
  return apiObject;
}
function uploadPartRequest(url, blob, controller, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    let stallTimer = 0;
    let forcedError = null;
    let sampleAt = performance.now();
    let sampleBytes = 0;
    let smoothedRate = 0;
    const multipart = blob instanceof FormData;
    const transferTimeout = multipart ? 90 * 1000 : UPLOAD_STALL_TIMEOUT_MS;
    const cleanup = () => {
      clearTimeout(stallTimer);
      controller.signal.removeEventListener("abort", onAbortSignal);
      xhr.onload = xhr.onerror = xhr.onabort = null;
      xhr.upload.onprogress = xhr.upload.onload = null;
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const fail = (error) => finish(reject, error);
    const abortError = () => {
      const error = forcedError || new Error("上传请求已中止");
      if (!forcedError) error.name = "AbortError";
      return error;
    };
    const resetStallTimer = (timeout = transferTimeout, message = "上传连接长时间没有传输数据") => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        forcedError = new Error(message);
        forcedError.code = "UPLOAD_STALLED";
        const error = abortError();
        xhr.abort();
        fail(error);
      }, timeout);
    };
    const onAbortSignal = () => {
      const error = abortError();
      xhr.abort();
      fail(error);
    };
    controller.signal.addEventListener("abort", onAbortSignal, { once: true });
    xhr.open(multipart ? "POST" : "PUT", url, true);
    xhr.withCredentials = true;
    if (!multipart) xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      resetStallTimer();
      const now = performance.now();
      const elapsed = now - sampleAt;
      if (elapsed >= 250) {
        const delta = Math.max(0, event.loaded - sampleBytes);
        const instant = (delta * 1000) / elapsed;
        smoothedRate = smoothedRate ? smoothedRate * 0.65 + instant * 0.35 : instant;
        sampleAt = now;
        sampleBytes = event.loaded;
      }
      try {
        onProgress?.({
          loaded: event.loaded,
          total: event.lengthComputable ? event.total : blob.size,
          bytesPerSecond: smoothedRate
        });
      } catch {}
    };
    xhr.upload.onload = () =>
      resetStallTimer(UPLOAD_RESPONSE_TIMEOUT_MS, "服务器超过 120 秒未确认该分片");
    xhr.onload = () => {
      let data = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) {
        finish(resolve, data);
        return;
      }
      const error = new Error(data?.error || `分片上传失败（${xhr.status}）`);
      error.status = xhr.status;
      const retryAfter = Number(xhr.getResponseHeader("Retry-After"));
      if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfter = retryAfter * 1000;
      fail(error);
    };
    xhr.onerror = () => {
      const error = new Error("上传连接已中断");
      error.code = "UPLOAD_NETWORK";
      fail(error);
    };
    xhr.onabort = () => fail(abortError());
    if (controller.signal.aborted) {
      onAbortSignal();
      return;
    }
    resetStallTimer();
    try {
      xhr.send(blob);
    } catch (error) {
      fail(
        ["NotReadableError", "NotFoundError"].includes(error.name) ? uploadFileReadError(error) : error
      );
    }
  });
}
async function uploadPartWithRetry(url, blob, job, { label = "当前分片", onProgress = null } = {}) {
  let lastError;
  let attempt = 0;
  while (attempt < 6) {
    await job.waitUntilReady();
    job.throwIfStopped();
    job.setState(attempt ? `正在重新连接并上传${label}…` : `正在上传${label}…`);
    const controller = job.beginPartRequest();
    try {
      return await uploadPartRequest(url, blob, controller, onProgress);
    } catch (error) {
      try {
        onProgress?.({ loaded: 0, total: blob.size, bytesPerSecond: 0, reset: true });
      } catch {}
      if (job.wasPausedAbort(controller) || job.wasNetworkAbort(controller)) continue;
      job.throwIfStopped();
      lastError = error;
      attempt += 1;
      const retryable =
        error.retryable !== false &&
        (!error.status ||
          error.status === 408 ||
          error.status === 425 ||
          error.status === 429 ||
          error.status >= 500);
      if (!retryable || attempt >= 6) break;
      const wait = Math.min(
        8000,
        error.retryAfter || 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 350)
      );
      const reason = error.status
        ? `服务器暂时无法接收（${error.status}）`
        : error.code === "UPLOAD_STALLED"
          ? error.message
          : "网络波动";
      job.setRate(0);
      job.setState(`${reason}，${Math.ceil(wait / 1000)} 秒后重试（${attempt}/6）…`);
      await job.waitForRetry(wait);
    } finally {
      job.endPartRequest(controller);
    }
  }
  throw lastError;
}
async function uploadAssetFile(
  file,
  {
    folderId = "",
    relativePath = "",
    assetId = "",
    variantLabel = "",
    sectionId = "",
    subsectionId = "",
    albumId = "",
    contentId = "",
    scope = "library",
    visibility = "",
    allowedUserIds = null,
    note = "",
    downloadPolicy = "",
    resumeCheckpoint = null
  } = {}
) {
  const job = createUploadJob(file, scope);
  let session = null;
  let checkpoint = null;
  let checkpointStored = false;
  const defaultChoice = visibilityPayload("asset-upload-visibility", "asset-upload-user-picker");
  const uploadVisibility = visibility || defaultChoice.visibility;
  const uploadAudience = allowedUserIds ?? defaultChoice.allowedUserIds;
  const context = {
    folderId,
    relativePath: relativePath || file.webkitRelativePath || file.name,
    assetId,
    variantLabel,
    sectionId,
    subsectionId,
    albumId,
    contentId,
    scope
  };
  const targetSignature = uploadTargetSignature(context);
  const fileIdentity = uploadFileIdentity(file);
  try {
    if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error("请选择有效的非空文件");
    if (file.size > MAX_RESUMABLE_FILE_BYTES) throw new Error("单个文件不能超过 100GiB");
    job.update(0, "正在查找可恢复的上传…");
    checkpoint = resumeCheckpoint || (await findUploadCheckpoint(file, targetSignature));
    if (checkpoint?.sessionId) job.setSessionId(checkpoint.sessionId);
    if (checkpoint) {
      try {
        session = await api(`/api/admin/asset-uploads/${checkpoint.sessionId}`);
        if (
          Number(session.expectedSize) !== file.size ||
          Number(session.partSize) !== Number(checkpoint.partSize) ||
          String(session.assetId) !== String(checkpoint.assetId) ||
          String(session.variantLabel || "") !== String(variantLabel || "")
        ) {
          await deleteUploadCheckpoint(checkpoint.sessionId);
          checkpoint = null;
          session = null;
        } else {
          job.setSessionId(session.sessionId);
          job.update(0, "已找到断点，正在核对服务器分片…");
        }
      } catch (error) {
        if (error.status === 404 || error.status === 410) {
          const completed = completedCheckpointAsset(checkpoint, variantLabel);
          await deleteUploadCheckpoint(checkpoint.sessionId);
          if (completed) {
            job.finish("服务器已确认上传完成");
            return completed.id;
          }
          checkpoint = null;
          session = null;
        } else throw error;
      }
    }
    if (!session) {
      job.throwIfStopped();
      job.update(0, "正在建立上传会话…");
      session = await api("/api/admin/asset-uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId,
          variantLabel,
          folderId,
          sectionId,
          subsectionId,
          albumId,
          contentId,
          scope,
          filename: file.name,
          displayName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          relativePath: context.relativePath,
          note,
          visibility: uploadVisibility,
          allowedUserIds: uploadAudience,
          downloadPolicy: downloadPolicy || document.getElementById("asset-download-policy").value
        })
      });
      checkpoint = {
        sessionId: session.sessionId,
        assetId: session.assetId,
        variantLabel: String(variantLabel || ""),
        fileIdentity,
        targetSignature,
        fileName: file.name,
        sizeBytes: file.size,
        lastModified: Number(file.lastModified || 0),
        relativePath: context.relativePath,
        scope,
        partSize: session.partSize,
        expiresAt: session.expiresAt,
        downloadPolicy: downloadPolicy || document.getElementById("asset-download-policy").value
      };
    }
    job.setSessionId(session.sessionId);
    checkpointStored = await saveUploadCheckpoint(checkpoint);
    const partSize = Number(session.partSize);
    const count = Math.ceil(file.size / partSize);
    if (!Number.isSafeInteger(partSize) || partSize <= 0 || partSize > 95 * 1024 * 1024)
      throw new Error("服务器返回了无效的分片大小");
    if (count > Number(session.maxParts || 10000)) throw new Error("文件分片数超过存储上限");
    const parts = new Map();
    for (const part of session.uploadedParts || []) {
      const partNumber = Number(part.partNumber);
      const expected = Math.min(partSize, file.size - (partNumber - 1) * partSize);
      if (
        Number.isInteger(partNumber) &&
        partNumber >= 1 &&
        partNumber <= count &&
        part.etag &&
        Number(part.sizeBytes) === expected
      )
        parts.set(partNumber, { partNumber, etag: String(part.etag), sizeBytes: expected });
    }
    let uploadedBytes = [...parts.values()].reduce((sum, part) => sum + part.sizeBytes, 0);
    const missing = Array.from({ length: count }, (_, index) => index + 1).filter(
      (partNumber) => !parts.has(partNumber)
    );
    let cursor = 0;
    let firstFailure = null;
    const activeRates = new Map();
    const activeLoaded = new Map();
    const refreshUploadMetrics = () => {
      job.setRate([...activeRates.values()].reduce((sum, value) => sum + (Number(value) || 0), 0));
      const sentBytes = Math.min(
        file.size,
        uploadedBytes +
          [...activeLoaded.values()].reduce((sum, value) => sum + (Number(value) || 0), 0)
      );
      job.update(
        (sentBytes / file.size) * 100,
        `正在上传 ${formatBytes(sentBytes)} / ${formatBytes(file.size)}`
      );
    };
    const worker = async (workerIndex) => {
      while (true) {
        job.throwIfStopped();
        const position = cursor;
        cursor += 1;
        if (position >= missing.length) return;
        const partNumber = missing[position];
        const start = (partNumber - 1) * partSize;
        const end = Math.min(file.size, start + partSize);
        await job.waitUntilResumed();
        job.update((uploadedBytes / file.size) * 100, `上传第 ${partNumber}/${count} 片…`);
        const rateKey = `${workerIndex}:${partNumber}`;
        activeRates.set(rateKey, 0);
        activeLoaded.set(rateKey, 0);
        try {
          const result = await uploadPartWithRetry(
            `/api/admin/asset-uploads/${session.sessionId}/part/${partNumber}`,
            file.slice(start, end),
            job,
            {
              label: `第 ${partNumber}/${count} 片`,
              onProgress: (progress) => {
                activeRates.set(rateKey, progress.bytesPerSecond || 0);
                activeLoaded.set(rateKey, progress.loaded || 0);
                refreshUploadMetrics();
              }
            }
          );
          activeRates.set(rateKey, 0);
          activeLoaded.set(rateKey, 0);
          parts.set(partNumber, {
            partNumber: Number(result.partNumber),
            etag: String(result.etag),
            sizeBytes: end - start
          });
          uploadedBytes += end - start;
          job.update(
            (uploadedBytes / file.size) * 100,
            `已上传 ${formatBytes(uploadedBytes)} / ${formatBytes(file.size)}`
          );
        } catch (error) {
          if (!job.isCancelled() && !firstFailure) {
            firstFailure = error;
            job.abortForFailure(error);
          }
          throw error;
        } finally {
          activeRates.delete(rateKey);
          activeLoaded.delete(rateKey);
          refreshUploadMetrics();
        }
      }
    };
    const results = await Promise.allSettled(
      Array.from({ length: Math.min(uploadConcurrency(), Math.max(1, missing.length)) }, (_, index) =>
        worker(index)
      )
    );
    if (firstFailure) throw firstFailure;
    const rejected = results.find((result) => result.status === "rejected");
    if (rejected) throw rejected.reason;
    await job.waitUntilResumed();
    job.lock("正在合并并校验…");
    const completedParts = [...parts.values()]
      .sort((a, b) => a.partNumber - b.partNumber)
      .map(({ partNumber, etag }) => ({ partNumber, etag }));
    await api(`/api/admin/asset-uploads/${session.sessionId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parts: completedParts })
    });
    await deleteUploadCheckpoint(session.sessionId);
    job.finish("上传完成");
    return session.assetId;
  } catch (error) {
    if (job.isCancelled() || error?.cancelled) {
      if (job.shouldPreserveCheckpoint() && session?.sessionId) {
        job.cancelled("上传已停止，已确认的分片保留；重新选择同一文件可续传。", { autoRemove: true });
        throw new UploadCancelledError("上传已停止，断点已保留");
      }
      let cancelFailure = null;
      if (session?.sessionId) {
        try {
          await api(`/api/admin/asset-uploads/${session.sessionId}`, { method: "DELETE" });
        } catch (cancelError) {
          cancelFailure = cancelError;
        }
      }
      if (!cancelFailure && session?.sessionId) await deleteUploadCheckpoint(session.sessionId);
      const message = cancelFailure ? `取消请求未送达服务器：${cancelFailure.message}` : "上传已取消";
      job.cancelled(message, { autoRemove: !cancelFailure });
      const cancelledError = new UploadCancelledError(message);
      throw cancelledError;
    }
    const saved = Boolean(session?.sessionId && checkpointStored);
    job.fail(
      saved
        ? `上传中断：${error.message}；进度已保存，重新选择同一文件可继续。`
        : `上传失败：${error.message}`
    );
    throw error;
  }
}
async function ensureFolderPath(parts, parentId, choice) {
  let current = parentId || null;
  for (const rawName of parts) {
    const name = rawName.trim();
    if (!name) continue;
    let folder = app.assetFolders.find(
      (item) =>
        (item.parent_id || null) === current &&
        item.section_id === currentAssetSection() &&
        item.name === name
    );
    if (!folder) {
      const result = await api("/api/admin/asset-folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parentId: current, sectionId: currentAssetSection(), ...choice })
      });
      folder = {
        id: result.id,
        section_id: currentAssetSection(),
        parent_id: current,
        name,
        description: "",
        visibility: choice.visibility,
        allowed_user_ids: choice.allowedUserIds,
        sort_order: 0,
        folder_count: 0,
        asset_count: 0
      };
      app.assetFolders.push(folder);
    }
    current = folder.id;
  }
  return current;
}
async function runAssetUpload(
  files,
  {
    folderMode = false,
    sectionId = "",
    subsectionId = "",
    albumId = "",
    contentId = "",
    scope = "library",
    visibility = "",
    allowedUserIds = null,
    note = ""
  } = {}
) {
  if (!files.length) return;
  const notice = document.getElementById(
    scope === "section"
      ? "content-section-asset-notice"
      : scope === "gallery"
        ? "media-notice"
        : "asset-notice"
  );
  notice.textContent = `准备上传 ${files.length} 个文件…`;
  const choice = visibility
    ? { visibility, allowedUserIds: allowedUserIds || [] }
    : visibilityPayload("asset-upload-visibility", "asset-upload-user-picker");
  const batch = beginStudioUploadBatch();
  let completed = 0;
  try {
    for (const file of files) {
      try {
        uploadAborted(batch.signal);
        let folderId = scope === "library" ? app.currentAssetFolder : "";
        const relativePath = file.webkitRelativePath || file.name;
        if (folderMode) {
          const parts = relativePath.split("/").slice(0, -1);
          folderId = await ensureFolderPath(parts, app.currentAssetFolder, choice);
        }
        uploadAborted(batch.signal);
        await uploadAssetFile(file, {
          folderId,
          relativePath,
          sectionId,
          subsectionId,
          albumId,
          contentId,
          scope,
          note,
          ...choice
        });
        completed += 1;
        notice.textContent = `已完成 ${completed}/${files.length}`;
      } catch (error) {
        notice.textContent = error?.cancelled
          ? `本批上传已停止；已完成 ${completed}/${files.length}`
          : `${file.name} 上传失败：${error.message}`;
        break;
      }
    }
    if (completed || batch.signal.aborted) await Promise.all([loadAssets(), loadDashboard()]);
  } finally {
    batch.finish();
  }
}
