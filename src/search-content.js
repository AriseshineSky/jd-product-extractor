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
  ];
  const USER_STOPPED = "USER_STOPPED";
  const JD_RISK_BLOCKED = "JD_RISK_BLOCKED";
  const AUTO_RESUME_FLAG = "jd_auto_resume_after_nav";
  const CRAWL_KIND_LABELS = {
    "deep-crawl": "深度抓取",
    "batch-detail": "批量详情",
    "cache-urls": "翻页缓存链接",
  };

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
        #jd-search-resume-job-btn {
          background: #0d9488;
          white-space: normal;
          max-width: min(360px, calc(100vw - 36px));
          text-align: right;
          line-height: 1.35;
        }
        #jd-search-job-status {
          position: fixed;
          right: 18px;
          bottom: 120px;
          z-index: 2147483647;
          max-width: min(400px, calc(100vw - 36px));
          padding: 10px 12px;
          border-radius: 10px;
          font-size: 11px;
          line-height: 1.5;
          color: #e5e7eb;
          background: rgba(15, 23, 42, 0.94);
          border: 1px solid rgba(148, 163, 184, 0.35);
          display: none;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
        }
        #jd-search-job-status[data-visible="1"] { display: block; }
        #jd-search-job-status[data-running="1"] { border-color: rgba(52, 211, 153, 0.55); }
        #jd-search-job-status[data-paused="1"] { border-color: rgba(251, 191, 36, 0.65); }
        #jd-search-job-status[data-stopped="1"] { border-color: rgba(248, 113, 113, 0.55); }
        #jd-search-job-status .jd-job-line { margin: 0 0 4px; }
        #jd-search-job-status .jd-job-line:last-child { margin-bottom: 0; }
        #jd-search-job-status .jd-job-reason { color: #fca5a5; }
        #jd-search-resume-tooltip {
          position: fixed;
          z-index: 2147483648;
          max-width: 360px;
          padding: 8px 10px;
          border-radius: 8px;
          font-size: 11px;
          line-height: 1.45;
          color: #f9fafb;
          background: rgba(17, 24, 39, 0.96);
          border: 1px solid rgba(148, 163, 184, 0.4);
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.2);
          pointer-events: auto;
          display: none;
        }
        #jd-search-resume-tooltip[data-visible="1"] { display: block; }
        #jd-search-extractor-toast {
          position: fixed;
          right: 18px;
          bottom: 300px;
          z-index: 2147483647;
          max-width: 380px;
          padding: 10px 12px;
          border-radius: 8px;
          font-size: 12px;
          line-height: 1.45;
          color: #fff;
          background: rgba(17, 24, 39, 0.92);
          display: none;
          pointer-events: auto;
          cursor: default;
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
    bindResumeTooltipBehavior(resumeBtn);
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

    const statusHud = document.createElement("div");
    statusHud.id = "jd-search-job-status";
    statusHud.setAttribute("aria-live", "polite");
    document.documentElement.appendChild(statusHud);

    document.documentElement.appendChild(panel);
    syncJobControlsFromBackground();
    refreshResumeButton();
    updateJobStatusHud();
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

  function isTransientRuntimeError(err) {
    const msg = String(err?.message || err);
    return /establish connection|receiving end|context invalidated|message port closed/i.test(
      msg
    );
  }

  /** 后台 service worker 休眠时重试，减少「抓几条就停」 */
  async function sendRuntimeMessage(payload, { retries = 4, delayMs = 500 } = {}) {
    let lastErr;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await chrome.runtime.sendMessage(payload);
      } catch (err) {
        lastErr = err;
        if (!isTransientRuntimeError(err) || attempt >= retries - 1) throw err;
        await sleep(delayMs * (attempt + 1));
      }
    }
    throw lastErr;
  }

  async function getCrawlJobState() {
    try {
      const res = await sendRuntimeMessage({ type: "GET_CRAWL_JOB_STATE" }, { retries: 2 });
      return (
        res?.state || {
          active: false,
          paused: false,
          pauseReason: null,
          stopped: false,
        }
      );
    } catch (_) {
      return { active: false, paused: false, pauseReason: null, stopped: false };
    }
  }

  function setLiveProgress(label) {
    window.__jdCrawlLiveProgress = {
      label: String(label || ""),
      at: Date.now(),
    };
  }

  async function recordCrawlStatus(patch) {
    try {
      await sendRuntimeMessage({ type: "MERGE_CRAWL_CHECKPOINT", patch });
    } catch (_) {
      /* ignore */
    }
    const detail = patch?.stop_reason || patch?.last_status;
    if (detail) {
      sendRuntimeMessage({
        type: "APPEND_CRAWL_LOG",
        event: "status",
        detail: String(detail),
      }).catch(() => {});
    }
    updateJobStatusHud();
  }

  function formatJobStateLine(state) {
    if (!state?.active) {
      if (state?.stopped) return "状态：正在结束…";
      return "状态：未运行";
    }
    if (state.paused && state.pauseReason === "risk") {
      return "状态：已中断（京东验证/首页）— 请验证后点「继续未完成任务」";
    }
    if (state.paused) return "状态：已暂停 — 点「继续」恢复";
    return "状态：运行中";
  }

  async function updateJobStatusHud() {
    const hud = document.getElementById("jd-search-job-status");
    if (!hud) return;

    const [state, cp] = await Promise.all([getCrawlJobState(), loadCheckpoint()]);
    const show = state.active || Boolean(cp?.kind);
    if (!show) {
      hud.dataset.visible = "0";
      hud.textContent = "";
      return;
    }

    hud.dataset.visible = "1";
    hud.dataset.running = state.active && !state.paused ? "1" : "0";
    hud.dataset.paused = state.paused ? "1" : "0";
    hud.dataset.stopped = !state.active && cp?.kind ? "1" : "0";

    const lines = [];
    lines.push(formatJobStateLine(state));
    const kind =
      CRAWL_KIND_LABELS[state.kind] || CRAWL_KIND_LABELS[cp?.kind] || state.kind || cp?.kind;
    if (kind) lines.push(`任务：${kind}`);

    if (cp?.kind === "deep-crawl") {
      const page = cp.pageNum || 1;
      const card = Number.isFinite(cp.cardIndex) ? cp.cardIndex + 1 : "?";
      const ok = cp.stats?.detailOk ?? 0;
      const fail = cp.stats?.detailFail ?? 0;
      lines.push(`进度：搜索第${page}页 · 待处理第${card}个 · 详情成功${ok} 失败${fail}`);
    } else if (cp?.kind === "batch-detail" && Number.isFinite(cp.queueIndex)) {
      const linkCount = await getLinkQueueCount();
      const pos = cp.queueIndex + 1;
      lines.push(
        linkCount != null
          ? `进度：队列 ${pos}/${linkCount} · 成功${cp.stats?.ok ?? 0} 失败${cp.stats?.fail ?? 0}`
          : `进度：队列第 ${pos} 条`
      );
    }

    const live = window.__jdCrawlLiveProgress;
    if (live?.label) lines.push(`当前：${live.label}`);

    if (cp?.last_status && state.active) lines.push(`步骤：${cp.last_status}`);
    if (cp?.stop_reason && !state.active) {
      lines.push(`停止原因：${cp.stop_reason}`);
    }

    hud.innerHTML = lines
      .map((line, i) => {
        const cls =
          i === lines.length - 1 && line.startsWith("停止原因：")
            ? "jd-job-line jd-job-reason"
            : "jd-job-line";
        return `<p class="${cls}">${line.replace(/</g, "&lt;")}</p>`;
      })
      .join("");
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
    if (pauseBtn) {
      if (state.paused && state.pauseReason === "risk") {
        pauseBtn.textContent = "继续";
        pauseBtn.disabled = true;
      } else {
        pauseBtn.textContent = state.paused ? "继续" : "暂停";
        pauseBtn.disabled = !state.active;
      }
    }
    await syncUnloadGuard();
    await refreshResumeButton();
    updateJobStatusHud();
  }

  async function togglePauseJob() {
    const state = await getCrawlJobState();
    if (!state.active) return;
    if (state.paused) {
      await sendRuntimeMessage({ type: "CRAWL_JOB_RESUME" });
      setLiveProgress("用户已继续任务");
      showToast("已继续：滚屏与抓取将恢复");
    } else {
      await sendRuntimeMessage({ type: "CRAWL_JOB_PAUSE", reason: "user" });
      setLiveProgress("用户已暂停任务");
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
    await sendRuntimeMessage({ type: "CRAWL_JOB_STOP" });
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

    if (state.paused && state.pauseReason === "risk") {
      await recordCrawlStatus({
        stop_reason: "京东验证或跳转首页（自动检测）",
        last_status: "等待用户完成验证",
      });
      const err = new Error("京东验证中断");
      err.code = JD_RISK_BLOCKED;
      throw err;
    }

    while (state.paused && !state.stopped) {
      setLiveProgress("任务已暂停，等待点「继续」");
      updateJobStatusHud();
      const pauseBtn = document.getElementById("jd-search-pause-job-btn");
      if (pauseBtn) pauseBtn.textContent = "继续";
      await sleep(400);
      state = await getCrawlJobState();
      if (state.stopped || !state.active) throw userStoppedError();
      if (state.paused && state.pauseReason === "risk") {
        const err = new Error("京东验证中断");
        err.code = JD_RISK_BLOCKED;
        throw err;
      }
    }

    state = await getCrawlJobState();
    if (state.stopped || !state.active) throw userStoppedError();

    const pauseBtn = document.getElementById("jd-search-pause-job-btn");
    if (pauseBtn && state.active) pauseBtn.textContent = "暂停";
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
    setLiveProgress("任务启动…");
    await sendRuntimeMessage({ type: "CRAWL_JOB_START", kind, tabId });
    setAllButtonsDisabled(true);
    setJobControlsEnabled(true);
    setUnloadGuard(true);
    updateJobStatusHud();

    const pingTimer = setInterval(() => {
      sendRuntimeMessage({ type: "CRAWL_JOB_PING" }).catch(() => {});
      updateJobStatusHud();
    }, 15000);

    let clearCheckpoint = false;
    try {
      await recordCrawlStatus({ last_status: "任务已开始", stop_reason: "" });
      const result = await runner();
      if (result?.jobCompleted === true) clearCheckpoint = true;
      return result;
    } catch (error) {
      if (isRiskBlocked(error)) {
        clearCheckpoint = false;
      } else if (isUserStopped(error)) {
        clearCheckpoint = false;
        await recordCrawlStatus({
          stop_reason: "用户点击结束",
          last_status: "任务已结束",
        });
      } else if (isTransientRuntimeError(error)) {
        clearCheckpoint = false;
        await recordCrawlStatus({
          stop_reason: `插件通信中断: ${error.message || error}（可点继续未完成任务）`,
          last_status: "后台连接失败",
        });
      } else {
        clearCheckpoint = false;
        await recordCrawlStatus({
          stop_reason: String(error?.message || error),
          last_status: "任务异常退出",
        });
      }
      throw error;
    } finally {
      clearInterval(pingTimer);
      window.__jdCrawlLiveProgress = null;
      try {
        await sendRuntimeMessage({
          type: "CRAWL_JOB_END",
          clearCheckpoint,
        });
      } catch (_) {
        /* service worker may be asleep; job state will expire */
      }
      setAllButtonsDisabled(false);
      setJobControlsEnabled(false);
      const pauseBtn = document.getElementById("jd-search-pause-job-btn");
      if (pauseBtn) pauseBtn.textContent = "暂停";
      await syncUnloadGuard();
      await refreshResumeButton();
      updateJobStatusHud();
    }
  }

  function isUserStopped(error) {
    return error?.code === USER_STOPPED || error?.message === "任务已结束";
  }

  function isRiskBlocked(error) {
    return (
      error?.code === JD_RISK_BLOCKED ||
      /验证|登录|首页|JD_RISK|页面不可用|空白|休眠|未加载/.test(
        String(error?.message || error?.error || "")
      )
    );
  }

  async function loadCheckpoint() {
    try {
      const res = await sendRuntimeMessage(
        { type: "GET_CRAWL_CHECKPOINT" },
        { retries: 3 }
      );
      if (res?.ok === false) return null;
      return res?.checkpoint || null;
    } catch (err) {
      console.warn("loadCheckpoint failed:", err);
      return null;
    }
  }

  async function mergeCheckpoint(patch) {
    await sendRuntimeMessage({ type: "MERGE_CRAWL_CHECKPOINT", patch });
  }

  async function getLinkQueueCount() {
    try {
      const queue = await chrome.runtime.sendMessage({ type: "GET_PRODUCT_URLS" });
      return queue?.ok && Number.isFinite(queue.count) ? queue.count : null;
    } catch (_) {
      return null;
    }
  }

  /** 续跑按钮文案：深度抓取按搜索页商品位点；批量详情按链接队列下标。 */
  async function formatResumeButtonLabel(cp) {
    const kindLabel = CRAWL_KIND_LABELS[cp.kind] || cp.kind;
    const parts = [kindLabel];

    if (cp.kind === "deep-crawl") {
      if (cp.pageNum) parts.push(`搜索第${cp.pageNum}页`);
      if (Number.isFinite(cp.cardIndex)) {
        parts.push(`待处理第${cp.cardIndex + 1}个商品`);
      }
      const detailOk = cp.stats?.detailOk;
      if (Number.isFinite(detailOk) && detailOk > 0) {
        parts.push(`已提${detailOk}条详情`);
      }
      const linkCount = await getLinkQueueCount();
      if (linkCount > 0) parts.push(`链接缓存${linkCount}条`);
    } else if (cp.kind === "batch-detail") {
      const linkCount = await getLinkQueueCount();
      if (Number.isFinite(cp.queueIndex)) {
        const pos = cp.queueIndex + 1;
        parts.push(
          linkCount != null ? `队列第${pos}/${linkCount}条` : `队列第${pos}条`
        );
      }
    } else {
      if (cp.pageNum) parts.push(`第${cp.pageNum}页`);
      if (Number.isFinite(cp.cardIndex)) parts.push(`第${cp.cardIndex + 1}个`);
      if (Number.isFinite(cp.queueIndex)) parts.push(`队列第${cp.queueIndex + 1}条`);
    }

    return `继续未完成任务（${parts.join("·")}）`;
  }

  async function refreshResumeButton() {
    const btn = document.getElementById("jd-search-resume-job-btn");
    if (!btn) return;
    const [cp, state] = await Promise.all([loadCheckpoint(), getCrawlJobState()]);
    const hasJob = Boolean(cp?.kind);
    btn.style.display = hasJob ? "inline-block" : "none";
    // 续跑仅在「有进度且当前无运行中任务」时可点；与暂停/结束按钮逻辑分开
    btn.disabled = !hasJob || state.active;
    btn.removeAttribute("title");
    if (hasJob) {
      btn.textContent = await formatResumeButtonLabel(cp);
      if (cp.kind === "deep-crawl") {
        btn.dataset.tooltipText =
          "续跑按搜索结果页位置继续（第几页、第几个商品），不是按链接缓存条数。链接缓存会在每页开始时批量写入。";
      } else if (cp.kind === "batch-detail") {
        btn.dataset.tooltipText = "续跑按链接缓存队列的下标继续逐条打开详情。";
      } else {
        btn.dataset.tooltipText = "";
      }
    } else {
      btn.textContent = "继续未完成任务";
      btn.dataset.tooltipText = "";
      hideResumeTooltip();
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
    const reason =
      window.JdRisk?.blockedReason?.(location.href, document.title) ||
      "京东验证或跳转首页";
    await mergeCheckpoint({
      ...state,
      searchUrl: state.searchUrl || location.href,
      paused_reason: "risk",
      stop_reason: reason,
      last_status: "因京东验证中断",
    });
    await sendRuntimeMessage({ type: "CRAWL_JOB_PAUSE", reason: "risk" });
    await refreshResumeButton();
    updateJobStatusHud();
    showToast(
      `遇到${reason}，进度已保存。请完成验证后回到搜索页，点「继续未完成任务」`,
      true
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
    let cp;
    try {
      cp = await loadCheckpoint();
    } catch (_) {
      cp = null;
    }
    if (!cp?.kind) {
      showToast(
        "没有可继续的任务。若刚重载过扩展，请刷新搜索页后再试；进度可能已丢失，可从当前页重新开始深度抓取",
        true
      );
      await refreshResumeButton();
      updateJobStatusHud();
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

  function hideSearchToast() {
    const toast = document.getElementById("jd-search-extractor-toast");
    if (toast) toast.style.display = "none";
    clearTimeout(showToast._timer);
    showToast._timer = null;
  }

  function bindSearchToastBehavior(toast) {
    if (toast.dataset.leaveBound) return;
    toast.dataset.leaveBound = "1";
    toast.addEventListener("mouseenter", () => {
      clearTimeout(showToast._timer);
      showToast._timer = null;
    });
    toast.addEventListener("mouseleave", hideSearchToast);
  }

  function showToast(text, isError = false) {
    let toast = document.getElementById("jd-search-extractor-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "jd-search-extractor-toast";
      document.documentElement.appendChild(toast);
      bindSearchToastBehavior(toast);
    }
    toast.style.display = "block";
    toast.style.background = isError ? "rgba(185, 28, 28, 0.95)" : "rgba(17, 24, 39, 0.92)";
    toast.textContent = text;
    clearTimeout(showToast._timer);
    if (!toast.matches(":hover")) {
      showToast._timer = setTimeout(hideSearchToast, 8000);
    }
  }

  function hideResumeTooltip() {
    const tip = document.getElementById("jd-search-resume-tooltip");
    if (tip) tip.dataset.visible = "0";
  }

  function showResumeTooltip(anchor, text) {
    let tip = document.getElementById("jd-search-resume-tooltip");
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "jd-search-resume-tooltip";
      tip.setAttribute("role", "tooltip");
      document.documentElement.appendChild(tip);
      tip.addEventListener("mouseleave", hideResumeTooltip);
      document.addEventListener(
        "scroll",
        hideResumeTooltip,
        true
      );
    }
    tip.textContent = text;
    const rect = anchor.getBoundingClientRect();
    tip.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    tip.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 6)}px`;
    tip.style.left = "auto";
    tip.style.top = "auto";
    tip.dataset.visible = "1";
  }

  function bindResumeTooltipBehavior(btn) {
    if (btn.dataset.tooltipBound) return;
    btn.dataset.tooltipBound = "1";
    btn.addEventListener("mouseenter", () => {
      const text = btn.dataset.tooltipText;
      if (text) showResumeTooltip(btn, text);
    });
    btn.addEventListener("mouseleave", hideResumeTooltip);
    btn.addEventListener("click", hideResumeTooltip);
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
        return { jobCompleted: true };
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

            const progressLabel = `第${pageNum}页 ${i + 1}/${cards.length}：${label}`;
            setLiveProgress(progressLabel);
            await recordCrawlStatus({ last_status: `正在提取 ${progressLabel}` });
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
              result = await sendRuntimeMessage({
                type: "EXTRACT_URL_IN_NEW_TAB",
                url,
                options: {
                  afterLoadMs: 2800,
                  activateTab: true,
                  returnToTabId: searchTabId,
                  tabTimeoutMs: 90000,
                  maxAttempts: 2,
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
              const errMsg = result?.error || "未知错误";
              console.warn("Detail extract failed:", url, errMsg);
              showToast(
                `第${pageNum}页第${i + 1}个提取失败：${errMsg}，已跳过继续`,
                true
              );
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
        return { jobCompleted: true };
      });
    } catch (error) {
      if (isRiskBlocked(error)) {
        showToast(
          `${error?.message || "页面异常"}。进度已保存，验证/刷新搜索页后可点「继续未完成任务」`,
          true
        );
        await refreshResumeButton();
        updateJobStatusHud();
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
          const progressLabel = `队列 ${i + 1}/${queue.count}：${String(label).slice(0, 28)}`;
          setLiveProgress(progressLabel);
          await recordCrawlStatus({ last_status: `正在提取 ${progressLabel}` });
          showToast(`详情 ${i + 1}/${queue.count}：提取 ${String(label).slice(0, 28)}…`);

          await mergeCheckpoint({
            kind: "batch-detail",
            searchUrl,
            delayMs,
            queueIndex: i,
            stats: { ok, fail },
          });

          let result;
          try {
            result = await sendRuntimeMessage({
              type: "EXTRACT_URL_IN_NEW_TAB",
              url: entry.url,
              options: {
                afterLoadMs: 2500,
                activateTab: true,
                tabTimeoutMs: 90000,
                maxAttempts: 2,
                extract: { scroll: true },
              },
            });
          } catch (err) {
            if (isRiskBlocked(err)) {
              await handleRiskBlocked({
                kind: "batch-detail",
                searchUrl,
                delayMs,
                queueIndex: i,
                stats: { ok, fail },
              });
            }
            throw err;
          }

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
            const errMsg = result?.error || "未知错误";
            console.warn("Detail extract failed:", entry.url, errMsg);
            showToast(`队列第${i + 1}条提取失败：${errMsg}，已跳过继续`, true);
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
        return { jobCompleted: true };
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

  if (!window.__jdSearchTabVisibilityListener) {
    window.__jdSearchTabVisibilityListener = true;
    let hiddenSince = 0;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        hiddenSince = Date.now();
        return;
      }
      const hiddenMs = hiddenSince ? Date.now() - hiddenSince : 0;
      hiddenSince = 0;
      if (hiddenMs < 3 * 60 * 1000) return;

      (async () => {
        const state = await getCrawlJobState();
        const cp = await loadCheckpoint();
        const mins = Math.max(1, Math.round(hiddenMs / 60000));
        if (state.active) {
          await recordCrawlStatus({
            last_status: `标签页后台约 ${mins} 分钟（可能曾休眠）`,
          });
          if (window.JdRisk?.isBlockedContext(location.href, document.title)) {
            showToast(
              `${window.JdRisk.blockedReason(location.href, document.title)}。请刷新搜索页后点「继续未完成任务」`,
              true
            );
          }
          return;
        }
        if (cp?.kind) {
          showToast(
            `标签页已恢复（后台约 ${mins} 分钟）。任务已停止：${cp.stop_reason || "见状态面板"}。可点「继续未完成任务」`,
            true
          );
          updateJobStatusHud();
        }
      })();
    });
  }

  if (!window.__jdSearchCrawlJobStateListener) {
    window.__jdSearchCrawlJobStateListener = true;
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "CRAWL_JOB_STATE_CHANGED") {
        syncJobControlsFromBackground();
        refreshResumeButton();
        updateJobStatusHud();
      }
      if (message?.type === "CRAWL_BLOCKED_BY_RISK") {
        (async () => {
          const cp = await loadCheckpoint();
          const reason =
            message.reason === "home"
              ? "搜索页跳转到京东首页"
              : "搜索页跳转到验证/登录页";
          if (cp?.kind) {
            await mergeCheckpoint({
              ...cp,
              paused_reason: "risk",
              stop_reason: reason,
              last_status: "搜索页 URL 异常",
            });
          } else {
            await mergeCheckpoint({
              paused_reason: "risk",
              stop_reason: reason,
              searchUrl: location.href,
              last_status: "搜索页 URL 异常",
            });
          }
          await refreshResumeButton();
          updateJobStatusHud();
          showToast(
            `${reason}，任务已保存进度。请完成验证后点「继续未完成任务」`,
            true
          );
        })();
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
