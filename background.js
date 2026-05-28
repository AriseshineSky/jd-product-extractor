/** 商品详情 ProductSource 记录（仅详情页 / 批量详情提取写入） */
const DETAIL_STORAGE_KEY = "jd_jsonl_records";
/** 搜索页收集的商品链接队列（导出为 jd-links-*.jsonl） */
const LINK_STORAGE_KEY = "jd_product_url_queue";
/** 验证/跳转首页后可恢复的抓取进度 */
const CHECKPOINT_STORAGE_KEY = "jd_crawl_checkpoint";
/** 续跑进度备份（主 checkpoint 被误清时可恢复） */
const CHECKPOINT_BACKUP_KEY = "jd_crawl_checkpoint_backup";
/** 最近任务事件（诊断「抓几条就停」） */
const CRAWL_LOG_STORAGE_KEY = "jd_crawl_log";
const CRAWL_LOG_MAX = 40;

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

function isJdListUrl(url) {
  try {
    const u = new URL(url);
    return /^(search|list)\.jd\.com$/i.test(u.hostname);
  } catch (_) {
    return /^https:\/\/(search|list)\.jd\.com\//i.test(url || "");
  }
}

function isJdBlockedUrl(url) {
  return isJdRiskUrl(url) || isJdHomeUrl(url);
}

async function loadCheckpoint() {
  const stored = await chrome.storage.local.get([
    CHECKPOINT_STORAGE_KEY,
    CHECKPOINT_BACKUP_KEY,
  ]);
  const cp = stored[CHECKPOINT_STORAGE_KEY];
  if (cp && typeof cp === "object" && cp.kind) return cp;
  const backup = stored[CHECKPOINT_BACKUP_KEY];
  if (backup && typeof backup === "object" && backup.kind) {
    await chrome.storage.local.set({ [CHECKPOINT_STORAGE_KEY]: backup });
    appendCrawlLog("checkpoint_restore", backup.kind);
    return backup;
  }
  return null;
}

async function saveCheckpoint(checkpoint) {
  const row = {
    ...checkpoint,
    updated_at: new Date().toISOString(),
  };
  const payload = { [CHECKPOINT_STORAGE_KEY]: row };
  if (row.kind) payload[CHECKPOINT_BACKUP_KEY] = row;
  await chrome.storage.local.set(payload);
}

async function mergeCheckpoint(patch) {
  const prev = (await loadCheckpoint()) || {};
  await saveCheckpoint({ ...prev, ...patch });
}

async function clearCheckpoint() {
  await chrome.storage.local.remove([CHECKPOINT_STORAGE_KEY, CHECKPOINT_BACKUP_KEY]);
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
  /** @type {null|'user'|'risk'} */
  pauseReason: null,
  stopped: false,
  kind: null,
  tabId: null,
  detailTabId: null,
};

async function appendCrawlLog(event, detail) {
  try {
    const stored = await chrome.storage.local.get(CRAWL_LOG_STORAGE_KEY);
    const prev = Array.isArray(stored[CRAWL_LOG_STORAGE_KEY])
      ? stored[CRAWL_LOG_STORAGE_KEY]
      : [];
    const row = {
      at: new Date().toISOString(),
      event: String(event || "log"),
      detail: detail != null ? String(detail).slice(0, 240) : "",
    };
    const next = [...prev, row].slice(-CRAWL_LOG_MAX);
    await chrome.storage.local.set({ [CRAWL_LOG_STORAGE_KEY]: next });
  } catch (_) {
    /* ignore */
  }
}

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
    pauseReason: crawlJob.pauseReason,
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
  crawlJob.pauseReason = null;
  crawlJob.stopped = false;
  crawlJob.kind = kind;
  crawlJob.tabId = tabId ?? null;
  crawlJob.detailTabId = null;
  appendCrawlLog("job_start", kind);
  broadcastCrawlJobState();
}

