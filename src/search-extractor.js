/**
 * JD search/list page → ProductSource-shaped records (list-level fields).
 */
(function (global) {
  const SOURCE = "jd";

  function isoDateNow() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  function parsePrice(value) {
    if (value === undefined || value === null || value === "") return null;
    const num = parseFloat(String(value).replace(/[^\d.]/g, ""));
    return Number.isFinite(num) ? num : null;
  }

  function parseReviewCount(text) {
    if (!text) return null;
    const raw = String(text).trim();
    const wan = raw.match(/([\d.]+)\s*万/);
    if (wan) return Math.round(parseFloat(wan[1]) * 10000);
    const num = parseInt(raw.replace(/[^\d]/g, ""), 10);
    return Number.isFinite(num) ? num : null;
  }

  function searchKeywordFromUrl(url) {
    try {
      const params = new URLSearchParams(new URL(url || location.href).search);
      return params.get("keyword") || params.get("wq") || params.get("ev") || null;
    } catch (_) {
      return null;
    }
  }

  function itemUrlFromSku(sku) {
    return `https://item.jd.com/${sku}.html`;
  }

  function normalizeImageUrl(raw) {
    if (!raw || raw.startsWith("data:")) return null;
    let url = raw.split("?")[0];
    if (url.startsWith("//")) url = "https:" + url;
    else if (url.startsWith("http://")) url = "https://" + url.slice(7);
    if (!url.includes("360buyimg.com")) return null;
    url = url.replace(/\/n2\/s\d+x\d+_jfs\//gi, "/n1/jfs/");
    url = url.replace(/\/s\d+x\d+_jfs\//gi, "/s1440x1440_jfs/");
    return url;
  }

  function itemUrlFromSku(sku) {
    return `https://item.jd.com/${sku}.html`;
  }

  function skuFromProductHref(href) {
    if (!href) return null;
    let h = String(href).trim();
    if (!h || h === "#" || /^javascript:/i.test(h)) return null;
    if (h.startsWith("//")) h = "https:" + h;

    const direct = h.match(/item\.(jd|jkcsjd|yiyaojd|jingxi)\.com\/(\d+)\.html/i);
    if (direct) return direct[2];

    const mobile = h.match(/item\.m\.jd\.com\/product\/(\d+)/i);
    if (mobile) return mobile[1];

    try {
      const u = new URL(h, "https://search.jd.com/");
      const fromQuery =
        u.searchParams.get("sku") ||
        u.searchParams.get("skuId") ||
        u.searchParams.get("wareId") ||
        u.searchParams.get("pid");
      if (fromQuery && /^\d{6,}$/.test(fromQuery)) return fromQuery;
      const fromPath = u.pathname.match(/\/(\d{6,})(?:\.html)?(?:\/|$)/);
      if (fromPath) return fromPath[1];
    } catch (_) {
      /* ignore malformed href */
    }
    return null;
  }

  function findBestClickableSubElement(card) {
    if (!card) return null;
    const selectors = [
      '[class*="goodsName"]',
      '[class*="goods-name"]',
      '[class*="GoodsName"]',
      '[class*="_card_"]',
      '[class*="bannerPic"]',
      '[class*="picBox"]',
      '[class*="title"]',
      ".p-name",
      ".p-img",
      "[title]",
      "img",
    ];
    for (const sel of selectors) {
      const el = card.querySelector(sel);
      if (el) return el;
    }
    return card;
  }

  function ensureProxyProductAnchor(container, url) {
    if (!container || !url) return null;
    let anchor = container.querySelector(':scope > a[data-jd-extractor-proxy="1"]');
    if (!anchor) {
      anchor = document.createElement("a");
      anchor.setAttribute("data-jd-extractor-proxy", "1");
      anchor.setAttribute("aria-hidden", "true");
      anchor.tabIndex = -1;
      anchor.style.cssText =
        "position:absolute;left:0;top:0;width:100%;height:100%;z-index:9999;opacity:0.01;cursor:pointer;background:transparent;";
      const pos = getComputedStyle(container).position;
      if (pos === "static") container.style.position = "relative";
      container.appendChild(anchor);
    }
    anchor.href = url;
    return anchor;
  }

  function findProductLinkInCard(card) {
    if (!card) return null;
    const sku = card.getAttribute("data-sku");
    const itemUrl = sku && /^\d{6,}$/.test(sku) ? itemUrlFromSku(sku) : null;

    const selectors = [
      'a[href*="item.jd.com"]',
      'a[href*="item.jkcsjd.com"]',
      'a[href*="item.yiyaojd.com"]',
      'a[href*="item.jingxi.com"]',
      'a[href*="item.m.jd.com"]',
      ".p-name a",
      '[class*="goodsName"] a',
      '[class*="title"] a',
      "a[href]",
    ];
    for (const sel of selectors) {
      for (const a of card.querySelectorAll(sel)) {
        const raw = a.getAttribute("href") || a.href;
        const resolvedSku = skuFromProductHref(raw);
        if (!resolvedSku) continue;
        const url = itemUrlFromSku(resolvedSku);
        try {
          a.href = url;
        } catch (_) {
          /* read-only href in some nodes */
        }
        return a;
      }
    }

    for (const el of card.querySelectorAll("[data-href], [data-url], [data-link]")) {
      const raw =
        el.getAttribute("data-href") ||
        el.getAttribute("data-url") ||
        el.getAttribute("data-link");
      const resolvedSku = skuFromProductHref(raw);
      if (resolvedSku) {
        return ensureProxyProductAnchor(findBestClickableSubElement(card), itemUrlFromSku(resolvedSku));
      }
    }

    if (itemUrl) {
      return ensureProxyProductAnchor(findBestClickableSubElement(card), itemUrl);
    }

    return null;
  }

  function findSearchCards() {
    const seen = new Set();
    const cards = [];

    const selectors = [
      "[data-sku].plugin_goodsCardWrapper",
      "li.gl-item[data-sku]",
      "#J_goodsList li[data-sku]",
      "#plist li[data-sku]",
      ".plugin_goodsContainer [data-sku]",
    ];

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((node) => {
        const sku = node.getAttribute("data-sku");
        if (!sku || !/^\d{6,}$/.test(sku) || seen.has(sku)) return;
        seen.add(sku);
        cards.push(node);
      });
      if (cards.length) break;
    }

    return cards;
  }

  function pickTitle(root) {
    let title = "";
    root.querySelectorAll("[title]").forEach((el) => {
      const value = el.getAttribute("title")?.trim();
      if (value && value.length > title.length && value.length < 400) title = value;
    });
    if (title) return title.replace(/\s+/g, " ").trim();

    const em = root.querySelector(".p-name em, .p-name a, [class*='goodsName'], [class*='_name']");
    return (em?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function pickPrice(root) {
    const priceEl = root.querySelector(".p-price i, .p-price strong i, [class*='price'] i, [class*='Price']");
    const fromEl = parsePrice(priceEl?.textContent);
    if (fromEl !== null) return fromEl;

    const match = root.textContent.match(/[¥￥]\s*([\d,.]+)/);
    return match ? parsePrice(match[1]) : null;
  }

  function pickImage(root) {
    const img = root.querySelector("img[data-src], img[data-lazy-img], img[data-savepage-src], img[src]");
    if (!img) return null;
    const raw =
      img.getAttribute("data-savepage-src") ||
      img.getAttribute("data-src") ||
      img.getAttribute("data-lazy-img") ||
      img.getAttribute("src");
    return normalizeImageUrl(raw);
  }

  function pickShop(root) {
    const shopEl = root.querySelector(".p-shop a, .p-shop span, [class*='shop'] a, [class*='Shop'] a");
    const shopText = shopEl?.textContent?.trim();
    if (shopText && shopText.length < 80) return shopText;

    const matches = [
      ...root.textContent.matchAll(
        /([\u4e00-\u9fa5][\u4e00-\u9fa5A-Za-z0-9（）()]*(?:官方旗舰店|旗舰店|专营店|专卖店|京东自营))/g
      ),
    ];
    return matches.length ? matches[matches.length - 1][1].trim() : null;
  }

  function pickReviews(root) {
    const html = root.innerHTML || "";
    const fromUrl = html.match(/commentNum=(\d+)/i);
    if (fromUrl) return parseInt(fromUrl[1], 10);

    const commit = root.querySelector(".p-commit strong, [class*='comment'], [class*='Comment']");
    if (commit) return parseReviewCount(commit.textContent);

    const textMatch = root.textContent.match(/([\d.]+万?\+?)\s*条?\s*评价/);
    if (textMatch) return parseReviewCount(textMatch[1]);

    return null;
  }

  function pickTags(root) {
    const tags = [];
    const text = root.textContent || "";
    if (/自营/.test(text)) tags.push("自营");
    if (/京东物流/.test(text)) tags.push("京东物流");
    if (/百亿补贴|Plus|秒杀|券/.test(text)) {
      const promo = text.match(/(百亿补贴|Plus价|秒杀|领券[^，,\s]{0,12})/);
      if (promo) tags.push(promo[1]);
    }
    return tags;
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
    const sku = card.getAttribute("data-sku");
    if (!sku || !/^\d{6,}$/.test(sku)) return null;

    const title = pickTitle(card);
    if (!title) return null;

    const price = pickPrice(card);
    const image = pickImage(card);
    const shop = pickShop(card);
    const reviews = pickReviews(card);
    const tags = pickTags(card);

    const summaryParts = [shop, ...tags].filter(Boolean);

    const payload = {
      date: isoDateNow(),
      url: itemUrlFromSku(sku),
      source: SOURCE,
      sku,
      price: price ?? 0,
      currency: "CNY",
      available_qty: null,
      images: image || null,
      product_id: sku,
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
      reviews,
      rating: null,
      sold_count: null,
      shipping_fee: 0,
      shipping_days_min: tags.includes("京东物流") || tags.includes("自营") ? 1 : 2,
      shipping_days_max: tags.includes("京东物流") || tags.includes("自营") ? 3 : 7,
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

  /** 贝塞尔分段滚动，加载懒加载商品 / 详情区域 */
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
    const byClass = document.querySelector(
      '[class*="pagination_next"], ._pagination_next_, .pn-next, a.next'
    );
    if (byClass && byClass.textContent?.includes("下一页")) return byClass;

    for (const el of document.querySelectorAll("a, button, div, span")) {
      const text = el.textContent?.trim();
      if (text !== "下一页") continue;
      if (el.closest('[class*="disabled"]')) continue;
      if (el.classList.contains("disabled")) continue;
      if (el.getAttribute("aria-disabled") === "true") continue;
      return el;
    }
    return null;
  }

  function isNextPageAvailable() {
    const btn = findNextPageButton();
    if (!btn) return false;
    const style = window.getComputedStyle?.(btn);
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
    if (btn.classList.contains("disabled")) return false;
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

  async function waitForNewSearchResults(previousSkus, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await sleep(400);
      const cards = findSearchCards();
      const skus = cards.map((c) => c.getAttribute("data-sku")).filter(Boolean);
      if (skus.some((sku) => !previousSkus.has(sku))) return true;
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
      const sku = card.getAttribute("data-sku");
      if (!sku || !/^\d{6,}$/.test(sku) || seen.has(sku)) return;
      seen.add(sku);
      entries.push({
        url: itemUrlFromSku(sku),
        sku,
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
    const seenSkus = new Set();
    let pagesDone = 0;

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      if (options.onPageCheckpoint) await options.onPageCheckpoint(pageNum);

      const batch = await collectUrlsFromSearchPage({
        ...options,
        keyword,
        page: String(pageNum),
      });
      for (const entry of batch.urls) {
        if (seenSkus.has(entry.sku)) continue;
        seenSkus.add(entry.sku);
        allUrls.push(entry);
      }
      pagesDone = pageNum;

      if (pageNum >= maxPages) break;
      if (!isNextPageAvailable()) break;

      if (options.onPageCheckpoint) await options.onPageCheckpoint(pageNum);

      const skusBefore = new Set(seenSkus);
      await clickNextPage();
      const updated = await waitForNewSearchResults(skusBefore, 15000);
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

  async function extractJdSearchProductsMultiPage(options = {}) {
    const maxPages = Math.min(Math.max(1, Number(options.maxPages) || 1), 50);
    const delayMs = Number(options.delayMs) || 2000;
    const keyword = options.keyword || searchKeywordFromUrl();
    const allProducts = [];
    const seenSkus = new Set();
    let pagesDone = 0;

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const result = await extractJdSearchProducts({ ...options, keyword, page: String(pageNum) });
      for (const item of result.products) {
        const sku = String(item.sku || item.product_id || "");
        if (sku && seenSkus.has(sku)) continue;
        if (sku) seenSkus.add(sku);
        allProducts.push(item);
      }
      pagesDone = pageNum;

      if (pageNum >= maxPages) break;
      if (!isNextPageAvailable()) break;

      const skusBefore = new Set(seenSkus);
      await clickNextPage();
      const updated = await waitForNewSearchResults(skusBefore, 15000);
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

  async function extractJdSearchProducts(options = {}) {
    await humanScrollPage(options);

    const cards = findSearchCards();
    if (!cards.length) {
      throw new Error("未找到搜索结果商品，请确认页面已加载完成（需出现商品卡片 data-sku）");
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

  function attachCardClickIsolation(card, anchor) {
    if (!card || !anchor) return () => {};
    const stop = (e) => {
      if (e.target === anchor || anchor.contains?.(e.target)) {
        e.stopPropagation();
      }
    };
    card.addEventListener("click", stop, true);
    card.addEventListener("mousedown", stop, true);
    return () => {
      card.removeEventListener("click", stop, true);
      card.removeEventListener("mousedown", stop, true);
    };
  }

  /** 滚到商品卡片 → 悬停 → 点击打开详情（模拟真实用户） */
  async function humanPrepareAndClickProduct(card, link, options = {}) {
    if (!card) throw new Error("未找到商品卡片");

    const sku = card.getAttribute("data-sku");
    const targetLink = link || findProductLinkInCard(card);
    if (!targetLink) {
      if (sku && /^\d{6,}$/.test(sku)) {
        throw new Error(`未找到商品链接（sku=${sku}）`);
      }
      throw new Error("未找到商品链接");
    }

    const mouse = global.JdHumanMouse;
    const scroll = global.JdHumanScroll;
    if (!mouse?.humanClick) throw new Error("鼠标模拟模块未加载，请刷新页面后重试");

    if (scroll?.scrollElementIntoViewHuman) {
      await scroll.scrollElementIntoViewHuman(card, options.scroll || {});
    } else {
      card.scrollIntoView({ block: "center", behavior: "instant" });
      await sleep(options.afterScrollMs ?? 320);
    }

    const openUrl =
      targetLink.href ||
      (sku && /^\d{6,}$/.test(sku) ? itemUrlFromSku(sku) : null);

    const releaseIsolation = attachCardClickIsolation(card, targetLink);
    try {
      if (options.mode === "same_tab") {
        if (mouse.humanHover) await mouse.humanHover(targetLink, options.hover || {});
        await mouse.humanClick(targetLink, { ...options.click, skipNativeClick: true });
        return { url: openUrl, mode: "same_tab" };
      }

      if (mouse.humanClickOpenInNewTab) {
        const result = await mouse.humanClickOpenInNewTab(targetLink, options.click || {});
        return { ...result, url: openUrl || result.url };
      }

      await mouse.humanClick(targetLink, { ...options.click, skipNativeClick: true });
      return { url: openUrl, mode: "same_tab" };
    } finally {
      releaseIsolation();
    }
  }

  const api = {
    extractJdSearchProducts,
    extractJdSearchProductsMultiPage,
    collectUrlsFromSearchPage,
    collectSearchUrlsMultiPage,
    humanScrollPage,
    humanPrepareAndClickProduct,
    findSearchCards,
    findProductLinkInCard,
    findNextPageButton,
    isNextPageAvailable,
    clickNextPage,
    waitForNewSearchResults,
    itemUrlFromSku,
    searchKeywordFromUrl,
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.JdSearchExtractor = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
