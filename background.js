/** 商品详情 ProductSource 记录（仅详情页 / 批量详情提取写入） */
const DETAIL_STORAGE_KEY = "jd_jsonl_records";
/** 搜索页收集的商品链接队列（导出为 jd-links-*.jsonl） */
const LINK_STORAGE_KEY = "jd_product_url_queue";
/** 验证/跳转首页后可恢复的抓取进度 */
const CHECKPOINT_STORAGE_KEY = "jd_crawl_checkpoint";

function isJdRiskUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (/(passport|aq)\.jd\.com/.test(lower)) return true;
  if (lower.includes("cfe.m.jd.com") || lower.includes("risk_handler")) return true;
  return false;
}

function isJdHomeUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host !== "www.jd.com" && host !== "jd.com") return false;
    const path = (u.pathname || "/").replace(/\/+$/, "") || "/";
    return path === "/";
  } catch (_) {
    return false;
  }
}

function isJdBlockedUrl(url) {
  return isJdRiskUrl(url) || isJdHomeUrl(url);
}

async function loadCheckpoint() {
  const stored = await chrome.storage.local.get(CHECKPOINT_STORAGE_KEY);
  const cp = stored[CHECKPOINT_STORAGE_KEY];
  return cp && typeof cp === "object" ? cp : null;
}

async function saveCheckpoint(checkpoint) {
  await chrome.storage.local.set({
    [CHECKPOINT_STORAGE_KEY]: {
      ...checkpoint,
      updated_at: new Date().toISOString(),
    },
  });
}

async function mergeCheckpoint(patch) {
  const prev = (await loadCheckpoint()) || {};
  await saveCheckpoint({ ...prev, ...patch });
}

async function clearCheckpoint() {
  await chrome.storage.local.remove(CHECKPOINT_STORAGE_KEY);
}

async function loadDetailRecords() {
  const stored = await chrome.storage.local.get(DETAIL_STORAGE_KEY);
  return Array.isArray(stored[DETAIL_STORAGE_KEY]) ? stored[DETAIL_STORAGE_KEY] : [];
}

async function saveDetailRecords(records) {
  await chrome.storage.local.set({ [DETAIL_STORAGE_KEY]: records });
}

async function loadLinkQueue() {
  const stored = await chrome.storage.local.get(LINK_STORAGE_KEY);
  return Array.isArray(stored[LINK_STORAGE_KEY]) ? stored[LINK_STORAGE_KEY] : [];
}

async function saveLinkQueue(urls) {
  await chrome.storage.local.set({ [LINK_STORAGE_KEY]: urls });
}

function defaultDetailFilename(records) {
  const stamp = new Date().toISOString().slice(0, 10);
  const sku = records.at(-1)?.product_id || records.at(-1)?.sku || "product";
  return `jd-details-${stamp}-${sku}.jsonl`;
}

function defaultLinksFilename(links) {
  const stamp = new Date().toISOString().slice(0, 10);
  const keyword = links[0]?.search_keyword || "links";
  const safeKeyword = String(keyword).replace(/[^\w\u4e00-\u9fa5-]+/g, "_").slice(0, 40);
  return `jd-links-${stamp}-${safeKeyword}.jsonl`;
}

function dedupeRecords(records, incoming) {
  let next = [...records];
  for (const product of incoming) {
    if (!product) continue;
    const dedupeKey = String(product.product_id || product.sku || product.url || "");
    if (dedupeKey) {
      next = next.filter((row) => String(row.product_id || row.sku || row.url || "") !== dedupeKey);
    }
    next.push(product);
  }
  return next;
}

