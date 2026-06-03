/**
 * 淘宝/天猫登录 / 滑块验证等页面识别
 */
(function (global) {
  function parseUrl(url) {
    try {
      return new URL(url || "");
    } catch (_) {
      return null;
    }
  }

  function isTaobaoListUrl(url) {
    if (global.JdPageUrl?.isTaobaoListUrl) return global.JdPageUrl.isTaobaoListUrl(url);
    return /^https:\/\/s\.taobao\.com\//i.test(url || "");
  }

  function isTaobaoRiskUrl(url) {
    const u = parseUrl(url);
    const lower = String(url || "").toLowerCase();
    if (lower.includes("login.taobao.com") || lower.includes("passport.taobao.com")) return true;
    if (lower.includes("sec.taobao.com") || lower.includes("/punish")) return true;
    if (lower.includes("_____tmd_____") || lower.includes("x5secdata")) return true;
    if (u) {
      const host = u.hostname.toLowerCase();
      if (host.includes("login") && host.includes("taobao")) return true;
    }
    return false;
  }

  function isBlankOrDiscardedUrl(url) {
    const u = String(url || "").trim().toLowerCase();
    if (!u || u === "about:blank") return true;
    return u.startsWith("chrome://") || u.startsWith("chrome-error://");
  }

  function hasCaptchaOverlay() {
    if (typeof document === "undefined") return false;
    if (document.querySelector('iframe[src*="punish"], iframe[src*="_____tmd_____"]')) {
      return true;
    }
    const bodyText = document.body?.innerText || "";
    return /unusual traffic|slide to verify|请按住滑块|拖动到最右边/i.test(bodyText);
  }

  function isBlockedContext(url, title) {
    if (isTaobaoListUrl(url) && !hasCaptchaOverlay()) return false;
    if (isBlankOrDiscardedUrl(url)) return true;
    if (isTaobaoRiskUrl(url)) return true;
    if (hasCaptchaOverlay()) return true;
    const t = (title || "").trim();
    if (t && (t.includes("登录") || t.includes("验证") || t.includes("安全"))) return true;
    return false;
  }

  function blockedReason(url, title) {
    if (isTaobaoListUrl(url) && !hasCaptchaOverlay()) {
      return "搜索列表页正常";
    }
    if (isBlankOrDiscardedUrl(url)) {
      return "标签页空白或未加载";
    }
    if (hasCaptchaOverlay()) {
      return "淘宝滑块/人机验证，请在本页完成验证";
    }
    if (isTaobaoRiskUrl(url)) return "淘宝登录/验证页";
    const t = (title || "").trim();
    if (t.includes("登录")) return "页面标题含登录";
    if (t.includes("验证")) return "页面标题含验证";
    return "页面不可用（可能触发淘宝风控）";
  }

  const api = {
    isTaobaoRiskUrl,
    isBlockedContext,
    blockedReason,
    hasCaptchaOverlay,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.TaobaoRisk = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
