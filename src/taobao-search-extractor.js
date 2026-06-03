/**
 * Taobao/Tmall search page → ProductSource-shaped records (list-level fields).
 */
(function (global) {
  function isoDateNow() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  function parsePrice(value) {
    if (value === undefined || value === null || value === "") return null;
    const num = parseFloat(String(value).replace(/[^\d.]/g, ""));
    return Number.isFinite(num) ? num : null;
  }

  function parseSoldCount(text) {
    if (!text) return null;
    const raw = String(text).trim();
    const wan = raw.match(/([\d.]+)\s*万\+?/);
    if (wan) return Math.round(parseFloat(wan[1]) * 10000);
    const num = parseInt(raw.replace(/[^\d]/g, ""), 10);
    return Number.isFinite(num) ? num : null;
  }

  function searchKeywordFromUrl(url) {
    try {
      const params = new URLSearchParams(new URL(url || location.href).search);
      return params.get("q") || params.get("keyword") || null;
    } catch (_) {
      return null;
    }
  }

  function searchTabFromUrl(url) {
    try {
      return new URLSearchParams(new URL(url || location.href).search).get("tab") || null;
    } catch (_) {
      return null;
    }
  }

  function itemIdFromHref(href) {
    if (!href) return null;
    let h = String(href).trim();
    if (!h || h === "#" || /^javascript:/i.test(h)) return null;
    if (h.startsWith("//")) h = "https:" + h;
    try {
      const u = new URL(h, "https://s.taobao.com/");
      const id = u.searchParams.get("id");
      if (id && /^\d+$/.test(id)) return id;
    } catch (_) {
      /* ignore */
    }
    const m = h.match(/[?&]id=(\d+)/);
    return m ? m[1] : null;
  }

  function isTmallHref(href) {
    return /detail\.tmall\.com|tmall\.com\/item/i.test(String(href || ""));
  }

  function itemUrlFromId(id, isTmall) {
    if (!id) return null;
    return isTmall
      ? `https://detail.tmall.com/item.htm?id=${id}`
      : `https://item.taobao.com/item.htm?id=${id}`;
  }

  function sourceFromCard(card, href) {
    if (isTmallHref(href)) return "tmall";
    if (/item\.taobao\.com/i.test(String(href || ""))) return "taobao";
    if (card?.getAttribute("data-name") === "itemNT") return "tmall";
    const tab = searchTabFromUrl();
    if (tab === "mall") return "tmall";
    return "taobao";
  }

  function normalizeImageUrl(raw) {
    if (!raw || raw.startsWith("data:")) return null;
    let url = raw.split("?")[0];
    if (url.startsWith("//")) url = "https:" + url;
    else if (url.startsWith("http://")) url = "https://" + url.slice(7);
    if (!/alicdn\.com|tbcdn\.cn/i.test(url)) return null;
    return url;
  }

  function findProductLinkInCard(card) {
    if (!card) return null;
    const selectors = [
      'a[href*="detail.tmall.com"]',
      'a[href*="item.taobao.com"]',
      'a[href*="item.htm"]',
      "a[href]",
    ];
    for (const sel of selectors) {
      for (const a of card.querySelectorAll(sel)) {
        const raw = a.getAttribute("href") || a.href;
        if (itemIdFromHref(raw)) return a;
      }
    }
    return null;
  }

  function cardItemId(card) {
    const link = findProductLinkInCard(card);
    const href = link?.getAttribute("href") || link?.href;
    return itemIdFromHref(href);
  }

  function findSearchCards() {
    const seen = new Set();
    const cards = [];
    const selectors = ['div[data-name="item"]', 'div[data-name="itemNT"]'];

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((node) => {
        const id = cardItemId(node);
        if (!id || seen.has(id)) return;
        seen.add(id);
        cards.push(node);
      });
    }

    return cards;
  }

  function pickTitle(root) {
    const titleEl = root.querySelector('[class*="title"] span[title], [class*="title--"] span[title]');
    const fromAttr = titleEl?.getAttribute("title")?.trim();
    if (fromAttr) return fromAttr.replace(/\s+/g, " ").trim();

    const titleSpan = root.querySelector('[class*="title"] span, [class*="Title"] span');
    const text = titleSpan?.textContent?.replace(/\s+/g, " ").trim();
    if (text) return text.replace(/^天猫\s*/, "").trim();

    for (const el of root.querySelectorAll("[title]")) {
      const value = el.getAttribute("title")?.trim();
      if (value && value.length > 8 && value.length < 400) {
        return value.replace(/\s+/g, " ").trim();
      }
    }

    const imgAlt = root.querySelector("img[alt]")?.getAttribute("alt")?.trim();
    return imgAlt || "";
  }

  function pickPrice(root) {
    const priceInt = root.querySelector('[class*="priceInt"]');
    const priceFloat = root.querySelector('[class*="priceFloat"]');
    if (priceInt) {
      const whole = (priceInt.textContent || "").replace(/[^\d]/g, "");
      const frac = (priceFloat?.textContent || "").replace(/[^\d]/g, "") || "0";
      const combined = `${whole}.${frac.padEnd(2, "0").slice(0, 2)}`;
      const parsed = parsePrice(combined);
      if (parsed !== null) return parsed;
    }

    const wrapper = root.querySelector('[class*="priceWrapper"], [class*="Price--"]');
    if (wrapper) {
      const match = wrapper.textContent.match(/[¥￥]\s*([\d,.]+)/);
      if (match) return parsePrice(match[1]);
    }

    const match = root.textContent.match(/[¥￥]\s*([\d,.]+)/);
    return match ? parsePrice(match[1]) : null;
  }

  function pickImage(root) {
    const img = root.querySelector("img[data-src], img[src]");
    if (!img) return null;
    const raw = img.getAttribute("data-src") || img.getAttribute("src");
    return normalizeImageUrl(raw);
  }

  function pickShop(root) {
    const shopEl = root.querySelector('[class*="shopNameText"], [class*="shopName"]');
    const shopText = shopEl?.textContent?.trim();
    if (shopText && shopText.length < 80) return shopText;
    return null;
  }

  function pickSoldCount(root) {
    const salesEl = root.querySelector('[class*="realSales"], [class*="salesText"]');
    if (salesEl) return parseSoldCount(salesEl.textContent);
    const textMatch = root.textContent.match(/([\d.]+万?\+?)\s*人付款/);
    return textMatch ? parseSoldCount(textMatch[1]) : null;
  }

  function pickLocation(root) {
    const locEl = root.querySelector('[class*="procity"], [class*="location"]');
    const text = locEl?.textContent?.trim();
    return text && text.length < 40 ? text : null;
  }

  function validateProductSourceShape(data) {
    if (global.JdProductExtractor?.validateProductSourceShape) {
      return global.JdProductExtractor.validateProductSourceShape(data);
    }
    const errors = [];
    if (!data.url) errors.push("url is required");
    if (!data.title) errors.push("title is required");
    if (data.price == null || Number.isNaN(data.price)) errors.push("price is required");
    return errors;
  }

  function parseSearchCard(card, context) {
    const link = findProductLinkInCard(card);
    const href = link?.getAttribute("href") || link?.href;
    const id = itemIdFromHref(href);
    if (!id) return null;

    const isTmall = sourceFromCard(card, href) === "tmall";
    const title = pickTitle(card);
    if (!title) return null;

    const price = pickPrice(card);
    const image = pickImage(card);
    const shop = pickShop(card);
    const soldCount = pickSoldCount(card);
    const location = pickLocation(card);
    const source = isTmall ? "tmall" : "taobao";

    const summaryParts = [shop, location].filter(Boolean);

    const payload = {
      date: isoDateNow(),
      url: itemUrlFromId(id, isTmall),
      source,
      sku: id,
      price: price ?? 0,
      currency: "CNY",
      available_qty: null,
      images: image || null,
      product_id: id,
      existence: true,
      title,
      title_en: null,
      description: null,
      description_en: null,
      summary: summaryParts.length ? summaryParts.join("；") : null,
      upc: null,
      brand: shop?.replace(/官方旗舰店|旗舰店|专营店|专卖店/g, "").trim() || null,
      specifications: null,
      categories: context.keyword || null,
      videos: null,
      options: null,
      variants: null,
      returnable: null,
      reviews: null,
      rating: null,
      sold_count: soldCount,
      shipping_fee: 0,
      shipping_days_min: 2,
      shipping_days_max: 7,
      weight: null,
      width: null,
      height: null,
      length: null,
      has_only_default_variant: true,
      search_keyword: context.keyword || null,
      search_page: context.page || null,
      shop_name: shop || null,
    };

    payload._validation_errors = validateProductSourceShape(payload);
    return payload;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function humanScrollPage(options = {}) {
    if (options.scroll === false) return;
    const api = global.JdHumanScroll;
    if (!api?.scrollPageToBottom) {
      throw new Error("滚动模块未加载，请刷新页面后重试");
    }
    await api.scrollPageToBottom({
      maxRounds: options.scrollMaxRounds ?? 18,
      pauseMinMs: options.pauseMinMs ?? 100,
      pauseMaxMs: options.pauseMaxMs ?? 420,
      shouldContinue: options.shouldContinue,
      ...(options.scroll || {}),
    });
    await sleep(options.afterScrollMs ?? 350);
  }

  function findNextPageButton() {
    for (const el of document.querySelectorAll("button, a")) {
      const text = el.textContent?.trim() || "";
      const aria = el.getAttribute("aria-label") || "";
      if (text !== "下一页" && !aria.includes("下一页")) continue;
      if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;
      if (el.closest('[class*="disabled"]')) continue;
      return el;
    }
    return null;
  }

  function isNextPageAvailable() {
    const btn = findNextPageButton();
    if (!btn) return false;
    const style = window.getComputedStyle?.(btn);
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
    return true;
  }

  async function clickNextPage() {
    const btn = findNextPageButton();
    if (!btn) throw new Error("未找到「下一页」按钮");

    if (global.JdHumanMouse?.humanClick) {
      await global.JdHumanMouse.humanClick(btn, {
        move: { easing: global.JdHumanMouse.EASINGS?.read },
      });
      return;
    }

    btn.scrollIntoView({ block: "center", behavior: "instant" });
    btn.click();
  }

  async function waitForNewSearchResults(previousIds, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await sleep(400);
      const ids = findSearchCards().map((c) => cardItemId(c)).filter(Boolean);
      if (ids.some((id) => !previousIds.has(id))) return true;
    }
    return false;
  }

  async function collectUrlsFromSearchPage(options = {}) {
    await humanScrollPage(options);

    const keyword = options.keyword || searchKeywordFromUrl();
    const page = options.page || new URLSearchParams(location.search).get("page") || "1";
    const entries = [];
    const seen = new Set();

    findSearchCards().forEach((card) => {
      const link = findProductLinkInCard(card);
      const href = link?.getAttribute("href") || link?.href;
      const id = itemIdFromHref(href);
      if (!id || seen.has(id)) return;
      seen.add(id);
      const isTmall = sourceFromCard(card, href) === "tmall";
      entries.push({
        url: itemUrlFromId(id, isTmall),
        sku: id,
        title: pickTitle(card) || null,
        search_keyword: keyword,
        search_page: String(page),
        collected_at: isoDateNow(),
      });
    });

    if (!entries.length) {
      throw new Error("未找到可缓存的商品链接，请确认搜索页已加载完成");
    }

    return { keyword, page, count: entries.length, urls: entries };
  }

  async function collectSearchUrlsMultiPage(options = {}) {
    const maxPages = Math.min(Math.max(1, Number(options.maxPages) || 1), 50);
    const delayMs = Number(options.delayMs) || 2000;
    const keyword = options.keyword || searchKeywordFromUrl();
    const allUrls = [];
    const seenIds = new Set();
    let pagesDone = 0;

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      if (options.onPageCheckpoint) await options.onPageCheckpoint(pageNum);

      const batch = await collectUrlsFromSearchPage({
        ...options,
        keyword,
        page: String(pageNum),
      });
      for (const entry of batch.urls) {
        if (seenIds.has(entry.sku)) continue;
        seenIds.add(entry.sku);
        allUrls.push(entry);
      }
      pagesDone = pageNum;

      if (pageNum >= maxPages) break;
      if (!isNextPageAvailable()) break;

      const idsBefore = new Set(seenIds);
      await clickNextPage();
      const updated = await waitForNewSearchResults(idsBefore, 15000);
      if (!updated) break;
      await sleep(delayMs);
    }

    return {
      keyword,
      page: `1-${pagesDone}`,
      pages: pagesDone,
      count: allUrls.length,
      urls: allUrls,
    };
  }

  async function extractTaobaoSearchProductsMultiPage(options = {}) {
    const maxPages = Math.min(Math.max(1, Number(options.maxPages) || 1), 50);
    const delayMs = Number(options.delayMs) || 2000;
    const keyword = options.keyword || searchKeywordFromUrl();
    const allProducts = [];
    const seenIds = new Set();
    let pagesDone = 0;

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const result = await extractTaobaoSearchProducts({
        ...options,
        keyword,
        page: String(pageNum),
      });
      for (const item of result.products) {
        const id = String(item.sku || item.product_id || "");
        if (id && seenIds.has(id)) continue;
        if (id) seenIds.add(id);
        allProducts.push(item);
      }
      pagesDone = pageNum;

      if (pageNum >= maxPages) break;
      if (!isNextPageAvailable()) break;

      const idsBefore = new Set(seenIds);
      await clickNextPage();
      const updated = await waitForNewSearchResults(idsBefore, 15000);
      if (!updated) break;
      await sleep(delayMs);
    }

    if (!allProducts.length) {
      throw new Error("未能解析任何商品，请确认搜索页已加载完成");
    }

    return {
      keyword,
      page: `1-${pagesDone}`,
      pages: pagesDone,
      count: allProducts.length,
      products: allProducts,
      _errors: [],
    };
  }

  async function extractTaobaoSearchProducts(options = {}) {
    await humanScrollPage(options);

    const cards = findSearchCards();
    if (!cards.length) {
      throw new Error("未找到搜索结果商品，请确认页面已加载完成（需出现商品卡片）");
    }

    const context = {
      keyword: options.keyword || searchKeywordFromUrl(),
      page: options.page || new URLSearchParams(location.search).get("page") || "1",
    };

    const products = [];
    const errors = [];

    cards.forEach((card, index) => {
      try {
        const item = parseSearchCard(card, context);
        if (item) products.push(item);
      } catch (error) {
        errors.push(`#${index + 1}: ${error.message || error}`);
      }
    });

    if (!products.length) {
      throw new Error("未能解析任何商品，请尝试滚动页面加载更多结果后重试");
    }

    return {
      keyword: context.keyword,
      page: context.page,
      count: products.length,
      products,
      _errors: errors,
    };
  }

  const api = {
    extractTaobaoSearchProducts,
    extractTaobaoSearchProductsMultiPage,
    collectUrlsFromSearchPage,
    collectSearchUrlsMultiPage,
    humanScrollPage,
    findSearchCards,
    findProductLinkInCard,
    findNextPageButton,
    isNextPageAvailable,
    clickNextPage,
    waitForNewSearchResults,
    itemUrlFromId,
    itemIdFromHref,
    searchKeywordFromUrl,
    cardItemId,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.TaobaoSearchExtractor = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
