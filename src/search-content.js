(function () {
  const FLAG = "__jdSearchExtractorReady";
  const STYLE_ID = "jd-search-extractor-style";

  const BTN_IDS = [
    "jd-search-cache-urls-btn",
    "jd-search-batch-detail-btn",
    "jd-search-deep-crawl-btn",
    "jd-search-deep-crawl-multi-btn",
  ];
  const JOB_BTN_IDS = [
    "jd-search-pause-job-btn",
    "jd-search-stop-job-btn",
    "jd-search-resume-job-btn",
  ];
  const USER_STOPPED = "USER_STOPPED";
  const JD_RISK_BLOCKED = "JD_RISK_BLOCKED";
  const AUTO_RESUME_FLAG = "jd_auto_resume_after_nav";

  if (window.JdPageUrl?.detectPageMode(location.href) !== "list") return;

  if (!window.__jdScrollShouldContinue) {
    window.__jdScrollShouldContinue = async () => {
      const state = await getCrawlJobState();
      if (state.stopped || !state.active) throw userStoppedError();
      if (state.paused) return false;
      return true;
    };
  }

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
        #jd-search-pause-job-btn { background: #f59e0b; }
        #jd-search-stop-job-btn { background: #dc2626; }
        #jd-search-resume-job-btn { background: #0d9488; }
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

    const resumeBtn = document.createElement("button");
    resumeBtn.id = "jd-search-resume-job-btn";
    resumeBtn.type = "button";
    resumeBtn.textContent = "继续未完成任务";
    resumeBtn.addEventListener("click", () => runResumeJob());
    panel.appendChild(resumeBtn);

    const pauseBtn = document.createElement("button");
    pauseBtn.id = "jd-search-pause-job-btn";
    pauseBtn.type = "button";
    pauseBtn.textContent = "暂停";
    pauseBtn.disabled = true;
    pauseBtn.addEventListener("click", () => togglePauseJob());
    panel.appendChild(pauseBtn);

    const stopBtn = document.createElement("button");
    stopBtn.id = "jd-search-stop-job-btn";
    stopBtn.type = "button";
    stopBtn.textContent = "结束";
    stopBtn.disabled = true;
    stopBtn.addEventListener("click", () => stopCrawlJob());
    panel.appendChild(stopBtn);

    document.documentElement.appendChild(panel);
    syncJobControlsFromBackground();
    refreshResumeButton();
    tryAutoResumeAfterNav();
  }

  function setAllButtonsDisabled(disabled) {
    BTN_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = disabled;
    });
  }

  function setJobControlsEnabled(enabled) {
    JOB_BTN_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = !enabled;
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function getCrawlJobState() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "GET_CRAWL_JOB_STATE" });
      return res?.state || { active: false, paused: false, stopped: false };
    } catch (_) {
      return { active: false, paused: false, stopped: false };
    }
  }

  const UNLOAD_GUARD_MESSAGE =
    "京东抓取任务仍在进行，关闭此标签页将中断任务。确定要离开吗？";

  function onBeforeUnload(event) {
    if (!window.__jdCrawlUnloadGuardEnabled) return;
    event.preventDefault();
    event.returnValue = UNLOAD_GUARD_MESSAGE;
    return UNLOAD_GUARD_MESSAGE;
  }

  function setUnloadGuard(enabled) {
    window.__jdCrawlUnloadGuardEnabled = Boolean(enabled);
    if (enabled) {
      if (!window.__jdCrawlUnloadGuardBound) {
        window.__jdCrawlUnloadGuardBound = true;
        window.addEventListener("beforeunload", onBeforeUnload);
      }
      return;
    }
    if (window.__jdCrawlUnloadGuardBound) {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.__jdCrawlUnloadGuardBound = false;
    }
  }

  async function syncUnloadGuard() {
    const state = await getCrawlJobState();
    setUnloadGuard(state.active);
  }

  async function syncJobControlsFromBackground() {
    const state = await getCrawlJobState();
    setAllButtonsDisabled(state.active);
    setJobControlsEnabled(state.active);
    const pauseBtn = document.getElementById("jd-search-pause-job-btn");
    if (pauseBtn) pauseBtn.textContent = state.paused ? "继续" : "暂停";
    await syncUnloadGuard();
  }

  async function togglePauseJob() {
    const state = await getCrawlJobState();
    if (!state.active) return;
    if (state.paused) {
      await chrome.runtime.sendMessage({ type: "CRAWL_JOB_RESUME" });
      showToast("已继续：滚屏与抓取将恢复");
    } else {
      await chrome.runtime.sendMessage({ type: "CRAWL_JOB_PAUSE" });
      showToast("已暂停：滚屏与抓取均已暂停，点「继续」恢复");
    }
    await syncJobControlsFromBackground();
  }

  async function waitForCrawlJobInactive(timeoutMs = 90000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await getCrawlJobState();
      if (!state.active) return true;
      if (state.stopped) {
        await sleep(200);
        continue;
      }
      await sleep(300);
    }
    return false;
  }

  async function stopCrawlJob() {
    const state = await getCrawlJobState();
    if (!state.active) {
      showToast("当前没有运行中的任务");
      return;
    }
    await chrome.runtime.sendMessage({ type: "CRAWL_JOB_STOP" });
    showToast("正在结束任务…");
    const ended = await waitForCrawlJobInactive();
    if (ended) {
      showToast("任务已结束");
    } else {
      showToast("结束超时：请刷新搜索页后重试", true);
    }
    await syncJobControlsFromBackground();
    await refreshResumeButton();
  }

  function userStoppedError() {
    const err = new Error("任务已结束");
    err.code = USER_STOPPED;
    return err;
  }

  async function crawlJobCheckpoint() {
    let state = await getCrawlJobState();
    if (state.stopped || !state.active) throw userStoppedError();

    while (state.paused && !state.stopped) {
      const pauseBtn = document.getElementById("jd-search-pause-job-btn");
      if (pauseBtn) pauseBtn.textContent = "继续";
      await sleep(400);
      state = await getCrawlJobState();
      if (state.stopped || !state.active) throw userStoppedError();
    }

    state = await getCrawlJobState();
    if (state.stopped || !state.active) throw userStoppedError();

    const pauseBtn = document.getElementById("jd-search-pause-job-btn");
    if (pauseBtn) pauseBtn.textContent = "暂停";
  }

  async function interruptedDelay(ms) {
    const step = 400;
    let remaining = ms;
    while (remaining > 0) {
      await crawlJobCheckpoint();
      const chunk = Math.min(step, remaining);
      await sleep(chunk);
      remaining -= chunk;
    }
  }

  async function withCrawlJob(kind, runner) {
    const tabId = await getThisTabId();
    await chrome.runtime.sendMessage({ type: "CRAWL_JOB_START", kind, tabId });
    setAllButtonsDisabled(true);
    setJobControlsEnabled(true);
    setUnloadGuard(true);
    let clearCheckpoint = true;
    try {
      return await runner();
    } catch (error) {
      if (isRiskBlocked(error)) clearCheckpoint = false;
      throw error;
    } finally {
      await chrome.runtime.sendMessage({
        type: "CRAWL_JOB_END",
        clearCheckpoint,
      });
      setAllButtonsDisabled(false);
      setJobControlsEnabled(false);
      const pauseBtn = document.getElementById("jd-search-pause-job-btn");
      if (pauseBtn) pauseBtn.textContent = "暂停";
      await syncUnloadGuard();
      await refreshResumeButton();
    }
  }

  function isUserStopped(error) {
    return error?.code === USER_STOPPED || error?.message === "任务已结束";
  }

  function isRiskBlocked(error) {
    return (
      error?.code === JD_RISK_BLOCKED ||
      /验证|登录|首页|JD_RISK/.test(String(error?.message || error?.error || ""))
    );
  }

  async function loadCheckpoint() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "GET_CRAWL_CHECKPOINT" });
      return res?.checkpoint || null;
    } catch (_) {
      return null;
    }
  }

  async function mergeCheckpoint(patch) {
    await chrome.runtime.sendMessage({ type: "MERGE_CRAWL_CHECKPOINT", patch });
  }

  async function refreshResumeButton() {
    const btn = document.getElementById("jd-search-resume-job-btn");
    if (!btn) return;
    const cp = await loadCheckpoint();
    const hasJob = Boolean(cp?.kind);
    btn.style.display = hasJob ? "inline-block" : "none";
    if (hasJob) {
      const page = cp.pageNum ? `第${cp.pageNum}页` : "";
      const idx = Number.isFinite(cp.cardIndex) ? `第${cp.cardIndex + 1}个` : "";
      const q = Number.isFinite(cp.queueIndex) ? `队列第${cp.queueIndex + 1}条` : "";
      btn.textContent = `继续未完成任务（${cp.kind}${page}${idx}${q}）`;
    } else {
      btn.textContent = "继续未完成任务";
    }
  }

  function assertNotRiskBlocked() {
    if (!window.JdRisk?.isBlockedContext) return;
    if (window.JdRisk.isBlockedContext(location.href, document.title)) {
      const err = new Error(window.JdRisk.blockedReason(location.href, document.title));
      err.code = JD_RISK_BLOCKED;
      throw err;
    }
  }

  async function handleRiskBlocked(state) {
    await mergeCheckpoint({
      ...state,
      searchUrl: state.searchUrl || location.href,
      paused_reason: "risk",
    });
    await chrome.runtime.sendMessage({ type: "CRAWL_JOB_PAUSE" });
    await refreshResumeButton();
    showToast(
      "遇到京东验证或跳转首页，进度已保存。请完成验证后回到搜索页，点「继续未完成任务」"
    );
    const err = new Error("京东验证中断");
    err.code = JD_RISK_BLOCKED;
    throw err;
  }

  async function waitForSearchCards(timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      assertNotRiskBlocked();
      if (JdSearchExtractor.findSearchCards().length) return true;
      await sleep(400);
    }
    return false;
  }

  /**
   * 若不在搜索列表页则跳回 searchUrl；跳转时返回 false（当前页将卸载）。
   */
  async function ensureSearchPageReady(searchUrl) {
    assertNotRiskBlocked();
    if (window.JdPageUrl?.isJdListUrl(location.href) && !window.JdRisk?.isBlockedContext(location.href, document.title)) {
      return waitForSearchCards();
    }
    if (!searchUrl) {
      throw new Error("缺少搜索页地址，请手动打开搜索结果页后再点「继续未完成任务」");
    }
    sessionStorage.setItem(AUTO_RESUME_FLAG, "1");
    showToast("正在返回搜索页，加载完成后将自动继续…");
    location.href = searchUrl;
    return false;
  }

  async function advanceToSearchPage(targetPage) {
    if (!targetPage || targetPage <= 1) return;
    for (let p = 1; p < targetPage; p++) {
      await crawlJobCheckpoint();
      assertNotRiskBlocked();
      if (!JdSearchExtractor.isNextPageAvailable()) {
        throw new Error(
          `无法自动翻到第 ${targetPage} 页，请手动翻页后再次点「继续未完成任务」`
        );
      }
      const skusBefore = new Set(
        JdSearchExtractor.findSearchCards()
          .map((c) => c.getAttribute("data-sku"))
          .filter(Boolean)
      );
      await JdSearchExtractor.clickNextPage();
      const updated = await JdSearchExtractor.waitForNewSearchResults(skusBefore, 15000);
      if (!updated) {
        throw new Error(`翻页失败（目标第 ${targetPage} 页）`);
      }
      await sleep(2000);
    }
  }

  async function tryAutoResumeAfterNav() {
    if (sessionStorage.getItem(AUTO_RESUME_FLAG) !== "1") return;
    sessionStorage.removeItem(AUTO_RESUME_FLAG);
    const cp = await loadCheckpoint();
    if (!cp?.kind) return;
    showToast("搜索页已打开，正在恢复任务…");
    await sleep(1500);
    const ready = await waitForSearchCards();
    if (!ready) {
      showToast("商品列表尚未加载，请稍候再点「继续未完成任务」", true);
      return;
    }
    await runResumeJob({ skipNavigation: true });
  }

  async function runResumeJob(options = {}) {
    const cp = await loadCheckpoint();
    if (!cp?.kind) {
      showToast("没有可继续的任务", true);
      return;
    }

    if (!options.skipNavigation) {
      const ready = await ensureSearchPageReady(cp.searchUrl);
      if (!ready) return;
    } else {
      const ok = await waitForSearchCards();
      if (!ok) {
        showToast("当前页没有商品列表，请打开搜索结果页", true);
        return;
      }
    }

    if (cp.kind === "deep-crawl") {
      await runDeepCrawlSearch({
        multiPage: Boolean(cp.multiPage),
        downloadAtEnd: Boolean(cp.downloadAtEnd),
        resume: cp,
      });
      return;
    }

    if (cp.kind === "batch-detail") {
      await runBatchDetailExtract({ resume: cp });
      return;
    }

    showToast(`任务类型 ${cp.kind} 暂不支持续跑`, true);
  }

  async function cacheSearchCardUrls(cards) {
    if (!cards?.length) return;
    const keyword = JdSearchExtractor.searchKeywordFromUrl?.() || null;
    const entries = [];
    for (const card of cards) {
      const sku = card.getAttribute("data-sku");
      if (!sku) continue;
      const link = JdSearchExtractor.findProductLinkInCard(card);
      entries.push({
        url: JdSearchExtractor.itemUrlFromSku(sku),
        sku,
        title: link?.getAttribute("title") || link?.textContent?.trim()?.slice(0, 80) || null,
        search_keyword: keyword,
      });
    }
    if (!entries.length) return;
    const saved = await chrome.runtime.sendMessage({
      type: "APPEND_PRODUCT_URLS",
      urls: entries,
    });
    if (!saved?.ok) {
      console.warn("cacheSearchCardUrls:", saved?.error);
    }
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
    const maxPages = await getMaxPages();
    showToast(
      maxPages > 1
        ? `正在平滑滚屏并翻页缓存链接（最多 ${maxPages} 页）…`
        : "正在平滑滚屏并缓存本页链接…"
    );

    try {
      await withCrawlJob("cache-urls", async () => {
        await crawlJobCheckpoint();
        const result =
          maxPages > 1
            ? await JdSearchExtractor.collectSearchUrlsMultiPage({
                maxPages,
                onPageCheckpoint: crawlJobCheckpoint,
              })
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
      });
    } catch (error) {
      if (isUserStopped(error)) {
        showToast("翻页缓存链接已结束");
      } else {
        showToast(String(error.message || error), true);
      }
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
  async function runDeepCrawlSearch({
    multiPage = false,
    downloadAtEnd = false,
    resume = null,
  } = {}) {
    const maxPages = resume?.maxPages ?? (multiPage ? await getMaxPages() : 1);
    const delayMs = resume?.delayMs ?? (await getDetailTabDelay());
    const searchTabId = resume?.searchTabId ?? (await getThisTabId());
    const searchUrl = resume?.searchUrl || location.href;
    const stats = resume?.stats || { detailOk: 0, detailFail: 0, pages: 0 };
    const startPage = resume?.pageNum || 1;
    let startCard = resume?.cardIndex || 0;

    showToast(
      resume
        ? `续跑深度抓取：从第 ${startPage} 页第 ${startCard + 1} 个商品继续…`
        : multiPage
          ? `深度抓取：最多 ${maxPages} 页，逐一点开详情提取…`
          : "本页逐一点开详情提取…"
    );

    try {
      await withCrawlJob("deep-crawl", async () => {
        await mergeCheckpoint({
          kind: "deep-crawl",
          searchUrl,
          searchTabId,
          multiPage,
          downloadAtEnd,
          maxPages,
          delayMs,
          stats,
          pageNum: startPage,
          cardIndex: startCard,
        });

        if (startPage > 1) {
          await advanceToSearchPage(startPage);
        }

        for (let pageNum = startPage; pageNum <= maxPages; pageNum++) {
          await crawlJobCheckpoint();
          assertNotRiskBlocked();

          if (pageNum > startPage || startCard === 0) {
            await JdSearchExtractor.humanScrollPage();
          }
          stats.pages = pageNum;

          const cards = JdSearchExtractor.findSearchCards();
          if (!cards.length) {
            if (window.JdRisk?.isBlockedContext(location.href, document.title)) {
              await handleRiskBlocked({
                kind: "deep-crawl",
                searchUrl,
                searchTabId,
                multiPage,
                downloadAtEnd,
                maxPages,
                delayMs,
                stats,
                pageNum,
                cardIndex: startCard,
              });
            }
            throw new Error("当前页未找到商品卡片");
          }

          await cacheSearchCardUrls(cards);

          const begin = pageNum === startPage ? startCard : 0;
          for (let i = begin; i < cards.length; i++) {
            await crawlJobCheckpoint();
            assertNotRiskBlocked();

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

            await mergeCheckpoint({
              kind: "deep-crawl",
              searchUrl,
              searchTabId,
              multiPage,
              downloadAtEnd,
              maxPages,
              delayMs,
              stats,
              pageNum,
              cardIndex: i,
            });

            if (link && window.JdHumanMouse?.humanClickOpenInNewTab) {
              try {
                await window.JdHumanMouse.humanClickOpenInNewTab(link);
              } catch (err) {
                console.warn("humanClickOpenInNewTab:", err);
              }
              await interruptedDelay(randDelay(280, 520));
            }

            let result;
            try {
              result = await chrome.runtime.sendMessage({
                type: "EXTRACT_URL_IN_NEW_TAB",
                url,
                options: {
                  afterLoadMs: 2800,
                  activateTab: true,
                  returnToTabId: searchTabId,
                  extract: { scroll: true },
                },
              });
            } catch (err) {
              if (isRiskBlocked(err)) {
                await handleRiskBlocked({
                  kind: "deep-crawl",
                  searchUrl,
                  searchTabId,
                  multiPage,
                  downloadAtEnd,
                  maxPages,
                  delayMs,
                  stats,
                  pageNum,
                  cardIndex: i,
                });
              }
              throw err;
            }

            if (result?.ok) {
              stats.detailOk += 1;
            } else if (isRiskBlocked(result)) {
              await handleRiskBlocked({
                kind: "deep-crawl",
                searchUrl,
                searchTabId,
                multiPage,
                downloadAtEnd,
                maxPages,
                delayMs,
                stats,
                pageNum,
                cardIndex: i,
              });
            } else if (isUserStopped(result) || result?.code === "USER_STOPPED") {
              throw userStoppedError();
            } else {
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

            assertNotRiskBlocked();

            await mergeCheckpoint({
              kind: "deep-crawl",
              searchUrl,
              searchTabId,
              multiPage,
              downloadAtEnd,
              maxPages,
              delayMs,
              stats,
              pageNum,
              cardIndex: i + 1,
            });

            if (i < cards.length - 1) {
              await interruptedDelay(delayMs);
            }
          }

          startCard = 0;

          if (pageNum >= maxPages) break;
          if (!JdSearchExtractor.isNextPageAvailable()) break;

          await crawlJobCheckpoint();
          showToast(`第 ${pageNum} 页完成，正在点击「下一页」…`);
          const skusBefore = new Set(
            JdSearchExtractor.findSearchCards()
              .map((c) => c.getAttribute("data-sku"))
              .filter(Boolean)
          );
          await JdSearchExtractor.clickNextPage();
          const updated = await JdSearchExtractor.waitForNewSearchResults(skusBefore, 15000);
          if (!updated) break;
          await interruptedDelay(2000);
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
      });
    } catch (error) {
      if (isRiskBlocked(error)) {
        await refreshResumeButton();
        return;
      }
      if (isUserStopped(error)) {
        const cache = await chrome.runtime.sendMessage({ type: "GET_JSONL_RECORDS" });
        showToast(
          `深度抓取已结束：${stats.pages} 页，详情成功 ${stats.detailOk}、失败 ${stats.detailFail}，详情缓存 ${cache?.count ?? "?"} 条`
        );
        await refreshResumeButton();
      } else {
        showToast(String(error.message || error), true);
      }
    }
  }

  function randDelay(min, max) {
    return min + Math.random() * (max - min);
  }

  async function runBatchDetailExtract({ resume = null } = {}) {
    const queue = await chrome.runtime.sendMessage({ type: "GET_PRODUCT_URLS" });
    if (!queue?.ok) {
      showToast(queue?.error || "读取链接缓存失败", true);
      return;
    }
    if (!queue.count) {
      showToast("链接缓存为空，请先点「翻页缓存链接」", true);
      return;
    }

    const delayMs = resume?.delayMs ?? (await getDetailTabDelay());
    const searchUrl = resume?.searchUrl || location.href;
    let ok = resume?.stats?.ok || 0;
    let fail = resume?.stats?.fail || 0;
    const startIndex = resume?.queueIndex || 0;

    if (resume) {
      showToast(`续跑批量详情：从第 ${startIndex + 1}/${queue.count} 条继续…`);
    }

    try {
      await withCrawlJob("batch-detail", async () => {
        await mergeCheckpoint({
          kind: "batch-detail",
          searchUrl,
          delayMs,
          queueIndex: startIndex,
          stats: { ok, fail },
        });

        for (let i = startIndex; i < queue.urls.length; i++) {
          await crawlJobCheckpoint();
          assertNotRiskBlocked();

          const entry = queue.urls[i];
          const label = entry.title || entry.sku || entry.url;
          showToast(`详情 ${i + 1}/${queue.count}：提取 ${String(label).slice(0, 28)}…`);

          await mergeCheckpoint({
            kind: "batch-detail",
            searchUrl,
            delayMs,
            queueIndex: i,
            stats: { ok, fail },
          });

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
          } else if (isRiskBlocked(result)) {
            await handleRiskBlocked({
              kind: "batch-detail",
              searchUrl,
              delayMs,
              queueIndex: i,
              stats: { ok, fail },
            });
          } else if (isUserStopped(result) || result?.code === "USER_STOPPED") {
            throw userStoppedError();
          } else {
            fail += 1;
            console.warn("Detail extract failed:", entry.url, result?.error);
          }

          await mergeCheckpoint({
            kind: "batch-detail",
            searchUrl,
            delayMs,
            queueIndex: i + 1,
            stats: { ok, fail },
          });

          if (i < queue.urls.length - 1) {
            await interruptedDelay(delayMs);
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
      });
    } catch (error) {
      if (isRiskBlocked(error)) {
        await refreshResumeButton();
        return;
      }
      if (isUserStopped(error)) {
        const records = await chrome.runtime.sendMessage({ type: "GET_JSONL_RECORDS" });
        const detailCount = records?.count ?? ok;
        showToast(
          `批量详情已结束：成功 ${ok}，失败 ${fail}，详情缓存 ${detailCount} 条`
        );
        await refreshResumeButton();
      } else {
        showToast(String(error.message || error), true);
      }
    }
  }

  if (!window.__jdSearchCrawlJobStateListener) {
    window.__jdSearchCrawlJobStateListener = true;
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "CRAWL_JOB_STATE_CHANGED") {
        syncJobControlsFromBackground();
        refreshResumeButton();
      }
      if (message?.type === "CRAWL_BLOCKED_BY_RISK") {
        refreshResumeButton();
        showToast(
          "搜索页被重定向到验证/首页，进度已保存。请完成验证后点「继续未完成任务」",
          true
        );
      }
    });
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
