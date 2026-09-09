const extractBtn = document.getElementById("extract-btn");
const copyBtn = document.getElementById("copy-btn");
const downloadDetailBtn = document.getElementById("download-detail-btn");
const clearDetailBtn = document.getElementById("clear-detail-btn");
const statusEl = document.getElementById("status");
const cacheStatusEl = document.getElementById("cache-status");
const outputEl = document.getElementById("output");
const hintEl = document.querySelector(".hint");
const pageModeEl = document.getElementById("page-mode");
const unsupportedNoticeEl = document.getElementById("unsupported-notice");
const searchActionsEl = document.getElementById("search-actions");
const itemActionsEl = document.querySelector(".item-actions");
const extractListBtn = document.getElementById("extract-list-btn");

let lastPayload = null;
let lastMode = "item";

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
    throw new Error(`请在淘宝/天猫搜索列表页使用「${label}」`);
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

function detectPlatform(url) {
  return window.JdPageUrl?.detectPlatform(url) || null;
}

async function injectSearchScripts(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [
      "src/jd-page-url.js",
      "src/taobao-risk.js",
      "src/human-scroll.js",
      "src/human-mouse.js",
      "src/taobao-search-extractor.js",
      "src/download.js",
      "src/taobao-search-content.js",
    ],
  });
}

