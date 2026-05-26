/**
 * 京东页面 URL 识别（popup / content scripts 共用）
 */
(function (global) {
  const ITEM_HOST_RE = /^item\.(jd|jkcsjd|yiyaojd|jingxi)\.com$/i;
  const LIST_HOST_RE = /^(search|list)\.jd\.com$/i;

  function parseUrl(url) {
    try {
      return new URL(url || "");
    } catch (_) {
      return null;
    }
  }

  /** 商品详情页 item.jd.com/123.html */
  function isJdItemUrl(url) {
    const u = parseUrl(url);
    if (u) {
      if (!ITEM_HOST_RE.test(u.hostname)) return false;
      return /\/\d+\.html/i.test(u.pathname);
    }
    return /^https:\/\/item\.(jd|jkcsjd|yiyaojd|jingxi)\.com\/\d+\.html/i.test(url || "");
  }

  /** 搜索页 / 分类列表页 search.jd.com、list.jd.com */
  function isJdListUrl(url) {
    const u = parseUrl(url);
    if (u) return LIST_HOST_RE.test(u.hostname);
    return /^https:\/\/(search|list)\.jd\.com\//i.test(url || "");
  }

  /** @returns {'item'|'list'|'unsupported'} */
  function detectPageMode(url) {
    if (isJdItemUrl(url)) return "item";
    if (isJdListUrl(url)) return "list";
    return "unsupported";
  }

  function pageModeLabel(mode) {
    if (mode === "item") return "商品详情页";
    if (mode === "list") return "搜索/分类列表页";
    return "当前页面不支持";
  }

  const api = {
    isJdItemUrl,
    isJdListUrl,
    isJdSearchUrl: isJdListUrl,
    detectPageMode,
    pageModeLabel,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.JdPageUrl = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
