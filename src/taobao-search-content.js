(function () {
  const FLAG = "__taobaoSearchExtractorReady";
  const STYLE_ID = "taobao-search-extractor-style";

  if (window.JdPageUrl?.detectPlatform(location.href) !== "taobao") return;
  if (window.JdPageUrl?.detectPageMode(location.href) !== "list") return;

  if (!window.__tbScrollShouldContinue) {
    window.__tbScrollShouldContinue = async () => true;
  }

  function injectFloatingButton() {
    if (document.getElementById("taobao-search-extractor-panel")) return;
    window[FLAG] = true;

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        #taobao-search-extractor-panel {
          position: fixed;
          right: 18px;
          bottom: 24px;
          z-index: 2147483646;
          display: flex;
          flex-direction: column-reverse;
          gap: 8px;
          align-items: flex-end;
        }
        #taobao-search-extractor-panel button {
          border: none;
          border-radius: 999px;
          padding: 10px 14px;
          font-size: 12px;
          font-weight: 600;
          color: #fff;
          cursor: pointer;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
          white-space: nowrap;
        }
        #taobao-search-extractor-panel button:disabled {
          opacity: 0.65;
          cursor: wait;
        }
        #tb-search-cache-urls-btn { background: #2563eb; }
        #tb-search-extract-list-btn { background: #059669; }
        #tb-search-extract-multi-btn { background: #047857; }
        #taobao-search-extractor-toast {
          position: fixed;
          right: 18px;
          bottom: 140px;
          z-index: 2147483647;
          max-width: 380px;
          padding: 10px 12px;
          border-radius: 8px;
          font-size: 12px;
          line-height: 1.45;
          color: #fff;
          background: rgba(17, 24, 39, 0.92);
          display: none;
        }
      `;
      document.documentElement.appendChild(style);
    }

    const panel = document.createElement("div");
    panel.id = "taobao-search-extractor-panel";

    const defs = [
      {
        id: "tb-search-cache-urls-btn",
        text: "翻页缓存链接",
        onClick: () => runCacheUrls(),
      },
      {
        id: "tb-search-extract-list-btn",
        text: "提取本页列表",
        onClick: () => runExtractList({ multiPage: false }),
      },
      {
        id: "tb-search-extract-multi-btn",
        text: "翻页提取列表",
        onClick: () => runExtractList({ multiPage: true, downloadAtEnd: true }),
      },
    ];

    defs.forEach(({ id, text, onClick }) => {
      const btn = document.createElement("button");
      btn.id = id;
      btn.type = "button";
      btn.textContent = text;
      btn.addEventListener("click", onClick);
      panel.appendChild(btn);
    });

    document.documentElement.appendChild(panel);
  }

  function setAllButtonsDisabled(disabled) {
    ["tb-search-cache-urls-btn", "tb-search-extract-list-btn", "tb-search-extract-multi-btn"].forEach(
      (id) => {
        const el = document.getElementById(id);
        if (el) el.disabled = disabled;
      }
    );
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function assertNotBlocked() {
    if (!window.TaobaoRisk?.isBlockedContext) return;
    if (window.TaobaoRisk.isBlockedContext(location.href, document.title)) {
      throw new Error(window.TaobaoRisk.blockedReason(location.href, document.title));
    }
  }

  function showToast(text, isError = false) {
    let toast = document.getElementById("taobao-search-extractor-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "taobao-search-extractor-toast";
      document.documentElement.appendChild(toast);
    }
    toast.style.display = "block";
    toast.style.background = isError ? "rgba(185, 28, 28, 0.95)" : "rgba(17, 24, 39, 0.92)";
    toast.textContent = text;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      toast.style.display = "none";
    }, isError ? 10000 : 6000);
  }

  async function getMaxPages() {
    try {
      const stored = await chrome.storage.local.get("jd_search_max_pages");
      const n = parseInt(stored.jd_search_max_pages, 10);
      return Number.isFinite(n) && n >= 1 ? Math.min(n, 50) : 5;
    } catch (_) {
      return 5;
    }
  }

  async function waitForSearchCards(timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      assertNotBlocked();
      if (TaobaoSearchExtractor.findSearchCards().length) return true;
      await sleep(400);
    }
    return false;
  }

  async function runCacheUrls() {
    const maxPages = await getMaxPages();
    showToast(
      maxPages > 1
        ? `正在平滑滚屏并翻页缓存链接（最多 ${maxPages} 页）…`
        : "正在平滑滚屏并缓存本页链接…"
    );
    setAllButtonsDisabled(true);

    try {
      assertNotBlocked();
      const result =
        maxPages > 1
          ? await TaobaoSearchExtractor.collectSearchUrlsMultiPage({
              maxPages,
              shouldContinue: window.__tbScrollShouldContinue,
            })
          : await TaobaoSearchExtractor.collectUrlsFromSearchPage({
              shouldContinue: window.__tbScrollShouldContinue,
            });

      const saved = await chrome.runtime.sendMessage({
        type: "APPEND_PRODUCT_URLS",
        urls: result.urls,
      });

      if (!saved?.ok) throw new Error(saved?.error || "链接缓存失败");

      const pageInfo = maxPages > 1 ? `（${result.pages} 页）` : "";
      showToast(
        `已缓存 ${result.count} 个链接${pageInfo}，链接缓存共 ${saved.count} 条`
      );
    } catch (error) {
      showToast(String(error.message || error), true);
    } finally {
      setAllButtonsDisabled(false);
    }
  }

  async function runExtractList({ multiPage = false, downloadAtEnd = false } = {}) {
    const maxPages = multiPage ? await getMaxPages() : 1;
    showToast(
      multiPage
        ? `正在翻页提取列表（最多 ${maxPages} 页）…`
        : "正在提取本页商品列表…"
    );
    setAllButtonsDisabled(true);

    try {
      assertNotBlocked();
      const result =
        maxPages > 1
          ? await TaobaoSearchExtractor.extractTaobaoSearchProductsMultiPage({
              maxPages,
              shouldContinue: window.__tbScrollShouldContinue,
            })
          : await TaobaoSearchExtractor.extractTaobaoSearchProducts({
              shouldContinue: window.__tbScrollShouldContinue,
            });

      let savedCount = 0;
      for (const product of result.products) {
        const saved = await chrome.runtime.sendMessage({
          type: "APPEND_JSONL_RECORD",
          product,
        });
        if (saved?.ok) savedCount = saved.count;
      }

      if (downloadAtEnd && result.products.length) {
        const records = await chrome.runtime.sendMessage({ type: "GET_JSONL_RECORDS" });
        if (records?.ok && records.count) {
          const stamp = new Date().toISOString().slice(0, 10);
          const keyword = result.keyword || "search";
          const safeKeyword = String(keyword).replace(/[^\w\u4e00-\u9fa5-]+/g, "_").slice(0, 40);
          JdJsonlDownload.downloadRecords(
            records.records,
            records.filename || `tb-list-${stamp}-${safeKeyword}.jsonl`
          );
        }
      }

      showToast(
        `已提取 ${result.count} 条商品${multiPage ? `（${result.pages} 页）` : ""}，详情缓存共 ${savedCount} 条` +
          (downloadAtEnd ? "，已下载 JSONL" : "")
      );
    } catch (error) {
      showToast(String(error.message || error), true);
    } finally {
      setAllButtonsDisabled(false);
    }
  }

  if (!window.__taobaoSearchExtractorMessageListener) {
    window.__taobaoSearchExtractorMessageListener = true;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "CACHE_TAOBAO_SEARCH_URLS") {
        (async () => {
          try {
            if (!window.TaobaoSearchExtractor?.collectUrlsFromSearchPage) {
              throw new Error("搜索页脚本未加载，请刷新页面后重试");
            }
            const opts = message.options || {};
            const data =
              opts.maxPages && opts.maxPages > 1
                ? await window.TaobaoSearchExtractor.collectSearchUrlsMultiPage(opts)
                : await window.TaobaoSearchExtractor.collectUrlsFromSearchPage(opts);
            sendResponse({ ok: true, data });
          } catch (error) {
            sendResponse({ ok: false, error: String(error?.message || error) });
          }
        })();
        return true;
      }

      if (message?.type === "EXTRACT_TAOBAO_SEARCH_LIST") {
        (async () => {
          try {
            const opts = message.options || {};
            const data =
              opts.maxPages && opts.maxPages > 1
                ? await window.TaobaoSearchExtractor.extractTaobaoSearchProductsMultiPage(opts)
                : await window.TaobaoSearchExtractor.extractTaobaoSearchProducts(opts);
            sendResponse({ ok: true, data });
          } catch (error) {
            sendResponse({ ok: false, error: String(error?.message || error) });
          }
        })();
        return true;
      }

      return undefined;
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectFloatingButton);
  } else {
    injectFloatingButton();
  }
})();