async function injectItemScripts(tabId, platform = "jd") {
  const files =
    platform === "taobao"
      ? [
          "src/jd-page-url.js",
          "src/tmall-extractor.js",
          "src/download.js",
          "src/tmall-content.js",
        ]
      : [
          "src/jd-page-url.js",
          "src/human-scroll.js",
          "src/extractor.js",
          "src/download.js",
          "src/content.js",
        ];
  await chrome.scripting.executeScript({
    target: { tabId },
    files,
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

async function extractItemFromTab(tab) {
  if (!tab?.id || detectMode(tab.url) !== "item") {
    throw new Error("请先打开京东/天猫商品详情页");
  }
  const platform = detectPlatform(tab.url) || "jd";

  const payload =
    platform === "taobao"
      ? { type: "EXTRACT_TMALL_PRODUCT", options: { save: true } }
      : {
          type: "EXTRACT_JD_PRODUCT_WITH_SCROLL",
          options: { scroll: false, save: true },
        };

  async function sendExtract() {
    return chrome.tabs.sendMessage(tab.id, payload);
  }

  try {
    return await sendExtract();
  } catch (_) {
    await injectItemScripts(tab.id, platform);
    return sendExtract();
  }
}

async function extractSearchListFromTab(tab, maxPages = 1) {
  if (!tab?.id || detectMode(tab.url) !== "list") {
    throw new Error("请先打开淘宝/天猫搜索列表页");
  }
  const response = await sendSearchMessage(tab, "EXTRACT_TAOBAO_SEARCH_LIST", { maxPages });
  if (!response?.ok) throw new Error(response?.error || "提取列表失败");

  let savedCount = 0;
  const saved = await chrome.runtime.sendMessage({
    type: "APPEND_JSONL_RECORDS",
    products: response.data.products,
  });
  if (saved?.ok) savedCount = saved.count;

  return { response, savedCount };
}

function stripInternalFields(data) {
  const { _validation_errors, _errors, ...rest } = data;
  return { data: rest, validationErrors: _validation_errors || [], errors: _errors || [] };
}

function updateUiForTab(tab) {
  const mode = detectMode(tab?.url);
  const platform = detectPlatform(tab?.url);
  lastMode = mode;

  const isItem = mode === "item";
  const isTaobaoList = mode === "list" && platform === "taobao";
  const isJdList = mode === "list" && platform !== "taobao";

  if (itemActionsEl) itemActionsEl.hidden = !isItem;
  if (searchActionsEl) searchActionsEl.hidden = !isTaobaoList;
  if (extractListBtn) extractListBtn.hidden = !isTaobaoList;
  if (unsupportedNoticeEl) unsupportedNoticeEl.hidden = !(isJdList || mode === "unsupported");
  if (unsupportedNoticeEl && isJdList) {
    unsupportedNoticeEl.innerHTML =
      "京东<strong>搜索/列表页</strong>的自动抓取功能已移除，请打开<strong>商品详情页</strong>或<strong>淘宝搜索列表页</strong>。";
  }

  if (pageModeEl) {
    pageModeEl.hidden = false;
    pageModeEl.textContent = JdPageUrl.pageModeLabel(mode, tab?.url);
    pageModeEl.className = `page-mode mode-${mode}`;
  }

  if (hintEl) {
    if (isItem && platform === "taobao") {
      hintEl.textContent = "天猫/淘宝商品页：直接点击提取即可；图文详情随页面滚动自动加载";
    } else if (isItem) {
      hintEl.textContent =
        "京东商品页需先手动向下滚动加载图文详情后再提取；提取结果写入详情缓存，可用「统一下载全部 JSONL」导出";
    } else if (isTaobaoList) {
      hintEl.textContent = "淘宝搜索页：「提取搜索列表」写入列表级商品数据，缓存到弹窗统一下载";
    } else {
      hintEl.textContent = "当前页面不支持本扩展";
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
  copyBtn.disabled = busy || !lastPayload;
  if (extractListBtn) extractListBtn.disabled = busy;
}

async function runItemExtract() {
  const tab = await getActiveTab();
  updateUiForTab(tab);

  if (tab?.id) {
    await chrome.tabs.update(tab.id, { active: true });
  }

  setStatus("正在提取并写入详情缓存（请看商品页）…");

  const response = await withTimeout(
    extractItemFromTab(tab),
    120000,
    "提取超时：请确认商品页在前台且已加载完成"
  );

  if (!response?.ok) {
    throw new Error(response?.error || "提取失败");
  }

  const { data, validationErrors } = stripInternalFields(response.data);
  lastPayload = data;
  outputEl.textContent = JSON.stringify(data, null, 2);
  copyBtn.disabled = false;

  const count = response.saved?.count ?? "?";
  if (validationErrors.length) {
    setStatus(`已写入详情缓存（${count} 条），校验: ${validationErrors.join("; ")}`, "warn");
  } else {
    setStatus(`已写入详情缓存（${count} 条），未下载文件`, "ok");
  }
}

async function refreshCacheStatus() {
  const details = await chrome.runtime.sendMessage({ type: "GET_JSONL_RECORDS" });
  const detailCount = details?.ok ? details.count : 0;
  const maxRecords = details?.ok && details.maxRecords ? details.maxRecords : 100;

  if (cacheStatusEl) {
    cacheStatusEl.textContent =
      `当前缓存：详情 ${detailCount} 条（最多保留 ${maxRecords} 条，超出自动删除最旧）`;
  }
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
      assertMode("item", "提取并写入缓存");
      await runItemExtract();
      await refreshCacheStatus();
    } catch (error) {
      lastPayload = null;
      setStatus(String(error.message || error), "error");
    } finally {
      setBusy(false);
    }
  });
}

if (extractListBtn) {
  extractListBtn.addEventListener("click", async () => {
    setBusy(true);
    setStatus("正在提取淘宝/天猫搜索列表…");
    try {
      const tab = await getActiveTab();
      updateUiForTab(tab);
      assertMode("list", "提取搜索列表");
      const timeoutMs = 120000;
      const { response, savedCount } = await withTimeout(
        extractSearchListFromTab(tab, 1),
        timeoutMs,
        "提取列表超时"
      );
      setStatus(
        `已提取 ${response.data.count} 条，详情缓存共 ${savedCount} 条，已写入缓存（可在「统一下载全部 JSONL」导出）`,
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
      setStatus("详情缓存为空，请先在商品页或搜索列表提取", "warn");
      return;
    }

    try {
      JdJsonlDownload.downloadRecords(
        stored.records,
        stored.filename || `cn-details-${new Date().toISOString().slice(0, 10)}.jsonl`
      );
      setStatus(`已统一下载全部 JSONL（共 ${stored.count} 条）`, "ok");
    } catch (error) {
      setStatus(String(error.message || error), "error");
    }
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

bindTabRefresh();
syncUiToActiveTab();