function dedupeUrlEntries(queue, incoming) {
  const byKey = new Map();
  for (const row of queue) {
    const key = String(row.sku || row.url || "");
    if (key) byKey.set(key, row);
  }
  for (const row of incoming) {
    if (!row?.url) continue;
    const key = String(row.sku || row.url);
    byKey.set(key, { ...byKey.get(key), ...row });
  }
  return [...byKey.values()];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 长时间任务（批量详情、深度抓取、翻页缓存）的暂停/结束状态 */
const crawlJob = {
  active: false,
  paused: false,
  stopped: false,
  kind: null,
  tabId: null,
  detailTabId: null,
};

function crawlJobUserStoppedError() {
  const err = new Error("任务已结束");
  err.code = "USER_STOPPED";
  return err;
}

function assertCrawlJobNotStopped() {
  if (crawlJob.stopped) throw crawlJobUserStoppedError();
}

function getCrawlJobState() {
  return {
    active: crawlJob.active,
    paused: crawlJob.paused,
    stopped: crawlJob.stopped,
    kind: crawlJob.kind,
    tabId: crawlJob.tabId,
  };
}

function broadcastCrawlJobState() {
  const state = getCrawlJobState();
  chrome.runtime.sendMessage({ type: "CRAWL_JOB_STATE_CHANGED", state }).catch(() => {});
}

function crawlJobStart(kind, tabId) {
  crawlJob.active = true;
  crawlJob.paused = false;
  crawlJob.stopped = false;
  crawlJob.kind = kind;
  crawlJob.tabId = tabId ?? null;
  crawlJob.detailTabId = null;
  broadcastCrawlJobState();
}

function crawlJobEnd() {
  crawlJob.active = false;
  crawlJob.paused = false;
  crawlJob.stopped = false;
  crawlJob.kind = null;
  crawlJob.tabId = null;
  crawlJob.detailTabId = null;
  broadcastCrawlJobState();
}

function crawlJobPause() {
  if (!crawlJob.active) return;
  crawlJob.paused = true;
  broadcastCrawlJobState();
}

function crawlJobResume() {
  if (!crawlJob.active) return;
  crawlJob.paused = false;
  broadcastCrawlJobState();
}

function crawlJobStop() {
  if (!crawlJob.active) return;
  crawlJob.stopped = true;
  crawlJob.paused = false;
  if (crawlJob.detailTabId != null) {
    chrome.tabs.remove(crawlJob.detailTabId).catch(() => {});
    crawlJob.detailTabId = null;
  }
  broadcastCrawlJobState();
}

async function sleepUnlessStopped(ms) {
  const step = 250;
  let remaining = ms;
  while (remaining > 0) {
    assertCrawlJobNotStopped();
    const chunk = Math.min(step, remaining);
    await sleep(chunk);
    remaining -= chunk;
  }
}

function waitForTabComplete(tabId, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    let pollTimer;
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      if (pollTimer) clearInterval(pollTimer);
      reject(new Error("商品页加载超时"));
    }, timeoutMs);

    pollTimer = setInterval(() => {
      if (!crawlJob.stopped) return;
      clearTimeout(timer);
      clearInterval(pollTimer);
      chrome.tabs.onUpdated.removeListener(listener);
      reject(crawlJobUserStoppedError());
    }, 250);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timer);
      clearInterval(pollTimer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (crawlJob.stopped) {
        clearTimeout(timer);
        clearInterval(pollTimer);
        chrome.tabs.onUpdated.removeListener(listener);
        reject(crawlJobUserStoppedError());
        return;
      }
      if (tab.status === "complete") {
        clearTimeout(timer);
        clearInterval(pollTimer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

function productToLinkEntry(product) {
  const url = product?.url;
  if (!url) return null;
  const sku = String(product.product_id || product.sku || "").trim();
  return {
    url,
    sku: sku || undefined,
    title: product.title || null,
    search_keyword: product.search_keyword || null,
    collected_at:
      product.date || new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

async function syncLinkQueueFromDetails() {
  const records = await loadDetailRecords();
  const entries = records.map(productToLinkEntry).filter(Boolean);
  if (!entries.length) {
    const queue = await loadLinkQueue();
    return {
      ok: true,
      count: queue.length,
      synced: 0,
      urls: queue,
      filename: defaultLinksFilename(queue),
    };
  }
  const result = await appendProductUrls(entries);
  return { ...result, synced: entries.length };
}

async function appendProduct(product) {
  if (!product) throw new Error("Missing product payload");
  const records = dedupeRecords(await loadDetailRecords(), [product]);
  await saveDetailRecords(records);

  let linkCount = (await loadLinkQueue()).length;
  const linkEntry = productToLinkEntry(product);
  if (linkEntry) {
    try {
      const linkResult = await appendProductUrls([linkEntry]);
      linkCount = linkResult.count;
    } catch (e) {
      console.warn("appendProduct: link queue update skipped", e);
    }
  }

  return {
    ok: true,
    count: records.length,
    linkCount,
    records,
    filename: defaultDetailFilename(records),
  };
}

async function appendProductUrls(entries) {
  const list = Array.isArray(entries) ? entries.filter((e) => e?.url) : [];
  if (!list.length) throw new Error("Missing URL entries");
  const queue = dedupeUrlEntries(await loadLinkQueue(), list);
  await saveLinkQueue(queue);
  return {
    ok: true,
    count: queue.length,
    added: list.length,
    urls: queue,
    filename: defaultLinksFilename(queue),
  };
}

function riskBlockedError(url) {
  const err = new Error(
    "详情页被重定向到验证/登录或首页: " + String(url || "").slice(0, 120)
  );
  err.code = "JD_RISK_BLOCKED";
  return err;
}

async function extractProductInNewTab(url, options = {}) {
  assertCrawlJobNotStopped();
  const tab = await chrome.tabs.create({ url, active: options.activateTab === true });
  crawlJob.detailTabId = tab.id;
  try {
    if (crawlJob.stopped) throw crawlJobUserStoppedError();
    await waitForTabComplete(tab.id, options.tabTimeoutMs || 60000);
    await sleepUnlessStopped(options.afterLoadMs || 2500);

    const tabInfo = await chrome.tabs.get(tab.id);
    if (isJdBlockedUrl(tabInfo.url) || isJdRiskUrl(tabInfo.url)) {
      throw riskBlockedError(tabInfo.url);
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [
        "src/jd-page-url.js",
        "src/jd-scroll-pause.js",
        "src/human-scroll.js",
        "src/extractor.js",
        "src/download.js",
        "src/content.js",
      ],
    });

    assertCrawlJobNotStopped();

    const extractPromise = chrome.tabs.sendMessage(tab.id, {
      type: "EXTRACT_JD_PRODUCT_WITH_SCROLL",
      options: {
        scroll: true,
        save: false,
        download: false,
        ...(options.extract || {}),
      },
    });

    const stopPromise = new Promise((_, reject) => {
      const poll = setInterval(() => {
        if (!crawlJob.stopped) return;
        clearInterval(poll);
        reject(crawlJobUserStoppedError());
      }, 250);
      extractPromise.finally(() => clearInterval(poll));
    });

    const response = await Promise.race([extractPromise, stopPromise]);

    if (!response?.ok) {
      if (response?.code === "USER_STOPPED") {
        throw crawlJobUserStoppedError();
      }
      throw new Error(response?.error || "详情页提取失败");
    }

    const { _validation_errors, ...product } = response.data;
    const saved = await appendProduct(product);

    return {
      ok: true,
      product,
      validation_errors: _validation_errors || [],
      saved,
    };
  } finally {
    crawlJob.detailTabId = null;
    try {
      await chrome.tabs.remove(tab.id);
    } catch (_) {
      /* tab may already be closed */
    }
    if (options.returnToTabId) {
      try {
        await chrome.tabs.update(options.returnToTabId, { active: true });
      } catch (_) {
        /* search tab may be closed */
      }
    }
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!crawlJob.active || tabId !== crawlJob.tabId) return;
  if (changeInfo.status !== "complete" && changeInfo.url === undefined) return;
  const url = changeInfo.url || tab?.url || "";
  if (!isJdBlockedUrl(url)) return;

  crawlJobPause();
  chrome.tabs
    .sendMessage(tabId, {
      type: "CRAWL_BLOCKED_BY_RISK",
      url,
      reason: isJdHomeUrl(url) ? "home" : "risk",
    })
    .catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("JD Product Extractor installed");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "APPEND_JSONL_RECORD" || message?.type === "APPEND_AND_DOWNLOAD_JSONL") {
    appendProduct(message.product)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  if (message?.type === "APPEND_PRODUCT_URLS") {
    appendProductUrls(message.urls)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  if (message?.type === "GET_PRODUCT_URLS") {
    loadLinkQueue()
      .then((urls) =>
        sendResponse({
          ok: true,
          urls,
          count: urls.length,
          filename: defaultLinksFilename(urls),
        })
      )
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  if (message?.type === "CLEAR_PRODUCT_URLS") {
    saveLinkQueue([])
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  if (message?.type === "SYNC_LINKS_FROM_DETAILS") {
    syncLinkQueueFromDetails()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  if (message?.type === "EXTRACT_URL_IN_NEW_TAB") {
    extractProductInNewTab(message.url, message.options || {})
      .then((result) => sendResponse(result))
      .catch((error) => {
        const code = error.code || undefined;
        sendResponse({
          ok: false,
          error: String(error.message || error),
          code,
        });
      });
    return true;
  }

  if (message?.type === "GET_CRAWL_CHECKPOINT") {
    loadCheckpoint()
      .then((checkpoint) => sendResponse({ ok: true, checkpoint }))
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  if (message?.type === "MERGE_CRAWL_CHECKPOINT") {
    mergeCheckpoint(message.patch || {})
      .then(() => loadCheckpoint())
      .then((checkpoint) => sendResponse({ ok: true, checkpoint }))
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  if (message?.type === "CLEAR_CRAWL_CHECKPOINT") {
    clearCheckpoint()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  if (message?.type === "DOWNLOAD_JSONL" || message?.type === "GET_JSONL_RECORDS") {
    loadDetailRecords()
      .then((records) => {
        const payload = {
          ok: true,
          records,
          count: records.length,
          filename: defaultDetailFilename(records),
        };
        sendResponse(payload);
      })
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  if (message?.type === "CLEAR_JSONL_RECORDS") {
    saveDetailRecords([])
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  if (message?.type === "CRAWL_JOB_START") {
    crawlJobStart(message.kind || "unknown", message.tabId);
    sendResponse({ ok: true, state: getCrawlJobState() });
    return true;
  }

  if (message?.type === "CRAWL_JOB_END") {
    crawlJobEnd();
    if (message.clearCheckpoint !== false) {
      clearCheckpoint().catch(() => {});
    }
    sendResponse({ ok: true, state: getCrawlJobState() });
    return true;
  }

  if (message?.type === "CRAWL_JOB_PAUSE") {
    crawlJobPause();
    sendResponse({ ok: true, state: getCrawlJobState() });
    return true;
  }

  if (message?.type === "CRAWL_JOB_RESUME") {
    crawlJobResume();
    sendResponse({ ok: true, state: getCrawlJobState() });
    return true;
  }

  if (message?.type === "CRAWL_JOB_STOP") {
    crawlJobStop();
    sendResponse({ ok: true, state: getCrawlJobState() });
    return true;
  }

  if (message?.type === "GET_CRAWL_JOB_STATE") {
    sendResponse({ ok: true, state: getCrawlJobState() });
    return true;
  }

  return undefined;
});
