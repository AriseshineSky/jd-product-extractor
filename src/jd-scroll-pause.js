/**
 * 抓取任务暂停时同步暂停页面滚屏（搜索页 / 详情页共用）。
 */
(function (global) {
  const USER_STOPPED = "USER_STOPPED";

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function userStoppedError() {
    const err = new Error("任务已结束");
    err.code = USER_STOPPED;
    return err;
  }

  async function queryCrawlJobState() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "GET_CRAWL_JOB_STATE" });
      return res?.state || { active: false, paused: false, stopped: false };
    } catch (_) {
      return { active: false, paused: false, stopped: false };
    }
  }

  /**
   * 仅在有批量/深度抓取任务 (active) 时拦截滚屏。
   * 商品页单独提取无任务 → 直接放行，不抛「任务已结束」。
   */
  async function waitForCrawlScrollContinue() {
    while (true) {
      const state = await queryCrawlJobState();
      if (!state.active) return true;
      if (state.stopped) throw userStoppedError();
      if (!state.paused) return true;
      await sleep(400);
    }
  }

  async function createScrollShouldContinue() {
    return async function scrollShouldContinue() {
      const state = await queryCrawlJobState();
      if (!state.active) return true;
      if (state.stopped) throw userStoppedError();
      if (state.paused) return false;
      return true;
    };
  }

  async function resolveScrollShouldContinue(options = {}) {
    if (typeof options.shouldContinue === "function") {
      return options.shouldContinue;
    }
    if (typeof global.__jdScrollShouldContinue === "function") {
      return global.__jdScrollShouldContinue;
    }
    return createScrollShouldContinue();
  }

  async function gateScroll(options = {}) {
    const shouldContinue = await resolveScrollShouldContinue(options);
    if (!shouldContinue) return;
    const ok = await shouldContinue();
    if (ok) return;
    await waitForCrawlScrollContinue();
  }

  const api = {
    waitForCrawlScrollContinue,
    createScrollShouldContinue,
    resolveScrollShouldContinue,
    gateScroll,
    USER_STOPPED,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.JdScrollPause = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
