/**
 * 电商页面 URL 识别（popup / content scripts 共用）
 */
(function (global) {
  const ITEM_HOST_RE = /^item\.(jd|jkcsjd|yiyaojd|jingxi)\.com$/i;
  const LIST_HOST_RE = /^(search|list)\.jd\.com$/i;
  const TAOBAO_LIST_HOST_RE = /^s\.taobao\.com$/i;
  const TAOBAO_ITEM_HOST_RE = /^item\.taobao\.com$/i;
  const TMALL_ITEM_HOST_RE = /^detail\.tmall\.com$/i;

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

  /** 淘宝/天猫搜索列表页 s.taobao.com */
  function isTaobaoListUrl(url) {
    const u = parseUrl(url);
    if (u) return TAOBAO_LIST_HOST_RE.test(u.hostname);
    return /^https:\/\/s\.taobao\.com\//i.test(url || "");
  }

  /** 淘宝/天猫商品详情页 */
  function isTaobaoItemUrl(url) {
    const u = parseUrl(url);
    if (u) {
      const host = u.hostname.toLowerCase();
      if (!TAOBAO_ITEM_HOST_RE.test(host) && !TMALL_ITEM_HOST_RE.test(host)) return false;
      return /\/item\.htm/i.test(u.pathname) && /^\d+$/.test(u.searchParams.get("id") || "");
    }
    return /^https:\/\/(item\.taobao\.com|detail\.tmall\.com)\/item\.htm\?id=\d+/i.test(
      url || ""
    );
  }

  function isListUrl(url) {
    return isJdListUrl(url) || isTaobaoListUrl(url);
  }

  /** @returns {'jd'|'taobao'|null} */
  function detectPlatform(url) {
    if (isJdItemUrl(url) || isJdListUrl(url)) return "jd";
    if (isTaobaoItemUrl(url) || isTaobaoListUrl(url)) return "taobao";
    return null;
  }

  /** @returns {'item'|'list'|'unsupported'} */
  function detectPageMode(url) {
    if (isJdItemUrl(url) || isTaobaoItemUrl(url)) return "item";
    if (isJdListUrl(url) || isTaobaoListUrl(url)) return "list";
    return "unsupported";
  }

  function pageModeLabel(mode, url) {
    const platform = url ? detectPlatform(url) : null;
    if (mode === "item") {
      if (platform === "taobao") return "淘宝/天猫商品详情页";
      return "商品详情页";
    }
    if (mode === "list") {
      if (platform === "taobao") return "淘宝/天猫搜索列表页";
      return "搜索/分类列表页";
    }
    return "当前页面不支持";
  }

  const api = {
    isJdItemUrl,
    isJdListUrl,
    isJdSearchUrl: isJdListUrl,
    isTaobaoListUrl,
    isTaobaoItemUrl,
    isListUrl,
    detectPlatform,
    detectPageMode,
    pageModeLabel,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.JdPageUrl = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
