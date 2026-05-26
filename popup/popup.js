const extractBtn = document.getElementById("extract-btn");
const extractOnlyBtn = document.getElementById("extract-only-btn");
const copyBtn = document.getElementById("copy-btn");
const downloadAllBtn = document.getElementById("download-all-btn");
const clearBtn = document.getElementById("clear-btn");
const clearUrlsBtn = document.getElementById("clear-urls-btn");
const statusEl = document.getElementById("status");
const outputEl = document.getElementById("output");
const hintEl = document.querySelector(".hint");
const searchOptionsEl = document.getElementById("search-options");
const searchActionsEl = document.getElementById("search-actions");
const searchPagesInput = document.getElementById("search-pages");
const detailDelayInput = document.getElementById("detail-delay");
const cacheUrlsBtn = document.getElementById("cache-urls-btn");
const batchDetailBtn = document.getElementById("batch-detail-btn");
const deepCrawlBtn = document.getElementById("deep-crawl-btn");

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

function isJdItemUrl(url) {
  return /^https:\/\/item\.(jd|jkcsjd|yiyaojd|jingxi)\.com\/\d+\.html/.test(url || "");
}

function isJdSearchUrl(url) {
  return /^https:\/\/(search|list)\.jd\.com\//i.test(url || "");
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
    files: ["src/human-scroll.js", "src/extractor.js", "src/download.js", "src/content.js"],
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
  if (!tab?.id || !isJdItemUrl(tab.url)) {
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

async function extractSearchFromTab(tab, maxPages = 1) {
  if (!tab?.id || !isJdSearchUrl(tab.url)) {
    throw new Error("请先打开京东搜索页 (search.jd.com/Search?keyword=...)");
  }
  return sendSearchMessage(tab, "EXTRACT_JD_SEARCH", { maxPages });
}

async function cacheSearchUrlsFromTab(tab, maxPages = 1) {
  if (!tab?.id || !isJdSearchUrl(tab.url)) {
    throw new Error("请先打开京东搜索页");
  }
  const response = await sendSearchMessage(tab, "CACHE_JD_SEARCH_URLS", { maxPages });
  if (!response?.ok) throw new Error(response?.error || "缓存链接失败");
  const saved = await chrome.runtime.sendMessage({
    type: "APPEND_PRODUCT_URLS",
    urls: response.data.urls,
  });
  if (!saved?.ok) throw new Error(saved?.error || "保存链接队列失败");
  return { response, saved };
}

async function runBatchDetailFromPopup(tab) {
  if (!tab?.id || !isJdSearchUrl(tab.url)) {
    throw new Error("请在搜索页打开本扩展，或保持搜索标签页处于活动状态");
  }
  const queue = await chrome.runtime.sendMessage({ type: "GET_PRODUCT_URLS" });
  if (!queue?.ok || !queue.count) {
    throw new Error("链接队列为空，请先「翻页缓存链接」");
  }

  const { delay } = await saveSearchSettings();
  const timeoutMs = queue.count * (90000 + delay);

  const response = await withTimeout(
    sendSearchMessage(tab, "RUN_BATCH_DETAIL_FROM_QUEUE"),
    timeoutMs,
    "批量详情提取超时，请减少队列长度或提高间隔后重试"
  );
  if (!response?.ok) throw new Error(response?.error || "批量详情提取失败");
  return queue;
}

function stripInternalFields(data) {
  const { _validation_errors, _errors, ...rest } = data;
  return { data: rest, validationErrors: _validation_errors || [], errors: _errors || [] };
}

function updateUiForTab(tab) {
  const isSearch = isJdSearchUrl(tab?.url);
  if (isSearch) {
    lastMode = "search";
    extractBtn.textContent = "② 翻页提取 JSONL";
    if (extractOnlyBtn) extractOnlyBtn.hidden = true;
    if (searchOptionsEl) searchOptionsEl.hidden = false;
    if (searchActionsEl) searchActionsEl.hidden = false;
    if (clearUrlsBtn) clearUrlsBtn.hidden = false;
    if (hintEl) {
      hintEl.textContent =
        "推荐 ⑥⑦：先提取本页列表，再模拟点击每个商品→详情滚屏→缓存；⑦ 支持自动翻页";
    }
  } else {
    lastMode = "item";
    extractBtn.textContent = "提取并下载 JSONL";
    if (extractOnlyBtn) extractOnlyBtn.hidden = false;
    if (searchOptionsEl) searchOptionsEl.hidden = true;
    if (searchActionsEl) searchActionsEl.hidden = true;
    if (clearUrlsBtn) clearUrlsBtn.hidden = true;
    if (hintEl) {
      hintEl.textContent =
        "商品页会先贝塞尔平滑滚到底再提取；「只提取」仅写入缓存，不触发下载";
    }
  }
}

function setBusy(busy) {
  extractBtn.disabled = busy;
  if (extractOnlyBtn) extractOnlyBtn.disabled = busy;
  copyBtn.disabled = busy || !lastPayload;
  if (cacheUrlsBtn) cacheUrlsBtn.disabled = busy;
  if (batchDetailBtn) batchDetailBtn.disabled = busy;
  if (deepCrawlBtn) deepCrawlBtn.disabled = busy;
}

async function runItemExtract({ download }) {
  const tab = await getActiveTab();
  updateUiForTab(tab);

  if (tab?.id) {
    await chrome.tabs.update(tab.id, { active: true });
  }

  setStatus(download ? "正在滚动页面并提取（请看商品页标签）…" : "正在滚动并只提取到缓存（请看商品页）…");

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
      setStatus(`已滚动提取并下载 JSONL（缓存 ${count} 条），校验: ${validationErrors.join("; ")}`, "warn");
    } else {
      setStatus(`已滚动提取并下载 JSONL（缓存 ${count} 条）`, "ok");
    }
  } else if (validationErrors.length) {
    setStatus(`已提取到缓存（${count} 条），校验: ${validationErrors.join("; ")}`, "warn");
  } else {
    setStatus(`已提取到缓存（${count} 条），未下载文件`, "ok");
  }
}