function crawlJobEnd() {
  const kind = crawlJob.kind;
  crawlJob.active = false;
  crawlJob.paused = false;
  crawlJob.pauseReason = null;
  crawlJob.stopped = false;
  crawlJob.kind = null;
  crawlJob.tabId = null;
  crawlJob.detailTabId = null;
  appendCrawlLog("job_end", kind || "");
  broadcastCrawlJobState();
}

function crawlJobPause(reason = "user") {
  if (!crawlJob.active) return;
  crawlJob.paused = true;
  crawlJob.pauseReason = reason === "risk" ? "risk" : "user";
  appendCrawlLog("job_pause", crawlJob.pauseReason);
  broadcastCrawlJobState();
}

function crawlJobResume() {
  if (!crawlJob.active) return;
  crawlJob.paused = false;
  crawlJob.pauseReason = null;
  appendCrawlLog("job_resume", crawlJob.kind || "");
  broadcastCrawlJobState();
}

function crawlJobStop() {
  if (!crawlJob.active) return;
  crawlJob.stopped = true;
  crawlJob.paused = false;
  crawlJob.pauseReason = null;
  if (crawlJob.detailTabId != null) {
    chrome.tabs.remove(crawlJob.detailTabId).catch(() => {});
    crawlJob.detailTabId = null;
  }
  broadcastCrawlJobState();
}

function assertCrawlJobNotRiskPaused() {
  if (crawlJob.paused && crawlJob.pauseReason === "risk") {
    throw riskBlockedError("search-tab-risk-pause");
  }
}

async function sleepUnlessStopped(ms) {
  const step = 250;
  let remaining = ms;
  while (remaining > 0) {
    assertCrawlJobNotStopped();
    assertCrawlJobNotRiskPaused();
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

const ITEM_PAGE_URL_RE =
  /^https:\/\/item\.(jd|jkcsjd|yiyaojd|jingxi)\.com\/(\d+)\.html/i;

function skuFromItemUrl(url) {
  const m = String(url || "").match(/(\d+)\.html/i);
  return m ? m[1] : null;
}

function isItemPageUrl(url) {
  return ITEM_PAGE_URL_RE.test(String(url || ""));
}

function isItemPageForSku(url, expectedUrl) {
  if (!isItemPageUrl(url)) return false;
  const expectedSku = skuFromItemUrl(expectedUrl);
  if (!expectedSku) return true;
  return skuFromItemUrl(url) === expectedSku;
}

/** 打开 item 链接后被踢到其他 *.jd.com 子域（常购页、活动页等） */
function itemRedirectError(currentUrl) {
  const u = String(currentUrl || "").slice(0, 140);
  return new Error(`商品页被重定向，无法提取: ${u}`);
}

async function ensureItemTabOnProductPage(tabId, expectedUrl, tabTimeoutMs = 60000) {
  for (let navTry = 0; navTry < 2; navTry++) {
    const tab = await chrome.tabs.get(tabId);
    const current = tab.url || "";
    if (isJdBlockedUrl(current) || isJdRiskUrl(current)) {
      throw riskBlockedError(current);
    }
    if (isItemPageForSku(current, expectedUrl)) {
      return tab;
    }
    if (navTry === 0) {
      appendCrawlLog("extract_redirect_retry", `${expectedUrl} -> ${current.slice(0, 100)}`);
      await chrome.tabs.update(tabId, { url: expectedUrl });
      await waitForItemTabReady(tabId, expectedUrl, tabTimeoutMs);
      await sleepUnlessStopped(1500);
      continue;
    }
    throw itemRedirectError(current);
  }
  throw itemRedirectError(expectedUrl);
}

async function injectItemExtractScripts(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "src/jd-page-url.js",
        "src/jd-scroll-pause.js",
        "src/human-scroll.js",
        "src/extractor.js",
        "src/download.js",
        "src/content.js",
      ],
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (/Cannot access contents of url/i.test(msg)) {
      let current = msg;
      try {
        const tab = await chrome.tabs.get(tabId);
        current = tab.url || msg;
      } catch (_) {
        /* ignore */
      }
      throw itemRedirectError(current);
    }
    throw err;
  }
}

