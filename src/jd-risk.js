/**
 * 京东登录 / 风控 / 验证后跳首页 等页面识别（popup / content / background 共用）
 */
(function (global) {
  const RISK_HOST_RE =
    /(^|\.)((passport|aq)\.jd\.com|cfe\.m\.jd\.com)$/i;

  function parseUrl(url) {
    try {
      return new URL(url || "");
    } catch (_) {
      return null;
    }
  }

  function isJdRiskUrl(url) {
    const u = parseUrl(url);
    if (!u) return false;
    if (RISK_HOST_RE.test(u.hostname)) return true;
    const path = (u.pathname || "").toLowerCase();
    const full = (url || "").toLowerCase();
    if (full.includes("risk_handler") || full.includes("/verify/")) return true;
    return false;
  }

  /** 抓取过程中被踢到京东首页（非搜索/列表） */
  function isJdHomeUrl(url) {
    const u = parseUrl(url);
    if (!u) return false;
    const host = u.hostname.toLowerCase();
    if (host !== "www.jd.com" && host !== "jd.com") return false;
    const path = (u.pathname || "/").replace(/\/+$/, "") || "/";
    return path === "" || path === "/";
  }

  function isJdListUrl(url) {
    if (global.JdPageUrl?.isJdListUrl) return global.JdPageUrl.isJdListUrl(url);
    return /^https:\/\/(search|list)\.jd\.com\//i.test(url || "");
  }

  /** 休眠/断网后标签常处于空白或未加载 */
  function isBlankOrDiscardedUrl(url) {
    const u = String(url || "").trim().toLowerCase();
    if (!u || u === "about:blank") return true;
    return u.startsWith("chrome://") || u.startsWith("chrome-error://");
  }

  /**
   * 当前页是否处于应暂停抓取的状态（验证页或首页）。
   * @param {string} url
   * @param {string} [title]
   */
  function isBlockedContext(url, title) {
    if (isBlankOrDiscardedUrl(url)) return true;
    if (isJdRiskUrl(url)) return true;
    if (isJdHomeUrl(url)) return true;
    const t = (title || "").trim();
    if (t && (t.includes("登录") || t.includes("验证") || t.includes("安全"))) {
      if (!isJdListUrl(url)) return true;
    }
    return false;
  }

  function blockedReason(url, title) {
    if (isBlankOrDiscardedUrl(url)) {
      return "标签页空白或未加载（常见于电脑休眠、断网或 Chrome 回收标签）";
    }
    if (isJdRiskUrl(url)) return "京东验证/登录页";
    if (isJdHomeUrl(url)) return "已跳转到京东首页";
    const t = (title || "").trim();
    if (t.includes("登录")) return "页面标题含登录";
    if (t.includes("验证")) return "页面标题含验证";
    if (t.includes("安全") && !isJdListUrl(url)) {
      return "页面标题含安全（当前不在搜索列表页）";
    }
    try {
      const host = parseUrl(url)?.hostname || String(url).slice(0, 80);
      return `页面不可用（${host} / ${t.slice(0, 40) || "无标题"}）`;
    } catch (_) {
      return "页面不可用";
    }
  }

  const api = {
    isJdRiskUrl,
    isJdHomeUrl,
    isBlockedContext,
    blockedReason,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.JdRisk = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
