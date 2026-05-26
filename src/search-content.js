(function () {
  const FLAG = "__jdSearchExtractorReady";
  const STYLE_ID = "jd-search-extractor-style";

  const BTN_IDS = [
    "jd-search-cache-urls-btn",
    "jd-search-batch-detail-btn",
    "jd-search-deep-crawl-btn",
    "jd-search-deep-crawl-multi-btn",
  ];

  if (window.JdPageUrl?.detectPageMode(location.href) !== "list") return;

  function injectFloatingButton() {
    if (document.getElementById("jd-search-extractor-panel")) return;
    window[FLAG] = true;

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        #jd-search-extractor-panel {
          position: fixed;
          right: 18px;
          bottom: 24px;
          z-index: 2147483646;
          display: flex;
          flex-direction: column-reverse;
          gap: 8px;
          align-items: flex-end;
        }
        #jd-search-extractor-panel button {
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
        #jd-search-extractor-panel button:disabled {
          opacity: 0.65;
          cursor: wait;
        }
        #jd-search-cache-urls-btn { background: #2563eb; }
        #jd-search-batch-detail-btn { background: #7c3aed; }
        #jd-search-deep-crawl-btn { background: #059669; }
        #jd-search-deep-crawl-multi-btn { background: #047857; }
        #jd-search-extractor-toast {
          position: fixed;
          right: 18px;
          bottom: 280px;
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
    panel.id = "jd-search-extractor-panel";

    const defs = [
      {
        id: "jd-search-cache-urls-btn",
        text: "翻页缓存链接",
        onClick: () => runCacheUrls(),
      },
      {
        id: "jd-search-batch-detail-btn",
        text: "批量详情提取",
        onClick: () => runBatchDetailExtract(),
      },
      {
        id: "jd-search-deep-crawl-btn",
        text: "本页逐一点开详情提取",
        onClick: () => runDeepCrawlSearch({ multiPage: false }),
      },
      {
        id: "jd-search-deep-crawl-multi-btn",
        text: "翻页逐一点开详情提取",
        onClick: () => runDeepCrawlSearch({ multiPage: true, downloadAtEnd: true }),
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
    BTN_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = disabled;
    });
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

  async function getDetailTabDelay() {
    try {
      const stored = await chrome.storage.local.get("jd_detail_tab_delay_ms");
      const n = parseInt(stored.jd_detail_tab_delay_ms, 10);
      return Number.isFinite(n) && n >= 500 ? Math.min(n, 15000) : 2500;
    } catch (_) {
      return 2500;
    }
  }

  function showToast(text, isError = false) {
    let toast = document.getElementById("jd-search-extractor-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "jd-search-extractor-toast";
      document.documentElement.appendChild(toast);
    }
    toast.style.display = "block";
    toast.style.background = isError ? "rgba(185, 28, 28, 0.95)" : "rgba(17, 24, 39, 0.92)";
    toast.textContent = text;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      toast.style.display = "none";
    }, 8000);
  }

  async function runCacheUrls() {
    setAllButtonsDisabled(true);
    const maxPages = await getMaxPages();
    showToast(
      maxPages > 1
        ? `正在平滑滚屏并翻页缓存链接（最多 ${maxPages} 页）…`
        : "正在平滑滚屏并缓存本页链接…"
    );

    try {
      const result =
        maxPages > 1
          ? await JdSearchExtractor.collectSearchUrlsMultiPage({ maxPages })
          : await JdSearchExtractor.collectUrlsFromSearchPage();

      const saved = await chrome.runtime.sendMessage({
        type: "APPEND_PRODUCT_URLS",
        urls: result.urls,
      });

      if (!saved?.ok) throw new Error(saved?.error || "链接缓存失败");

      const pageInfo = maxPages > 1 ? `（${result.pages} 页）` : "";
      showToast(
        `已缓存 ${result.count} 个链接${pageInfo}，链接缓存共 ${saved.count} 条。可点「批量详情提取」`
      );
    } catch (error) {
      showToast(String(error.message || error), true);
    } finally {
      setAllButtonsDisabled(false);
    }
  }

  async function getThisTabId() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs[0]?.id ?? null;
    } catch (_) {
      return null;
    }
  }

  /**
   * 当前搜索页：逐卡打开详情滚屏提取 → 可选翻页（仅写入详情缓存，不写列表摘要）。
   */
  async function runDeepCrawlSearch({ multiPage = false, downloadAtEnd = false } = {}) {
    setAllButtonsDisabled(true);
    const maxPages = multiPage ? await getMaxPages() : 1;
    const delayMs = await getDetailTabDelay();
    const searchTabId = await getThisTabId();

    showToast(
      multiPage
        ? `深度抓取：最多 ${maxPages} 页，逐一点开详情提取…`
        : "本页逐一点开详情提取…"
    );

    const stats = { detailOk: 0, detailFail: 0, pages: 0 };

    try {
      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        await JdSearchExtractor.humanScrollPage();
        stats.pages = pageNum;

        const cards = JdSearchExtractor.findSearchCards();
        if (!cards.length) throw new Error("当前页未找到商品卡片");

        for (let i = 0; i < cards.length; i++) {
          const card = cards[i];
          const sku = card.getAttribute("data-sku");
          if (!sku) continue;

          const url = JdSearchExtractor.itemUrlFromSku(sku);
          const link = JdSearchExtractor.findProductLinkInCard(card);
          const label =
            link?.getAttribute("title") ||
            link?.textContent?.trim()?.slice(0, 40) ||
            sku;

          showToast(`第${pageNum}页 ${i + 1}/${cards.length}：提取详情「${label}」…`);

          if (link && window.JdHumanMouse?.humanClickOpenInNewTab) {
            try {
              await window.JdHumanMouse.humanClickOpenInNewTab(link);
            } catch (err) {
              console.warn("humanClickOpenInNewTab:", err);
            }
            await new Promise((r) => setTimeout(r, randDelay(280, 520)));
          }

          const result = await chrome.runtime.sendMessage({
            type: "EXTRACT_URL_IN_NEW_TAB",
            url,
            options: {
              afterLoadMs: 2800,
              activateTab: true,
              returnToTabId: searchTabId,
              extract: { scroll: true },
            },
          });

          if (result?.ok) stats.detailOk += 1;
          else {
            stats.detailFail += 1;
            console.warn("Detail extract failed:", url, result?.error);
          }

          if (searchTabId) {
            try {
              await chrome.tabs.update(searchTabId, { active: true });
            } catch (_) {
              /* ignore */
            }
          }

          if (i < cards.length - 1) {
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }

        if (pageNum >= maxPages) break;
        if (!JdSearchExtractor.isNextPageAvailable()) break;

        showToast(`第 ${pageNum} 页完成，正在点击「下一页」…`);
        const skusBefore = new Set(
          JdSearchExtractor.findSearchCards()
            .map((c) => c.getAttribute("data-sku"))
            .filter(Boolean)
        );
        await JdSearchExtractor.clickNextPage();
        const updated = await JdSearchExtractor.waitForNewSearchResults(skusBefore, 15000);
        if (!updated) break;
        await new Promise((r) => setTimeout(r, 2000));
      }

      if (downloadAtEnd) {
        const records = await chrome.runtime.sendMessage({ type: "GET_JSONL_RECORDS" });
        if (records?.ok && records.count) {
          JdJsonlDownload.downloadRecords(
            records.records,
            records.filename || `jd-details-${new Date().toISOString().slice(0, 10)}.jsonl`
          );
        }
      }

      const cache = await chrome.runtime.sendMessage({ type: "GET_JSONL_RECORDS" });
      showToast(
        `深度抓取完成：${stats.pages} 页，详情成功 ${stats.detailOk}、失败 ${stats.detailFail}，详情缓存 ${cache?.count ?? "?"} 条` +
          (downloadAtEnd ? "，已下载详情 JSONL" : "")
      );
    } catch (error) {
      showToast(String(error.message || error), true);
    } finally {
      setAllButtonsDisabled(false);
    }
  }

  function randDelay(min, max) {
    return min + Math.random() * (max - min);
  }

  async function runBatchDetailExtract() {
    setAllButtonsDisabled(true);

    try {
      const queue = await chrome.runtime.sendMessage({ type: "GET_PRODUCT_URLS" });
      if (!queue?.ok) throw new Error(queue?.error || "读取链接缓存失败");
      if (!queue.count) {
        throw new Error("链接缓存为空，请先点「翻页缓存链接」");
      }

      const delayMs = await getDetailTabDelay();
      let ok = 0;
      let fail = 0;

      for (let i = 0; i < queue.urls.length; i++) {
        const entry = queue.urls[i];
        const label = entry.title || entry.sku || entry.url;
        showToast(
          `详情 ${i + 1}/${queue.count}：提取 ${String(label).slice(0, 28)}…`
        );

        const result = await chrome.runtime.sendMessage({
          type: "EXTRACT_URL_IN_NEW_TAB",
          url: entry.url,
          options: {
            afterLoadMs: 2500,
            activateTab: true,
            extract: { scroll: true },
          },
        });

        if (result?.ok) {
          ok += 1;
        } else {
          fail += 1;
          console.warn("Detail extract failed:", entry.url, result?.error);
        }

        if (i < queue.urls.length - 1) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }

      const records = await chrome.runtime.sendMessage({ type: "GET_JSONL_RECORDS" });
      const detailCount = records?.count ?? ok;

      if (ok > 0 && records?.ok) {
        JdJsonlDownload.downloadRecords(
          records.records,
          records.filename || `jd-details-${new Date().toISOString().slice(0, 10)}.jsonl`
        );
      }

      showToast(
        `批量详情提取完成：成功 ${ok}，失败 ${fail}，详情缓存 ${detailCount} 条` +
          (ok > 0 ? "，已下载详情 JSONL" : "")
      );
    } catch (error) {
      showToast(String(error.message || error), true);
    } finally {
      setAllButtonsDisabled(false);
    }
  }

  if (!window.__jdSearchExtractorMessageListener) {
    window.__jdSearchExtractorMessageListener = true;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "CACHE_JD_SEARCH_URLS") {
        (async () => {
          try {
            if (!window.JdSearchExtractor?.collectUrlsFromSearchPage) {
              throw new Error("搜索页脚本未加载，请刷新页面后重试");
            }
            const opts = message.options || {};
            const data =
              opts.maxPages && opts.maxPages > 1
                ? await window.JdSearchExtractor.collectSearchUrlsMultiPage(opts)
                : await window.JdSearchExtractor.collectUrlsFromSearchPage(opts);
            sendResponse({ ok: true, data });
          } catch (error) {
            sendResponse({ ok: false, error: String(error?.message || error) });
          }
        })();
        return true;
      }

      if (message?.type === "RUN_BATCH_DETAIL_FROM_QUEUE") {
        (async () => {
          try {
            await runBatchDetailExtract();
            sendResponse({ ok: true });
          } catch (error) {
            sendResponse({ ok: false, error: String(error?.message || error) });
          }
        })();
        return true;
      }

      if (message?.type === "DEEP_CRAWL_JD_SEARCH") {
        (async () => {
          try {
            await runDeepCrawlSearch(message.options || {});
            sendResponse({ ok: true });
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
