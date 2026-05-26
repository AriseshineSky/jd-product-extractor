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

  /** 无任务 / 未暂停 → true；暂停 → 阻塞直到继续；结束 → 抛错 */
  async function waitForCrawlScrollContinue() {
    while (true) {
      const state = await queryCrawlJobState();
      if (state.stopped || !state.active) throw userStoppedError();
      if (!state.paused) return true;
      await sleep(400);
    }
  }

  async function createScrollShouldContinue() {
    return async function scrollShouldContinue() {
      const state = await queryCrawlJobState();
      if (state.stopped || !state.active) throw userStoppedError();
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
