const extractBtn = document.getElementById("extract-btn");
const extractOnlyBtn = document.getElementById("extract-only-btn");
const copyBtn = document.getElementById("copy-btn");
const downloadDetailBtn = document.getElementById("download-detail-btn");
const downloadLinksBtn = document.getElementById("download-links-btn");
const clearDetailBtn = document.getElementById("clear-detail-btn");
const clearLinksBtn = document.getElementById("clear-links-btn");
const statusEl = document.getElementById("status");
const cacheStatusEl = document.getElementById("cache-status");
const outputEl = document.getElementById("output");
const hintEl = document.querySelector(".hint");
const pageModeEl = document.getElementById("page-mode");
const unsupportedNoticeEl = document.getElementById("unsupported-notice");
const searchOptionsEl = document.getElementById("search-options");
const searchActionsEl = document.getElementById("search-actions");
const itemActionsEl = document.querySelector(".item-actions");
const searchPagesInput = document.getElementById("search-pages");
const detailDelayInput = document.getElementById("detail-delay");
const cacheUrlsBtn = document.getElementById("cache-urls-btn");
const batchDetailBtn = document.getElementById("batch-detail-btn");
const deepCrawlBtn = document.getElementById("deep-crawl-btn");
const jobControlsEl = document.getElementById("job-controls");
const pauseJobBtn = document.getElementById("pause-job-btn");
const stopJobBtn = document.getElementById("stop-job-btn");

let lastPayload = null;
let lastMode = "item";

async function loadSearchSettings() {
  const stored = await chrome.storage.local.get(["jd_search_max_pages", "jd_detail_tab_delay_ms"]);
  const pages = parseInt(stored.jd_search_max_pages, 10);
  const delay = parseInt(stored.jd_detail_tab_delay_ms, 10);
  if (searchPagesInput && Number.isFinite(pages) && pages >= 1) {
    searchPagesInput.value = String(Math.min(pages, 50));
  }
  if (detailDelayInput && Number.isFinite(delay) && delay >= 500) {
    detailDelayInput.value = String(Math.min(delay, 15000));
  }
}