if (extractOnlyBtn) {
  extractOnlyBtn.addEventListener("click", async () => {
    setBusy(true);
    copyBtn.disabled = true;
    outputEl.textContent = "";
    try {
      await runItemExtract({ download: false });
    } catch (error) {
      lastPayload = null;
      setStatus(String(error.message || error), "error");
    } finally {
      setBusy(false);
    }
  });
}

extractBtn.addEventListener("click", async () => {
  setBusy(true);
  copyBtn.disabled = true;
  outputEl.textContent = "";
  setStatus("正在提取…");

  try {
    const tab = await getActiveTab();
    updateUiForTab(tab);

    if (lastMode === "search") {
      const { pages } = await saveSearchSettings();
      const timeoutMs = 60000 + pages * 55000;

      const response = await withTimeout(
        extractSearchFromTab(tab, pages),
        timeoutMs,
        "提取超时：请确认搜索页已加载，或调低翻页数"
      );

      if (!response?.ok) throw new Error(response?.error || "提取失败");

      const products = response.data.products.map(({ _validation_errors, ...row }) => row);
      lastPayload = products;

      const saved = await chrome.runtime.sendMessage({
        type: "APPEND_JSONL_RECORDS",
        products,
      });

      if (!saved?.ok) throw new Error(saved?.error || "保存 JSONL 缓存失败");

      JdJsonlDownload.downloadRecords(
        saved.records,
        saved.filename || `jd-search-${new Date().toISOString().slice(0, 10)}.jsonl`
      );

      outputEl.textContent = JSON.stringify(
        {
          keyword: response.data.keyword,
          pages: response.data.pages,
          count: response.data.count,
          products,
        },
        null,
        2
      );
      copyBtn.disabled = false;
      setStatus(
        `已提取 ${response.data.count} 条（${response.data.pages || 1} 页）并下载 JSONL（缓存 ${saved.count} 条）`,
        "ok"
      );
      return;
    }

    await runItemExtract({ download: true });
  } catch (error) {
    lastPayload = null;
    setStatus(String(error.message || error), "error");
  } finally {
    setBusy(false);
  }
});

if (cacheUrlsBtn) {
  cacheUrlsBtn.addEventListener("click", async () => {
    setBusy(true);
    setStatus("正在翻页并缓存商品链接…");
    try {
      const tab = await getActiveTab();
      updateUiForTab(tab);
      const { pages } = await saveSearchSettings();
      const timeoutMs = 60000 + pages * 55000;
      const { response, saved } = await withTimeout(
        cacheSearchUrlsFromTab(tab, pages),
        timeoutMs,
        "缓存链接超时"
      );
      setStatus(
        `已缓存 ${response.data.count} 个链接（${response.data.pages || 1} 页），队列共 ${saved.count} 条`,
        "ok"
      );
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
      setStatus(`深度抓取完成，JSONL 缓存 ${records?.count ?? "?"} 条`, "ok");
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
      const queue = await runBatchDetailFromPopup(tab);
      const records = await chrome.runtime.sendMessage({ type: "GET_JSONL_RECORDS" });
      setStatus(
        `批量详情提取已启动/完成，链接队列 ${queue.count} 条，JSONL 缓存 ${records?.count ?? "?"} 条`,
        "ok"
      );
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

downloadAllBtn.addEventListener("click", async () => {
  const stored = await chrome.runtime.sendMessage({ type: "GET_JSONL_RECORDS" });
  if (!stored?.ok || !stored.count) {
    setStatus("缓存为空，请先提取商品", "warn");
    return;
  }

  try {
    JdJsonlDownload.downloadRecords(
      stored.records,
      `jd-products-${new Date().toISOString().slice(0, 10)}.jsonl`
    );
    setStatus(`已下载 JSONL（${stored.count} 条）`, "ok");
  } catch (error) {
    setStatus(String(error.message || error), "error");
  }
});

if (clearUrlsBtn) {
  clearUrlsBtn.addEventListener("click", async () => {
    const cleared = await chrome.runtime.sendMessage({ type: "CLEAR_PRODUCT_URLS" });
    if (!cleared?.ok) {
      setStatus(cleared?.error || "清空链接队列失败", "error");
      return;
    }
    setStatus("已清空商品链接队列", "ok");
  });
}

clearBtn.addEventListener("click", async () => {
  const cleared = await chrome.runtime.sendMessage({ type: "CLEAR_JSONL_RECORDS" });
  if (!cleared?.ok) {
    setStatus(cleared?.error || "清空失败", "error");
    return;
  }
  setStatus("已清空 JSONL 缓存", "ok");
});

loadSearchSettings();
getActiveTab().then(async (tab) => {
  updateUiForTab(tab);
  const [stored, urls] = await Promise.all([
    chrome.runtime.sendMessage({ type: "GET_JSONL_RECORDS" }),
    chrome.runtime.sendMessage({ type: "GET_PRODUCT_URLS" }),
  ]);
  const parts = [];
  if (stored?.ok && stored.count) parts.push(`JSONL ${stored.count} 条`);
  if (urls?.ok && urls.count) parts.push(`链接队列 ${urls.count} 条`);
  if (parts.length) setStatus(`当前缓存：${parts.join("，")}`, "");
});
