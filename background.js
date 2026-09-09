const DETAIL_STORAGE_KEY = "cn_jsonl_records";
const LEGACY_DETAIL_STORAGE_KEY = "jd_jsonl_records";
const MAX_RECORDS = 10000;
const LEGACY_CRAWL_KEYS = [
  "jd_crawl_checkpoint",
  "jd_crawl_checkpoint_backup",
  "jd_crawl_log",
  "jd_product_url_queue",
];

async function migrateLegacyStorage() {
  try {
    const stored = await chrome.storage.local.get([
      LEGACY_DETAIL_STORAGE_KEY,
      ...LEGACY_CRAWL_KEYS,
    ]);
    const toSet = {};
    const toRemove = [];
    const legacyDetail = stored[LEGACY_DETAIL_STORAGE_KEY];
    if (Array.isArray(legacyDetail) && legacyDetail.length) {
      const current = await chrome.storage.local.get(DETAIL_STORAGE_KEY);
      const existing = Array.isArray(current[DETAIL_STORAGE_KEY])
        ? current[DETAIL_STORAGE_KEY]
        : [];
      toSet[DETAIL_STORAGE_KEY] = existing.length ? existing : legacyDetail;
    }
    LEGACY_CRAWL_KEYS.forEach((key) => {
      if (key in stored) toRemove.push(key);
    });
    if (LEGACY_DETAIL_STORAGE_KEY in stored) {
      toRemove.push(LEGACY_DETAIL_STORAGE_KEY);
    }
    if (Object.keys(toSet).length) await chrome.storage.local.set(toSet);
    if (toRemove.length) await chrome.storage.local.remove(toRemove);
  } catch (_) {
    /* ignore */
  }
}

migrateLegacyStorage();

async function loadDetailRecords() {
  const stored = await chrome.storage.local.get(DETAIL_STORAGE_KEY);
  return Array.isArray(stored[DETAIL_STORAGE_KEY]) ? stored[DETAIL_STORAGE_KEY] : [];
}

async function saveDetailRecords(records) {
  await chrome.storage.local.set({ [DETAIL_STORAGE_KEY]: records });
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

function trimRecords(records) {
  return records.length > MAX_RECORDS ? records.slice(-MAX_RECORDS) : records;
}

function defaultDetailFilename(records) {
  const stamp = new Date().toISOString().slice(0, 10);
  const sku = records.at(-1)?.product_id || records.at(-1)?.sku || "product";
  return `cn-details-${stamp}-${sku}.jsonl`;
}

async function appendProducts(products) {
  const records = trimRecords(dedupeRecords(await loadDetailRecords(), products || []));
  await saveDetailRecords(records);

  return {
    ok: true,
    count: records.length,
    records,
    filename: defaultDetailFilename(records),
    maxRecords: MAX_RECORDS,
  };
}

async function fetchRecords() {
  const records = await loadDetailRecords();
  return {
    ok: true,
    records,
    count: records.length,
    filename: defaultDetailFilename(records),
    maxRecords: MAX_RECORDS,
  };
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("CN Product Extractor installed");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "APPEND_JSONL_RECORD" || message?.type === "APPEND_AND_DOWNLOAD_JSONL") {
    appendProducts([message.product])
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  if (message?.type === "APPEND_JSONL_RECORDS") {
    appendProducts(message.products)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  if (message?.type === "DOWNLOAD_JSONL" || message?.type === "GET_JSONL_RECORDS") {
    fetchRecords()
      .then((payload) => sendResponse(payload))
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