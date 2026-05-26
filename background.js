/** 商品详情 ProductSource 记录（仅详情页 / 批量详情提取写入） */
const DETAIL_STORAGE_KEY = "jd_jsonl_records";
/** 搜索页收集的商品链接队列（导出为 jd-links-*.jsonl） */
const LINK_STORAGE_KEY = "jd_product_url_queue";

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

function waitForTabComplete(tabId, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("商品页加载超时"));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
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

async function extractProductInNewTab(url, options = {}) {
  const tab = await chrome.tabs.create({ url, active: options.activateTab === true });
  try {
    await waitForTabComplete(tab.id, options.tabTimeoutMs || 60000);
    await sleep(options.afterLoadMs || 2500);

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [
        "src/jd-page-url.js",
        "src/human-scroll.js",
        "src/extractor.js",
        "src/download.js",
        "src/content.js",
      ],
    });

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "EXTRACT_JD_PRODUCT_WITH_SCROLL",
      options: {
        scroll: true,
        save: false,
        download: false,
        ...(options.extract || {}),
      },
    });

    if (!response?.ok) {
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

  if (message?.type === "EXTRACT_URL_IN_NEW_TAB") {
    extractProductInNewTab(message.url, message.options || {})
      .then((result) => sendResponse(result))
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

  return undefined;
});