async function saveSearchSettings() {
  const pages = Math.min(50, Math.max(1, parseInt(searchPagesInput?.value, 10) || 5));
  const delay = Math.min(15000, Math.max(500, parseInt(detailDelayInput?.value, 10) || 2500));
  if (searchPagesInput) searchPagesInput.value = String(pages);
  if (detailDelayInput) detailDelayInput.value = String(delay);
  await chrome.storage.local.set({
    jd_search_max_pages: pages,
    jd_detail_tab_delay_ms: delay,
  });
  return { pages, delay };
}

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`.trim();
}

function detectMode(url) {
  return window.JdPageUrl?.detectPageMode(url) || "unsupported";
}

function assertMode(expected, label) {
  if (lastMode === expected) return;
  if (expected === "item") {
    throw new Error(`请在商品详情页使用「${label}」`);
  }
  if (expected === "list") {
    throw new Error(`请在搜索/分类列表页使用「${label}」`);
  }
  throw new Error("当前页面不支持此操作");
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

async function injectSearchScripts(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [
      "src/jd-page-url.js",
      "src/human-scroll.js",
      "src/human-mouse.js",
      "src/search-extractor.js",
      "src/download.js",
      "src/search-content.js",
    ],
  });
}

async function injectItemScripts(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [
      "src/jd-page-url.js",
      "src/human-scroll.js",
      "src/extractor.js",
      "src/download.js",
      "src/content.js",
    ],
  });
}

async function sendSearchMessage(tab, type, options = {}) {
  async function send() {
    return chrome.tabs.sendMessage(tab.id, { type, options });
  }
  try {
    return await send();
  } catch (_) {
    await injectSearchScripts(tab.id);
    return send();
  }
}

async function extractItemFromTab(tab, { download = false } = {}) {
  if (!tab?.id || detectMode(tab.url) !== "item") {
    throw new Error("请先打开京东商品详情页 (item.jd.com/xxx.html)");
  }

  const payload = {
    type: "EXTRACT_JD_PRODUCT_WITH_SCROLL",
    options: { scroll: true, save: true, download },
  };

  async function sendExtract() {
    return chrome.tabs.sendMessage(tab.id, payload);
  }

  try {
    return await sendExtract();
  } catch (_) {
    await injectItemScripts(tab.id);
    return sendExtract();
  }
}

async function cacheSearchUrlsFromTab(tab, maxPages = 1) {
  if (!tab?.id || detectMode(tab.url) !== "list") {
    throw new Error("请先打开京东搜索/分类列表页");
  }
  const response = await sendSearchMessage(tab, "CACHE_JD_SEARCH_URLS", { maxPages });
  if (!response?.ok) throw new Error(response?.error || "缓存链接失败");
  const saved = await chrome.runtime.sendMessage({
    type: "APPEND_PRODUCT_URLS",
    urls: response.data.urls,
  });
  if (!saved?.ok) throw new Error(saved?.error || "保存链接缓存失败");
  return { response, saved };
}

async function runBatchDetailFromPopup(tab) {
  if (!tab?.id || detectMode(tab.url) !== "list") {
    throw new Error("请在搜索/分类列表页打开本扩展，并保持该标签处于活动状态");
  }
  const queue = await chrome.runtime.sendMessage({ type: "GET_PRODUCT_URLS" });
  if (!queue?.ok || !queue.count) {
    throw new Error("链接缓存为空，请先「翻页缓存链接」");
  }

  const { delay } = await saveSearchSettings();
  const timeoutMs = queue.count * (90000 + delay);

  const response = await withTimeout(
    sendSearchMessage(tab, "RUN_BATCH_DETAIL_FROM_QUEUE"),
    timeoutMs,
    "批量详情提取超时，请减少链接数量或提高间隔后重试"
  );
  if (!response?.ok) throw new Error(response?.error || "批量详情提取失败");
  return queue;
}

function stripInternalFields(data) {
  const { _validation_errors, _errors, ...rest } = data;
  return { data: rest, validationErrors: _validation_errors || [], errors: _errors || [] };
}

function updateUiForTab(tab) {
  const mode = detectMode(tab?.url);
  lastMode = mode;

  const isItem = mode === "item";
  const isList = mode === "list";

  if (itemActionsEl) itemActionsEl.hidden = !isItem;
  if (searchOptionsEl) searchOptionsEl.hidden = !isList;
  if (searchActionsEl) searchActionsEl.hidden = !isList;
  if (clearLinksBtn) clearLinksBtn.hidden = !isList;
  if (unsupportedNoticeEl) unsupportedNoticeEl.hidden = mode !== "unsupported";

  if (pageModeEl) {
    pageModeEl.hidden = false;
    pageModeEl.textContent = JdPageUrl.pageModeLabel(mode);
    pageModeEl.className = `page-mode mode-${mode}`;
  }

  if (hintEl) {
    if (isItem) {
      hintEl.textContent =
        "商品页会先平滑滚屏再提取；「只提取」仅写入详情缓存，不触发下载";
    } else if (isList) {
      hintEl.textContent =
        "推荐：先「翻页缓存链接」→「批量详情提取」；或直接「逐一点开详情提取」";
    } else {
      hintEl.textContent = "下方可管理已缓存的详情/链接数据";
    }
  }

  if (!isItem && lastPayload) {
    lastPayload = null;
    if (outputEl) outputEl.textContent = "";
    copyBtn.disabled = true;
  }
}

function setBusy(busy) {
  if (extractBtn) extractBtn.disabled = busy;
  if (extractOnlyBtn) extractOnlyBtn.disabled = busy;
  copyBtn.disabled = busy || !lastPayload;
  if (cacheUrlsBtn) cacheUrlsBtn.disabled = busy;
  if (batchDetailBtn) batchDetailBtn.disabled = busy;
  if (deepCrawlBtn) deepCrawlBtn.disabled = busy;
}

async function getCrawlJobState() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "GET_CRAWL_JOB_STATE" });
    return res?.state || { active: false, paused: false, stopped: false };
  } catch (_) {
    return { active: false, paused: false, stopped: false };
  }
}

function updateJobControlsUi(state) {
  const active = !!state?.active;
  if (jobControlsEl) jobControlsEl.hidden = !active;
  if (pauseJobBtn) {
    pauseJobBtn.disabled = !active;
    pauseJobBtn.textContent = state?.paused ? "继续" : "暂停";
  }
  if (stopJobBtn) stopJobBtn.disabled = !active;

  if (active) {
    if (cacheUrlsBtn) cacheUrlsBtn.disabled = true;
    if (batchDetailBtn) batchDetailBtn.disabled = true;
    if (deepCrawlBtn) deepCrawlBtn.disabled = true;
  }
}

async function syncJobControlsFromBackground() {
  const state = await getCrawlJobState();
  updateJobControlsUi(state);
  if (!state.active) {
    const tab = await getActiveTab();
    const busy = false;
    if (detectMode(tab?.url) === "list") {
      if (cacheUrlsBtn) cacheUrlsBtn.disabled = busy;
      if (batchDetailBtn) batchDetailBtn.disabled = busy;
      if (deepCrawlBtn) deepCrawlBtn.disabled = busy;
    }
  }
}

async function runItemExtract({ download }) {
  const tab = await getActiveTab();
  updateUiForTab(tab);

  if (tab?.id) {
    await chrome.tabs.update(tab.id, { active: true });
  }

  setStatus(download ? "正在滚动页面并提取（请看商品页标签）…" : "正在滚动并只写入详情缓存（请看商品页）…");

  const response = await withTimeout(
    extractItemFromTab(tab, { download }),
    120000,
    "提取超时：请确认商品页在前台且已加载完成"
  );

  if (!response?.ok) throw new Error(response?.error || "提取失败");

  const { data, validationErrors } = stripInternalFields(response.data);
  lastPayload = data;
  outputEl.textContent = JSON.stringify(data, null, 2);
  copyBtn.disabled = false;

  const count = response.saved?.count ?? "?";
  if (download) {
    if (validationErrors.length) {
      setStatus(`已提取并下载详情 JSONL（详情缓存 ${count} 条），校验: ${validationErrors.join("; ")}`, "warn");
    } else {
      setStatus(`已提取并下载详情 JSONL（详情缓存 ${count} 条）`, "ok");
    }
  } else if (validationErrors.length) {
    setStatus(`已写入详情缓存（${count} 条），校验: ${validationErrors.join("; ")}`, "warn");
  } else {
    setStatus(`已写入详情缓存（${count} 条），未下载文件`, "ok");
  }
}

async function refreshCacheStatus() {
  const [details, links] = await Promise.all([
    chrome.runtime.sendMessage({ type: "GET_JSONL_RECORDS" }),
    chrome.runtime.sendMessage({ type: "GET_PRODUCT_URLS" }),
  ]);
  const detailCount = details?.ok ? details.count : 0;
  const linkCount = links?.ok ? links.count : 0;
  if (cacheStatusEl) {
    cacheStatusEl.textContent = `当前缓存：详情 ${detailCount} 条，链接队列 ${linkCount} 条`;
  }
}

if (extractOnlyBtn) {
  extractOnlyBtn.addEventListener("click", async () => {
    setBusy(true);
    copyBtn.disabled = true;
    outputEl.textContent = "";
    try {
      assertMode("item", "只提取商品信息");
      await runItemExtract({ download: false });
      await refreshCacheStatus();
    } catch (error) {
      lastPayload = null;
      setStatus(String(error.message || error), "error");
    } finally {
      setBusy(false);
    }
  });
}

if (extractBtn) {
  extractBtn.addEventListener("click", async () => {
    setBusy(true);
    copyBtn.disabled = true;
    outputEl.textContent = "";
    setStatus("正在提取…");

    try {
      const tab = await getActiveTab();
      updateUiForTab(tab);
      assertMode("item", "提取并下载 JSONL");
      await runItemExtract({ download: true });
      await refreshCacheStatus();
    } catch (error) {
      lastPayload = null;
      setStatus(String(error.message || error), "error");
    } finally {
      setBusy(false);
    }
  });
}

if (cacheUrlsBtn) {
  cacheUrlsBtn.addEventListener("click", async () => {
    setBusy(true);
    setStatus("正在翻页并缓存商品链接…");
    try {
      const tab = await getActiveTab();
      updateUiForTab(tab);
      assertMode("list", "翻页缓存链接");
      const { pages } = await saveSearchSettings();
      const timeoutMs = 60000 + pages * 55000;
      const { response, saved } = await withTimeout(
        cacheSearchUrlsFromTab(tab, pages),
        timeoutMs,
        "缓存链接超时"
      );
      setStatus(
        `已缓存 ${response.data.count} 个链接（${response.data.pages || 1} 页），链接缓存共 ${saved.count} 条`,
        "ok"
      );
      await refreshCacheStatus();
    } catch (error) {
      setStatus(String(error.message || error), "error");
    } finally {
      setBusy(false);
    }
  });
}

if (deepCrawlBtn) {
  deepCrawlBtn.addEventListener("click", async () => {
    setBusy(true);
    setStatus("深度抓取中：请保持搜索页标签在前台，过程较长…");
    try {
      const tab = await getActiveTab();
      updateUiForTab(tab);
      assertMode("list", "逐一点开详情提取");
      const { pages } = await saveSearchSettings();
      const timeoutMs = 120000 + pages * 120000;
      await withTimeout(
        sendSearchMessage(tab, "DEEP_CRAWL_JD_SEARCH", {
          maxPages: pages,
          multiPage: pages > 1,
          downloadAtEnd: true,
        }),
        timeoutMs,
        "深度抓取超时，请减少翻页数或提高详情间隔"
      );
      const records = await chrome.runtime.sendMessage({ type: "GET_JSONL_RECORDS" });
      setStatus(`深度抓取完成，详情缓存 ${records?.count ?? "?"} 条`, "ok");
      await refreshCacheStatus();
    } catch (error) {
      setStatus(String(error.message || error), "error");
    } finally {
      setBusy(false);
    }
  });
}

if (batchDetailBtn) {
  batchDetailBtn.addEventListener("click", async () => {
    setBusy(true);
    setStatus("正在批量打开详情页并提取（请勿关闭搜索标签页）…");
    try {
      const tab = await getActiveTab();
      updateUiForTab(tab);
      assertMode("list", "批量详情提取");
      const queue = await runBatchDetailFromPopup(tab);
      const records = await chrome.runtime.sendMessage({ type: "GET_JSONL_RECORDS" });
      setStatus(
        `批量详情提取完成，链接缓存 ${queue.count} 条，详情缓存 ${records?.count ?? "?"} 条`,
        "ok"
      );
      await refreshCacheStatus();
    } catch (error) {
      setStatus(String(error.message || error), "error");
    } finally {
      setBusy(false);
    }
  });
}

copyBtn.addEventListener("click", async () => {
  if (!lastPayload) return;
  await navigator.clipboard.writeText(JSON.stringify(lastPayload, null, 2));
  setStatus("已复制到剪贴板", "ok");
});

if (downloadDetailBtn) {
  downloadDetailBtn.addEventListener("click", async () => {
    const stored = await chrome.runtime.sendMessage({ type: "GET_JSONL_RECORDS" });
    if (!stored?.ok || !stored.count) {
      setStatus("详情缓存为空，请先在商品页或批量详情中提取", "warn");
      return;
    }

    try {
      JdJsonlDownload.downloadRecords(
        stored.records,
        stored.filename || `jd-details-${new Date().toISOString().slice(0, 10)}.jsonl`
      );
      setStatus(`已下载详情 JSONL（${stored.count} 条）`, "ok");
    } catch (error) {
      setStatus(String(error.message || error), "error");
    }
  });
}

if (downloadLinksBtn) {
  downloadLinksBtn.addEventListener("click", async () => {
    const stored = await chrome.runtime.sendMessage({ type: "GET_PRODUCT_URLS" });
    if (!stored?.ok || !stored.count) {
      setStatus("链接缓存为空，请先在搜索页「翻页缓存链接」", "warn");
      return;
    }

    try {
      JdJsonlDownload.downloadRecords(
        stored.urls,
        stored.filename || `jd-links-${new Date().toISOString().slice(0, 10)}.jsonl`
      );
      setStatus(`已下载链接 JSONL（${stored.count} 条）`, "ok");
    } catch (error) {
      setStatus(String(error.message || error), "error");
    }
  });
}

if (clearLinksBtn) {
  clearLinksBtn.addEventListener("click", async () => {
    const cleared = await chrome.runtime.sendMessage({ type: "CLEAR_PRODUCT_URLS" });
    if (!cleared?.ok) {
      setStatus(cleared?.error || "清空链接缓存失败", "error");
      return;
    }
    setStatus("已清空链接缓存", "ok");
    await refreshCacheStatus();
  });
}

if (clearDetailBtn) {
  clearDetailBtn.addEventListener("click", async () => {
    const cleared = await chrome.runtime.sendMessage({ type: "CLEAR_JSONL_RECORDS" });
    if (!cleared?.ok) {
      setStatus(cleared?.error || "清空失败", "error");
      return;
    }
    setStatus("已清空详情缓存", "ok");
    await refreshCacheStatus();
  });
}

async function syncUiToActiveTab() {
  const tab = await getActiveTab();
  updateUiForTab(tab);
  await refreshCacheStatus();
  await syncJobControlsFromBackground();
}

function bindTabRefresh() {
  chrome.tabs.onActivated.addListener(() => {
    syncUiToActiveTab();
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!changeInfo.url && changeInfo.status !== "complete") return;
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.id === tabId) syncUiToActiveTab();
    });
  });
}

if (pauseJobBtn) {
  pauseJobBtn.addEventListener("click", async () => {
    const state = await getCrawlJobState();
    if (!state.active) return;
    if (state.paused) {
      await chrome.runtime.sendMessage({ type: "CRAWL_JOB_RESUME" });
      setStatus("已继续任务", "ok");
    } else {
      await chrome.runtime.sendMessage({ type: "CRAWL_JOB_PAUSE" });
      setStatus("已暂停，点击「继续」恢复", "ok");
    }
    await syncJobControlsFromBackground();
  });
}

if (stopJobBtn) {
  stopJobBtn.addEventListener("click", async () => {
    const state = await getCrawlJobState();
    if (!state.active) return;
    await chrome.runtime.sendMessage({ type: "CRAWL_JOB_STOP" });
    setStatus("正在结束任务…", "ok");
    await syncJobControlsFromBackground();
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "CRAWL_JOB_STATE_CHANGED") {
    updateJobControlsUi(message.state);
    syncJobControlsFromBackground();
  }
});

loadSearchSettings();
bindTabRefresh();
syncUiToActiveTab();
syncJobControlsFromBackground();