async function pingItemPageDom(tabId) {
  try {
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!/item\.(jd|jkcsjd|yiyaojd|jingxi)\.com\/\d+\.html/i.test(location.href)) {
          return false;
        }
        const hasProduct = document.querySelector(
          ".sku-name, .sku-title-text, .sku-title, .page-right-skuname, [data-sku]"
        );
        const textLen = (document.body?.innerText || "").length;
        return Boolean(hasProduct || textLen > 800);
      },
    });
    return Boolean(injected?.result);
  } catch (_) {
    return false;
  }
}

/**
 * 等待京东商品页就绪。JD 详情页常长期处于 loading，不能仅依赖 status=complete。
 */
async function waitForItemTabReady(tabId, expectedUrl, timeoutMs = 90000) {
  const expectedSku = skuFromItemUrl(expectedUrl);
  const minDomWaitMs = 10000;
  const start = Date.now();

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(val);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error("商品页加载超时"));
    }, timeoutMs);

    const stopPoll = setInterval(() => {
      if (!crawlJob.stopped) return;
      finish(reject, crawlJobUserStoppedError());
    }, 250);

    function cleanup() {
      clearTimeout(timer);
      clearInterval(stopPoll);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    }

    function onUpdated(updatedTabId, changeInfo, tab) {
      if (settled || updatedTabId !== tabId) return;
      const url = changeInfo.url || tab?.url || "";
      if (url && (isJdBlockedUrl(url) || isJdRiskUrl(url))) {
        finish(reject, riskBlockedError(url));
        return;
      }
      if (changeInfo.status !== "complete") return;
      if (!ITEM_PAGE_URL_RE.test(url)) return;
      const skuInUrl = skuFromItemUrl(url);
      if (expectedSku && skuInUrl !== expectedSku) return;
      finish(resolve);
    }

    chrome.tabs.onUpdated.addListener(onUpdated);

    (async () => {
      while (!settled && Date.now() - start < timeoutMs) {
        try {
          assertCrawlJobNotStopped();
          assertCrawlJobNotRiskPaused();
        } catch (err) {
          finish(reject, err);
          return;
        }

        let tab;
        try {
          tab = await chrome.tabs.get(tabId);
        } catch (_) {
          finish(reject, new Error("商品页标签已关闭"));
          return;
        }

        const url = tab.url || "";
        if (isJdBlockedUrl(url) || isJdRiskUrl(url)) {
          finish(reject, riskBlockedError(url));
          return;
        }

        if (ITEM_PAGE_URL_RE.test(url)) {
          const skuInUrl = skuFromItemUrl(url);
          const skuOk = !expectedSku || skuInUrl === expectedSku;
          if (skuOk && tab.status === "complete") {
            finish(resolve);
            return;
          }
          if (skuOk && Date.now() - start >= minDomWaitMs) {
            const domReady = await pingItemPageDom(tabId);
            if (domReady) {
              finish(resolve);
              return;
            }
          }
        } else if (/\.jd\.com/i.test(url) && Date.now() - start >= 15000) {
          finish(reject, itemRedirectError(url));
          return;
        }

        await sleep(500);
      }
    })().catch((err) => finish(reject, err));
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

  return {
    ok: true,
    count: records.length,
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

function riskPauseReason(url) {
  const u = String(url || "").toLowerCase();
  if (u.includes("risk_handler") || u.includes("cfe.m.jd.com")) {
    return "京东滑块/人机验证（risk_handler），请在本页完成验证";
  }
  if (isJdHomeUrl(url)) return "已跳转到京东首页，请完成验证后返回搜索页";
  if (isJdRiskUrl(url)) return "京东登录/验证页，请人工完成验证";
  return "京东验证或页面异常";
}

function parseRiskHandlerReturnUrl(riskUrl) {
  try {
    const u = new URL(riskUrl);
    const ret = u.searchParams.get("returnurl");
    if (!ret) return null;
    return decodeURIComponent(ret);
  } catch (_) {
    return null;
  }
}

async function runExtractOnTab(tabId, url, options = {}) {
  await injectItemExtractScripts(tabId);
  assertCrawlJobNotStopped();

  const extractPromise = chrome.tabs.sendMessage(tabId, {
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
    if (response?.code === "USER_STOPPED") throw crawlJobUserStoppedError();
    throw new Error(response?.error || "详情页提取失败");
  }

  const { _validation_errors, ...product } = response.data;
  const saved = await appendProduct(product);
  appendCrawlLog("extract_ok", url);
  return {
    ok: true,
    product,
    validation_errors: _validation_errors || [],
    saved,
  };
}

async function extractProductFromExistingTab(tabId, url, options = {}) {
  crawlJob.detailTabId = tabId;
  try {
    assertCrawlJobNotStopped();
    await sleepUnlessStopped(options.afterLoadMs || 2500);
    const tabInfo = await chrome.tabs.get(tabId);
    if (isJdBlockedUrl(tabInfo.url) || isJdRiskUrl(tabInfo.url)) {
      await pauseJobForRisk("detail_tab", tabInfo.url);
      return buildVerifyWaitResponse(tabInfo.url, tabId);
    }
    return await runExtractOnTab(tabId, url, options);
  } finally {
    crawlJob.detailTabId = null;
    try {
      await chrome.tabs.remove(tabId);
    } catch (_) {
      /* ignore */
    }
    if (options.returnToTabId) {
      try {
        await chrome.tabs.update(options.returnToTabId, { active: true });
      } catch (_) {
        /* ignore */
      }
    }
  }
}

/** 验证通过后：优先在已通过验证的商品标签上提取，避免重开触发二次验证 */
async function extractAfterVerify(url, options = {}) {
  if (crawlJob.detailTabId != null) {
    try {
      const tab = await chrome.tabs.get(crawlJob.detailTabId);
      const tabUrl = tab.url || "";
      if (isJdBlockedUrl(tabUrl) || isJdRiskUrl(tabUrl)) {
        await pauseJobForRisk("detail_tab", tabUrl);
        return buildVerifyWaitResponse(tabUrl, crawlJob.detailTabId);
      }
      const targetUrl =
        (tabUrl.includes("risk_handler") ? parseRiskHandlerReturnUrl(tabUrl) : null) || url;
      if (isItemPageForSku(tabUrl, targetUrl) || isItemPageUrl(tabUrl)) {
        appendCrawlLog("extract_after_verify", targetUrl);
        if (crawlJob.pauseReason === "risk") crawlJobResume();
        return await extractProductFromExistingTab(crawlJob.detailTabId, targetUrl, options);
      }
    } catch (_) {
      /* fall through to new tab */
    }
  }
  if (crawlJob.pauseReason === "risk") crawlJobResume();
  return extractProductInNewTabOnce(url, options);
}

async function pauseJobForRisk(source, url) {
  crawlJobPause("risk");
  appendCrawlLog("job_pause_risk", `${source} ${String(url || "").slice(0, 80)}`);
  const cp = await loadCheckpoint();
  if (cp?.kind) {
    await mergeCheckpoint({
      ...cp,
      paused_reason: "risk",
      stop_reason: riskPauseReason(url),
      last_status: "等待人工完成验证（验证页保持打开）",
    });
  }
  if (crawlJob.tabId) {
    chrome.tabs
      .sendMessage(crawlJob.tabId, {
        type: "CRAWL_BLOCKED_BY_RISK",
        url,
        reason: isJdHomeUrl(url) ? "home" : "risk",
      })
      .catch(() => {});
  }
}

async function cleanupVerifyDetailTab() {
  if (crawlJob.detailTabId == null) return;
  try {
    await chrome.tabs.remove(crawlJob.detailTabId);
  } catch (_) {
    /* ignore */
  }
  crawlJob.detailTabId = null;
  if (crawlJob.tabId) {
    try {
      await chrome.tabs.update(crawlJob.tabId, { active: true });
    } catch (_) {
      /* ignore */
    }
  }
}

/** 验证是否已通过（详情验证页或搜索页从验证/首页回到正常地址） */
async function checkRiskCleared() {
  if (!crawlJob.active) {
    return { cleared: true, reason: "job_inactive" };
  }
  if (crawlJob.pauseReason !== "risk") {
    return { cleared: true, reason: "not_risk_pause" };
  }

  if (crawlJob.detailTabId != null) {
    try {
      const tab = await chrome.tabs.get(crawlJob.detailTabId);
      const url = tab.url || "";
      if (isJdBlockedUrl(url) || isJdRiskUrl(url)) {
        return { cleared: false, waitingOn: "detail_verify", url };
      }
      if (isItemPageUrl(url) || isItemPageForSku(url, url)) {
        return { cleared: true, reason: "detail_verify_passed", keepTab: true };
      }
      await cleanupVerifyDetailTab();
      return { cleared: true, reason: "detail_verify_passed" };
    } catch (_) {
      crawlJob.detailTabId = null;
    }
  }

  if (crawlJob.tabId != null) {
    try {
      const tab = await chrome.tabs.get(crawlJob.tabId);
      const url = tab.url || "";
      if (isJdBlockedUrl(url)) {
        return { cleared: false, waitingOn: "search_verify", url };
      }
      return { cleared: true, reason: "search_tab_ok" };
    } catch (_) {
      return { cleared: false, waitingOn: "search_tab_missing" };
    }
  }

  return { cleared: true, reason: "no_tabs" };
}

async function extractProductInNewTab(url, options = {}) {
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 2, 3));
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await extractProductInNewTabOnce(url, {
        ...options,
        tabTimeoutMs:
          options.tabTimeoutMs || (attempt === 1 ? 90000 : 120000),
      });
    } catch (error) {
      lastError = error;
      if (error?.code === "JD_RISK_BLOCKED") {
        return {
          ok: false,
          code: "JD_RISK_BLOCKED",
          waitVerify: true,
          error: String(error.message || error),
        };
      }
      if (crawlJob.stopped) throw error;
      const msg = String(error?.message || error);
      const retriable = /加载超时|标签已关闭|提取失败|Could not establish|被重定向|Cannot access contents/i.test(
        msg
      );
      if (attempt < maxAttempts && retriable) {
        appendCrawlLog("extract_retry", `${url} #${attempt}`);
        await sleepUnlessStopped(2000);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

function buildVerifyWaitResponse(url, tabId) {
  return {
    ok: false,
    code: "JD_RISK_BLOCKED",
    waitVerify: true,
    verifyTabId: tabId,
    error: riskPauseReason(url),
  };
}

async function extractProductInNewTabOnce(url, options = {}) {
  assertCrawlJobNotStopped();
  assertCrawlJobNotRiskPaused();
  appendCrawlLog("extract_start", url);
  const tab = await chrome.tabs.create({ url, active: options.activateTab === true });
  crawlJob.detailTabId = tab.id;
  let keepVerifyTabOpen = false;
  try {
    if (crawlJob.stopped) throw crawlJobUserStoppedError();
    await waitForItemTabReady(tab.id, url, options.tabTimeoutMs || 90000);
    await sleepUnlessStopped(options.afterLoadMs || 2500);

    await ensureItemTabOnProductPage(tab.id, url, options.tabTimeoutMs || 60000);

    const tabInfo = await chrome.tabs.get(tab.id);
    if (isJdBlockedUrl(tabInfo.url) || isJdRiskUrl(tabInfo.url)) {
      appendCrawlLog("extract_risk", tabInfo.url);
      keepVerifyTabOpen = true;
      await pauseJobForRisk("detail_tab", tabInfo.url);
      return buildVerifyWaitResponse(tabInfo.url, tab.id);
    }

    await injectItemExtractScripts(tab.id);

    assertCrawlJobNotStopped();

    const result = await runExtractOnTab(tab.id, url, options);
    return result;
  } catch (error) {
    if (error?.code === "JD_RISK_BLOCKED") {
      keepVerifyTabOpen = true;
      const tabInfo = await chrome.tabs.get(tab.id).catch(() => null);
      await pauseJobForRisk("detail_tab", tabInfo?.url || url);
      appendCrawlLog("extract_verify_wait", url);
      return buildVerifyWaitResponse(tabInfo?.url || url, tab.id);
    }
    appendCrawlLog("extract_fail", `${url} ${error?.message || error}`);
    throw error;
  } finally {
    if (keepVerifyTabOpen) {
      crawlJob.detailTabId = tab.id;
      return;
    }
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
  if (!crawlJob.active) return;

  if (crawlJob.detailTabId === tabId && changeInfo.url) {
    if (isJdRiskUrl(changeInfo.url)) {
      pauseJobForRisk("detail_tab", changeInfo.url).catch(() => {});
    } else if (
      crawlJob.pauseReason === "risk" &&
      (isItemPageUrl(changeInfo.url) ||
        isItemPageForSku(changeInfo.url, parseRiskHandlerReturnUrl(changeInfo.url) || ""))
    ) {
      crawlJobResume();
      appendCrawlLog("verify_cleared", "detail_tab_item");
      if (crawlJob.tabId) {
        chrome.tabs
          .sendMessage(crawlJob.tabId, {
            type: "CRAWL_VERIFY_CLEARED",
            source: "detail_tab",
          })
          .catch(() => {});
      }
    }
    return;
  }

  if (tabId !== crawlJob.tabId) return;

  if (changeInfo.url && isJdBlockedUrl(changeInfo.url)) {
    pauseJobForRisk("search_tab", changeInfo.url).catch(() => {});
    return;
  }

  if (
    changeInfo.url &&
    crawlJob.pauseReason === "risk" &&
    isJdListUrl(changeInfo.url)
  ) {
    crawlJobResume();
    appendCrawlLog("verify_cleared", "search_tab_url");
    chrome.tabs
      .sendMessage(tabId, { type: "CRAWL_VERIFY_CLEARED", source: "search_tab" })
      .catch(() => {});
  }
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

  if (message?.type === "EXTRACT_AFTER_VERIFY") {
    extractAfterVerify(message.url, message.options || {})
      .then((result) => sendResponse(result))
      .catch((error) => {
        const code = error.code || undefined;
        if (code === "JD_RISK_BLOCKED") {
          sendResponse({
            ok: false,
            code,
            waitVerify: true,
            error: String(error.message || error),
          });
          return;
        }
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
    if (message.clearCheckpoint === true) {
      clearCheckpoint().catch(() => {});
    }
    sendResponse({ ok: true, state: getCrawlJobState() });
    return true;
  }

  if (message?.type === "CRAWL_JOB_PAUSE") {
    crawlJobPause(message.reason || "user");
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

  if (message?.type === "CRAWL_JOB_PING") {
    sendResponse({ ok: true, state: getCrawlJobState() });
    return true;
  }

  if (message?.type === "APPEND_CRAWL_LOG") {
    appendCrawlLog(message.event, message.detail)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  if (message?.type === "GET_CRAWL_DIAGNOSTICS") {
    Promise.all([loadCheckpoint(), loadLinkQueue(), loadDetailRecords()])
      .then(([checkpoint, links, details]) =>
        chrome.storage.local.get(CRAWL_LOG_STORAGE_KEY).then((stored) =>
          sendResponse({
            ok: true,
            state: getCrawlJobState(),
            checkpoint,
            linkCount: links.length,
            detailCount: details.length,
            log: Array.isArray(stored[CRAWL_LOG_STORAGE_KEY])
              ? stored[CRAWL_LOG_STORAGE_KEY]
              : [],
          })
        )
      )
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  if (message?.type === "CHECK_RISK_CLEARED") {
    checkRiskCleared()
      .then((result) => {
        if (result.cleared && crawlJob.active && crawlJob.pauseReason === "risk") {
          crawlJobResume();
          appendCrawlLog("verify_cleared", result.reason || "poll");
        }
        sendResponse({ ok: true, ...result });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  return undefined;
});
