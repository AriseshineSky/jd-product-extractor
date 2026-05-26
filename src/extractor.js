/**
 * JD item page → ProductSource-shaped payload (vanilla JS).
 * Client-side checks mirror product-validator ProductSource / Variant rules.
 */
(function (global) {
  const SOURCE = "jd";

  function waitFor(getter, timeoutMs = 15000, intervalMs = 200) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        try {
          const value = getter();
          if (value !== undefined && value !== null) {
            resolve(value);
            return;
          }
        } catch (_) {
          /* page not ready */
        }
        if (Date.now() - start >= timeoutMs) {
          reject(new Error("Timed out waiting for page data"));
          return;
        }
        setTimeout(tick, intervalMs);
      };
      tick();
    });
  }

  function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
    const request = fetch(url, controller ? { ...options, signal: controller.signal } : options).finally(() => {
      if (timer) clearTimeout(timer);
    });
    if (controller) return request;
    return Promise.race([
      request,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  }

  function isoDateNow() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  function normalizeUrl(href) {
    if (!href) return location.href.split("#")[0];
    if (href.startsWith("//")) return "https:" + href;
    if (href.startsWith("http")) return href.split("#")[0];
    if (href.startsWith("/")) return location.origin + href;
    return location.href.split("#")[0];
  }

  function productIdFromUrl(url) {
    const m = String(url || location.href).match(/(\d+)\.html/);
    return m ? m[1] : null;
  }

  function productIdFromMeta() {
    const saveUrl = document.querySelector('meta[name="savepage-url"]')?.content;
    if (saveUrl) {
      const id = productIdFromUrl(saveUrl);
      if (id) return id;
    }
    const canonical = document.querySelector('link[rel="canonical"]')?.href;
    if (canonical) {
      const id = productIdFromUrl(canonical);
      if (id) return id;
    }
    return null;
  }

  function productCanonicalUrl() {
    const saveUrl = document.querySelector('meta[name="savepage-url"]')?.content;
    if (saveUrl && saveUrl.includes("item.jd.com")) {
      return normalizeUrl(saveUrl.split("?")[0]);
    }
    const skuId = productIdFromUrl() || productIdFromMeta();
    if (skuId) return `https://item.jd.com/${skuId}.html`;
    return normalizeUrl(null);
  }

  function isNewJdItemPage() {
    if (typeof pageConfig !== "undefined" && pageConfig.product) return false;
    return !!(
      document.getElementById("root") ||
      document.querySelector(".sku-title, .page-right-skuname, .specification-group")
    );
  }

  function normalizeImageSource(raw, skuId) {
    if (!raw || raw.startsWith("data:")) return null;
    if (raw.includes("base64")) return null;
    if (/^https?:\/\//i.test(raw)) return raw.split("?")[0];
    if (raw.startsWith("//")) return "https:" + raw.split("?")[0];
    return imageUrl(raw, skuId);
  }

  /** Stable key for dedup: same jfs asset across s228 / s1440 / n1 variants. */
  function imageCanonicalKey(url) {
    const match = String(url || "").match(/jfs\/(.+)$/i);
    return match ? `jfs/${match[1]}` : String(url || "");
  }

  function imageSizeScore(url) {
    const rules = [
      [/s1440x1440/i, 1000],
      [/s860x860/i, 900],
      [/\/n1\/jfs\//i, 850],
      [/\/n1\//i, 800],
      [/s480x480/i, 400],
      [/s228x228/i, 200],
      [/\/n2\//i, 150],
      [/s64x64/i, 30],
    ];
    for (const [pattern, score] of rules) {
      if (pattern.test(url)) return score;
    }
    return 100;
  }

  /** Upgrade JD CDN thumbnails to the largest common variant. */
  function upgradeJdImageUrl(url) {
    if (!url || !url.includes("360buyimg.com")) return url;
    let upgraded = url.split("?")[0];
    upgraded = upgraded.replace(/\/s\d+x\d+_jfs\//gi, "/s1440x1440_jfs/");
    upgraded = upgraded.replace(/\/n2\/s\d+x\d+_jfs\//gi, "/n1/jfs/");
    upgraded = upgraded.replace(/\/n2\/jfs\//gi, "/n1/jfs/");
    return upgraded;
  }

  function isProductGalleryImage(url) {
    if (!url || !url.includes("360buyimg.com")) return false;
    if (!/jfs\//i.test(url)) return false;
    if (/imgzone\/|popWareDetail|s64x64|imagetools\/jfs/i.test(url)) return false;
    return imageSizeScore(url) >= 100;
  }

  function dedupeAndPreferLargeImages(urls, skuId) {
    const byKey = new Map();
    let order = 0;

    for (const raw of urls) {
      const normalized = normalizeImageSource(raw, skuId);
      if (!normalized || !isProductGalleryImage(normalized)) continue;

      const url = upgradeJdImageUrl(normalized);
      const key = imageCanonicalKey(url);
      const score = imageSizeScore(url);
      const existing = byKey.get(key);

      if (!existing) {
        byKey.set(key, { url, order: order++, score });
        continue;
      }
      if (score > existing.score) {
        byKey.set(key, { url, order: existing.order, score });
      }
    }

    return [...byKey.values()].sort((a, b) => a.order - b.order).map((item) => item.url);
  }

  function collectImagesFromDom(skuId) {
    const rawUrls = [];
    const selectors =
      ".image-carousel img, .image-zoom-container img, .image-area img, #spec-img img, .spec-img img";
    document.querySelectorAll(selectors).forEach((img) => {
      for (const attr of [
        "data-savepage-src",
        "data-src",
        "data-lazy-img",
        "data-url",
        "data-origin",
        "src",
      ]) {
        const value = img.getAttribute(attr);
        if (value) rawUrls.push(value);
      }
    });

    document
      .querySelectorAll(
        ".image-carousel [data-savepage-src], .image-zoom-container [data-savepage-src], .image-area [data-savepage-src]"
      )
      .forEach((node) => {
        const value = node.getAttribute("data-savepage-src");
        if (value && value.includes("360buyimg")) rawUrls.push(value);
      });

    return dedupeAndPreferLargeImages(rawUrls, skuId);
  }

  function parseColorSizeFromDom(mainSkuId) {
    const groups = [...document.querySelectorAll(".specification-group")];
    if (!groups.length) return [];

    const bySku = new Map();
    groups.forEach((group) => {
      const label =
        group.querySelector(".specification-group-label")?.textContent?.trim() || "规格";
      group.querySelectorAll(".specification-item-sku").forEach((item) => {
        const sku = item.id || item.getAttribute("data-sku-id") || item.getAttribute("data-sku");
        const value = item.querySelector(".specification-item-sku-text")?.textContent?.trim();
        if (!value || value.includes("{") || value.length > 120) return;

        if (sku && /^\d+$/.test(String(sku))) {
          let row = bySku.get(sku);
          if (!row) {
            row = { skuId: String(sku) };
            bySku.set(sku, row);
          }
          row[label] = value;
        }
      });
    });

    const rows = [...bySku.values()];
    if (rows.length) return rows;

    if (!mainSkuId) return [];
    const selectedRow = { skuId: String(mainSkuId) };
    groups.forEach((group) => {
      const label =
        group.querySelector(".specification-group-label")?.textContent?.trim() || "规格";
      const selected = group.querySelector(".specification-item-sku--selected");
      const value = selected?.querySelector(".specification-item-sku-text")?.textContent?.trim();
      if (value) selectedRow[label] = value;
    });
    return [selectedRow];
  }

  function parseExistenceFromDom() {
    const buyArea = document.querySelector(".bottom-btns-root, .page-right-price, .product-price-panel");
    if (buyArea) {
      if (/无货|下架|商品已下柜|不在该地区销售/.test(buyArea.textContent || "")) return false;
      if (buyArea.querySelector(".disable, .btn-disable, [class*='sold-out'], [class*='no-stock']")) {
        return false;
      }
    }
    return true;
  }

  function cleanTitle(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/收藏$/, "")
      .trim();
  }

  function tryBuildProductFromDom() {
    if (!isNewJdItemPage()) return undefined;

    const skuId = productIdFromUrl() || productIdFromMeta();
    const title = cleanTitle(
      document.querySelector(".sku-title-text, .sku-title, .page-right-skuname")?.textContent ||
        document.title.split("【")[0] ||
        ""
    );
    if (!skuId && !title) return undefined;

    const images = collectImagesFromDom(skuId);
    return {
      skuid: skuId,
      skuId: skuId,
      name: title,
      href: productCanonicalUrl(),
      imageList: images,
      src: images[0] ? images[0].replace(/^https?:\/\/[^/]+\/n1\//, "").replace(/^https?:\/\/[^/]+\//, "") : null,
      colorSize: parseColorSizeFromDom(skuId),
      catName: [],
      warestatus: parseExistenceFromDom() ? 1 : 0,
      desc: null,
      isSelf: /\.crumb\b/.test(document.body?.innerHTML || "")
        ? [...document.querySelectorAll(".crumb a")].some((a) => /京东自营|自营/.test(a.textContent))
        : false,
    };
  }

  async function resolveProduct(options = {}) {
    const domReady = tryBuildProductFromDom();
    if (typeof pageConfig !== "undefined" && pageConfig.product) {
      return pageConfig.product;
    }
    if (domReady) return domReady;

    const timeoutMs =
      options.pageConfigTimeoutMs ||
      (isNewJdItemPage() ? 8000 : 15000);

    return waitFor(() => {
      if (typeof pageConfig !== "undefined" && pageConfig.product) return pageConfig.product;
      return tryBuildProductFromDom();
    }, timeoutMs);
  }

  function getImageHost(skuId) {
    if (typeof pageConfig !== "undefined" && typeof pageConfig.FN_GetImageDomain === "function") {
      const domain = pageConfig.FN_GetImageDomain(String(skuId));
      if (domain) return domain.startsWith("//") ? "https:" + domain.replace(/\/$/, "") : domain.replace(/\/$/, "");
    }
    const n = parseInt(String(skuId).slice(-1), 10);
    const bucket = Number.isNaN(n) ? 10 : 10 + (n % 5);
    return `https://img${bucket}.360buyimg.com`;
  }

  function imageUrl(path, skuId) {
    if (!path) return null;
    if (/^https?:\/\//i.test(path)) return path;
    const host = getImageHost(skuId);
    const clean = path.replace(/^\//, "");
    return `${host}/n1/${clean}`;
  }

  function buildImages(product) {
    const skuId = product.skuid || product.skuId;
    const paths = Array.isArray(product.imageList) && product.imageList.length
      ? product.imageList
      : product.src
        ? [product.src]
        : [];
    const combined = [
      ...paths.map((p) =>
        typeof p === "string" && /^https?:\/\//i.test(p) ? p : imageUrl(p, skuId)
      ),
      ...collectImagesFromDom(skuId),
    ];
    return dedupeAndPreferLargeImages(combined.filter(Boolean), skuId).join(";");
  }

  function uniqueCategories(parts) {
    const out = [];
    const seen = new Set();
    for (const raw of parts || []) {
      const name = String(raw || "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
    return out.length ? out.join(">") : null;
  }

  function breadcrumbCategories() {
    const links = [
      ...document.querySelectorAll("#crumb-wrap .item a, .crumb-wrap .item a, .crumb a"),
    ];
    return links.map((a) => a.textContent.trim()).filter(Boolean);
  }

  function buildCategories(product) {
    const fromCrumb = breadcrumbCategories();
    const fromConfig = Array.isArray(product.catName) ? product.catName : [];
    const brandCrumb = document.querySelector("#crumb-wrap .item:last-child, .crumb-wrap .item:last-child");
    const brandText = brandCrumb && !brandCrumb.querySelector("a") ? brandCrumb.textContent.trim() : "";
    const merged = [...fromConfig, ...fromCrumb];
    if (brandText) merged.push(brandText);
    return uniqueCategories(merged);
  }

  function stripAnchorTags(html) {
    return sanitizeDescriptionHtml(html);
  }

  function sanitizeDescriptionHtml(html) {
    if (!html) return "";
    const doc = new DOMParser().parseFromString(html, "text/html");

    doc.querySelectorAll("script, style, link, noscript, iframe").forEach((node) => node.remove());

    doc.querySelectorAll("*").forEach((el) => {
      el.removeAttribute("style");
      [...el.attributes].forEach((attr) => {
        if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
      });
    });

    doc.querySelectorAll("a").forEach((node) => {
      node.replaceWith(doc.createTextNode(node.textContent || ""));
    });

    doc.querySelectorAll("img").forEach((img) => {
      const raw =
        img.getAttribute("src") ||
        img.getAttribute("data-src") ||
        img.getAttribute("data-savepage-src");
      if (!raw || raw.startsWith("data:")) {
        img.remove();
        return;
      }
      let src = raw;
      if (src.startsWith("//")) src = "https:" + src;
      else if (src.startsWith("http://")) src = "https://" + src.slice(7);
      img.setAttribute("src", src.split("?")[0]);
      img.removeAttribute("style");
    });

    return doc.body.innerHTML.trim();
  }

  function parseDescriptionFromDom() {
    const selectors = [
      "#detail-main",
      "#J-detail-content",
      "#detail-content",
      ".detail-content-wrap",
      "#product-detail .ssd-module-wrap",
    ];
    const seen = new Set();
    const parts = [];

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((root) => {
        const html = sanitizeDescriptionHtml(root.innerHTML);
        if (!html || html.length < 20) return;
        const key = html.replace(/\s+/g, " ").slice(0, 800);
        if (seen.has(key)) return;
        seen.add(key);
        parts.push(html);
      });
      if (parts.length) break;
    }

    return parts.join("\n");
  }

  async function resolveDescription(product, title) {
    const domDesc = parseDescriptionFromDom();
    if (domDesc) return domDesc;

    try {
      const apiDesc = await fetchDescription(product);
      if (apiDesc?.trim()) return apiDesc;
    } catch (err) {
      console.warn("[jd-extractor] description failed:", err);
    }

    const fallback = document.querySelector(".product-desc, .desc-txt, #detail .content")?.innerHTML?.trim();
    if (fallback) return sanitizeDescriptionHtml(fallback);

    return title ? `<p>${title}</p>` : "";
  }

  function parseDescriptionResponse(raw) {
    if (!raw) return "";
    let payload = raw;
    try {
      payload = JSON.parse(raw);
    } catch (_) {
      return stripAnchorTags(raw);
    }
    const content = payload?.content || payload?.data?.content || "";
    return stripAnchorTags(content);
  }

  async function fetchDescription(product) {
    let descPath = product.desc;
    if (!descPath) return "";
    if (descPath.startsWith("//")) descPath = "https:" + descPath;
    if (!descPath.startsWith("http")) return "";

    const response = await fetchWithTimeout(descPath, { credentials: "include" });
    if (!response.ok) throw new Error(`Description API ${response.status}`);
    const text = await response.text();
    return parseDescriptionResponse(text);
  }

  function parseSpecificationsFromDom() {
    const rows = [];
    const tables = document.querySelectorAll(
      "#detail .Ptable tr, #product-detail .Ptable tr, .goods-base .item, .p-parameter-list li"
    );
    tables.forEach((row) => {
      const th = row.querySelector("th, .name, .label");
      const td = row.querySelector("td, .value, .text");
      if (th && td) {
        const name = th.textContent.replace(/[：:]\s*$/, "").trim();
        const value = td.textContent.trim();
        if (name && value) rows.push({ name, value });
        return;
      }
      const text = row.textContent.trim();
      const parts = text.split(/[：:]/);
      if (parts.length >= 2) {
        rows.push({ name: parts[0].trim(), value: parts.slice(1).join(":").trim() });
      }
    });
    return rows.length ? rows : null;
  }

  function parsePrice(value) {
    if (value === undefined || value === null || value === "") return null;
    const num = parseFloat(String(value).replace(/[^\d.]/g, ""));
    return Number.isFinite(num) ? num : null;
  }

  function parsePriceFromDom() {
    const selectors = [
      ".product-price--main .product-price--value",
      ".product-price-panel .product-price--value",
      ".page-right-price .price",
      ".p-price .price",
      "#J_FinalPrice",
      ".summary-price .price",
      ".finalPrice .price",
    ];
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        const text = (el.textContent || "").trim();
        if (!text || /\/件/.test(text)) continue;
        if (!/¥|￥/.test(text) && !selector.includes("product-price--value")) continue;
        const parsed = parsePrice(text);
        if (parsed !== null) return parsed;
      }
    }
    return null;
  }

  async function resolvePrice(product) {
    const direct = parsePrice(product.jp ?? product.price);
    if (direct !== null) return direct;

    const domPrice = parsePriceFromDom();
    if (domPrice !== null) return domPrice;

    const priceWaitMs = isNewJdItemPage() ? 4000 : 12000;
    return waitFor(() => {
      const p = typeof pageConfig !== "undefined" ? pageConfig.product : null;
      if (p) {
        const price = parsePrice(p.jp ?? p.price);
        if (price !== null) return price;
      }
      const parsed = parsePriceFromDom();
      if (parsed !== null) return parsed;
      return undefined;
    }, priceWaitMs).catch(() => parsePriceFromDom() ?? 0);
  }

  function optionNamesFromColorSize(colorSize) {
    if (!Array.isArray(colorSize) || !colorSize.length) return [];
    const keys = new Set();
    colorSize.forEach((row) => {
      Object.keys(row || {}).forEach((k) => {
        if (k !== "skuId") keys.add(k);
      });
    });
    return [...keys].map((name) => ({ name }));
  }

  function buildVariants(colorSize, mainSkuId, price, images) {
    if (!Array.isArray(colorSize) || !colorSize.length) return null;

    return colorSize.map((row) => {
      const sku = String(row.skuId || mainSkuId);
      const option_values = [];
      Object.keys(row).forEach((key) => {
        if (key === "skuId") return;
        option_values.push({
          option_name: key,
          option_value: String(row[key] ?? ""),
        });
      });
      return {
        sku,
        price,
        currency: "CNY",
        available_qty: null,
        barcode: null,
        variant_id: sku,
        option_values,
        images: images || null,
      };
    });
  }

  function parseReturnable(product) {
    const attrs = product.specialAttrs || [];
    const tag = attrs.find((a) => /^is7ToReturn-/.test(a));
    if (!tag) return null;
    return tag.endsWith("-1");
  }

  async function fetchCommentSummary(skuId) {
    const url = `https://club.jd.com/comment/productCommentSummaries.action?referenceIds=${skuId}`;
    try {
      const response = await fetchWithTimeout(url, { credentials: "include" }, 6000);
      const text = await response.text();
      const jsonText = text.replace(/^[^(]+\(|\);?\s*$/g, "");
      const data = JSON.parse(jsonText);
      const summary = Array.isArray(data.CommentsCount) ? data.CommentsCount[0] : data;
      return {
        reviews: summary?.CommentCount ?? summary?.commentCount ?? null,
        rating: summary?.AverageScore ?? summary?.averageScore ?? null,
        sold_count: summary?.GoodCount ?? null,
      };
    } catch (_) {
      return { reviews: null, rating: null, sold_count: null };
    }
  }

  function validateProductSourceShape(data) {
    const errors = [];
    if (data.date == null || data.date === "") errors.push("date is required");
    if (typeof data.url !== "string" || !data.url) errors.push("url is required");
    if (typeof data.source !== "string" || !data.source) errors.push("source is required");
    if (typeof data.existence !== "boolean") errors.push("existence must be boolean");
    if (data.url && !data.url.startsWith("https")) errors.push("url should start with https");
    if (data.description && /<a\s+[^>]*>/i.test(data.description)) {
      errors.push("description must not contain <a> tags");
    }
    if (data.images) {
      data.images.split(";").forEach((img, i) => {
        if (img && !img.startsWith("http")) errors.push(`images[${i}] must start with http`);
      });
    }
    if (data.categories) {
      const seen = new Set();
      data.categories.split(">").forEach((c) => {
        const name = c.trim();
        if (name && seen.has(name)) errors.push("category must be unique");
        if (name) seen.add(name);
      });
    }
    if (Array.isArray(data.specifications)) {
      data.specifications.forEach((spec, i) => {
        const extra = { ...spec };
        delete extra.name;
        delete extra.value;
        if (Object.keys(extra).length) errors.push(`specifications[${i}] must only contain name/value`);
      });
    }
    if (Array.isArray(data.variants)) {
      data.variants.forEach((variant, i) => {
        if (!variant.sku) errors.push(`variants[${i}].sku is required`);
        if (variant.price == null || Number.isNaN(variant.price)) errors.push(`variants[${i}].price is required`);
      });
    }
    return errors;
  }

  async function extractJdProduct(options = {}) {
    const product = await resolveProduct(options);

    const skuId = String(product.skuid || product.skuId || productIdFromUrl() || productIdFromMeta());
    const url = product.href ? normalizeUrl(product.href) : productCanonicalUrl();
    const title = cleanTitle(
      document.querySelector(".sku-name, .sku-title-text, .sku-title, .page-right-skuname")?.textContent ||
        product.name ||
        ""
    );
    const images = buildImages(product);
    const [description, price, commentSummary] = await Promise.all([
      resolveDescription(product, title),
      resolvePrice(product),
      fetchCommentSummary(skuId),
    ]);

    const colorSize = product.colorSize || [];
    const optionsList = optionNamesFromColorSize(colorSize);
    const variants = buildVariants(colorSize, skuId, price, images);
    const has_only_default_variant = !variants || variants.length <= 1;
    const mainSku = has_only_default_variant && variants?.length === 1 ? variants[0].sku : skuId;

    const payload = {
      date: isoDateNow(),
      url,
      source: SOURCE,
      sku: mainSku,
      price: price ?? 0,
      currency: "CNY",
      available_qty: product.stockSkuNum ?? null,
      images,
      product_id: skuId,
      existence: product.warestatus === 1,
      title,
      title_en: null,
      description,
      description_en: null,
      summary: product.tips?.map((t) => t.tip).filter(Boolean).join("；") || null,
      upc: null,
      brand:
        breadcrumbCategories().slice(-1)[0] ||
        (product.brandName ? String(product.brandName) : null),
      specifications: parseSpecificationsFromDom(),
      categories: buildCategories(product),
      videos: product.imageAndVideoJson?.mainVideoId
        ? `https://vod.jd.com/${product.imageAndVideoJson.mainVideoId}`
        : null,
      options: optionsList.length ? optionsList : null,
      variants,
      returnable: parseReturnable(product),
      reviews: commentSummary.reviews,
      rating: commentSummary.rating,
      sold_count: commentSummary.sold_count,
      shipping_fee: 0,
      shipping_days_min: product.isSelf ? 1 : 2,
      shipping_days_max: product.isSelf ? 3 : 7,
      weight: null,
      width: null,
      height: null,
      length: null,
      has_only_default_variant,
    };

    payload._validation_errors = validateProductSourceShape(payload);
    return payload;
  }

  const api = {
    extractJdProduct,
    validateProductSourceShape,
    tryBuildProductFromDom,
    isNewJdItemPage,
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.JdProductExtractor = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
