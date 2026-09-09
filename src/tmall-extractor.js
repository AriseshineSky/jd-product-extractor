/**
 * Tmall/Taobao item page → ProductSource-shaped payload (vanilla JS).
 * Mirrors extractor.js conventions; targets the tbpc SSR layout
 * (detail.tmall.com/item.htm), with loose fallbacks for classic layouts.
 */
(function (global) {
  const SOURCE = "tmall";

  function queryAll(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function textOf(el) {
    return (el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  /** 真实图片地址：线上页面 src 为 CDN；保存网页时 src 是 data:，真实地址在 data-savepage-* */
  function imageSource(img) {
    for (const attr of ["src", "data-savepage-currentsrc", "data-savepage-src", "data-lazy-src", "data-src"]) {
      const raw = img?.getAttribute(attr);
      if (!raw) continue;
      if (/^https?:/i.test(raw)) return raw.split("?")[0];
      if (raw.startsWith("//")) return "https:" + raw.split("?")[0];
    }
    return null;
  }

  function productIdFromUrl(url) {
    try {
      return new URL(url).searchParams.get("id");
    } catch (_) {
      return null;
    }
  }

  function productCanonicalUrl() {
    const saveUrl = document.querySelector('meta[name="savepage-url"]')?.content;
    const id = saveUrl ? productIdFromUrl(saveUrl) : null;
    if (!id) {
      const link = document.querySelector('link[rel="canonical"]')?.href;
      const id2 = productIdFromUrl(link || location.href);
      return id2 ? `https://detail.tmall.com/item.htm?id=${id2}` : location.href.split("#")[0].split("?")[0];
    }
    return `https://detail.tmall.com/item.htm?id=${id}`;
  }

  function parsePrice(text) {
    if (text == null) return null;
    const match = String(text).match(/(\d+(?:\.\d{1,2})?)/);
    return match ? Number(match[1]) : null;
  }

  function cleanTitle(title) {
    return String(title || "").replace(/\s+/g, " ").trim();
  }

  function resolveTitle() {
    const primary = document.querySelector('[class*="mainTitle--"]');
    const fromAttr = primary?.getAttribute("title");
    const fromText = textOf(primary);
    const title = fromAttr || fromText;
    if (title) return cleanTitle(title);
    return cleanTitle(textOf(document.querySelector("#J_Title h3, .tb-detail-hd h1, [class*='ItemTitle'] [class*='MainTitle']")));
  }

  function resolvePrice() {
    const highlight = document.querySelector('[class*="highlightPrice--"]');
    if (highlight) {
      const parsed = parsePrice(textOf(highlight));
      if (parsed !== null) return parsed;
    }
    for (const selector of ["#J_StrPrice", ".tm-price", "#J_PromoPrice"]) {
      const parsed = parsePrice(textOf(document.querySelector(selector)));
      if (parsed !== null) return parsed;
    }
    return null;
  }

  function panelText() {
    return textOf(
      document.getElementById("SkuPanel_tbpcDetail_ssr2025") ||
        document.getElementById("right-content-area") ||
        document.querySelector("#J_ItemInfo, .tb-detail")
    );
  }

  function parseSoldCount() {
    const match = panelText().match(/已售\s*(\d+)(?:\s*[+万]|万)?/);
    if (!match) return null;
    return match[2] === "万" ? Number(match[1]) * 10000 : Number(match[1]);
  }

  function parseShippingDays() {
    const text = panelText();
    let min = null;
    let max = null;
    const tonightaday = /预计\s*(?:今天|明天|后天)/.test(text);
    const hour48 = /承诺\s*48小时|48小时内发货/.test(text);
    const hour24 = /承诺\s*24小时/.test(text);
    if (tonightaday) {
      min = /预计\s*今天/.test(text) ? 0 : /预计\s*明天/.test(text) ? 1 : 2;
    }
    if (hour24) max = 1;
    if (hour48) max = 2;
    return { min, max };
  }

  function parseReturnable() {
    return /7天无理由|七天无理由/.test(panelText()) ? true : null;
  }

  function parseExistence() {
    if (/很抱歉|商品已下架|页面不存在|不存在了/.test(textOf(document.body || "").slice(0, 2000))) return false;
    return !!(resolveTitle() || resolvePrice() !== null);
  }

  function galleryImages() {
    const urls = [];
    const main = document.getElementById("mainPicImageEl");
    const mainSrc = imageSource(main);
    if (mainSrc) urls.push(mainSrc);
    for (const img of queryAll("#picGalleryEle img, #J_UlThumb img, .thumbnail img")) {
      const src = imageSource(img);
      if (src) urls.push(src);
    }
    return [...new Set(urls)].slice(0, 12);
  }

  function skuGroups() {
    const area = document.getElementById("skuOptionsArea") || document.querySelector("#J_SelectSaleProp, .tb-sku");
    if (!area) return [];
    const groups = [];
    const seen = new Set();
    for (const item of queryAll('[class*="skuItem--"], .J_TSaleProp', area)) {
      const labelEl = item.querySelector('[class*="labelWrapTitle--"], .tb-prop-tit');
      const name = cleanTitle(textOf(labelEl));
      if (!name || seen.has(name)) continue;
      const values = [];
      for (const valueEl of queryAll('[class*="valueItem--"], .J_TSalePropValue, .sku-value-list li', item)) {
        if (!valueEl.querySelector("img[src], img[data-savepage-src]") && !textOf(valueEl) && valueEl.children.length) continue;
        const valueText = cleanTitle(textOf(valueEl.querySelector('[class*="valueItemText--"]') || valueEl));
        if (!valueText) continue;
        const img = valueEl.querySelector("img");
        values.push({ name: valueText, image: imageSource(img) });
      }
      if (!values.length) continue;
      seen.add(name);
      groups.push({ name, values });
    }
    return groups;
  }

  function buildOptions(groups) {
    return groups.length ? groups.map((g) => ({ name: g.name })) : null;
  }

  function buildVariants(groups, mainSkuId, price, mainImages) {
    if (!groups.length || price == null) return null;
    let combos = [{}];
    for (const group of groups) {
      combos = combos.flatMap((combo) =>
        group.values.map((v) => ({ ...combo, [group.name]: v }))
      );
    }
    return combos.map((combo, i) => {
      const sku = `${mainSkuId}-${i + 1}`;
      const firstImage = Object.values(combo).find((v) => v?.image)?.image;
      return {
        sku,
        price,
        currency: "CNY",
        available_qty: null,
        barcode: null,
        variant_id: sku,
        option_values: Object.entries(combo).map(([optionName, v]) => ({
          option_name: optionName,
          option_value: v?.name ?? String(v),
        })),
        images: firstImage || mainImages || null,
      };
    });
  }

  function specificationsFromDom() {
    const rows = [];
    const seen = new Set();
    const root = document.querySelector('[class*="paramsWrap--"]') || document.querySelector(".tb-detail");
    if (!root) return rows;
    for (const item of queryAll(
      '[class*="emphasisParamsInfoItem--"], [class*="generalParamsInfoItem--"], #J_AttrUL li, .attributes-list li',
      root
    )) {
      const titleEl = item.querySelector(
        '[class*="emphasisParamsInfoItemSubTitle--"], [class*="generalParamsInfoItemTitle--"], .tb-attr-name, .attr-name'
      );
      const name = cleanTitle(textOf(titleEl)).replace(/[：:]\s*$/, "");
      if (!name) continue;
      let value = textOf(item);
      if (titleEl) value = textOf(item).replace(textOf(titleEl), "").trim();
      value = value.replace(/^[：:]\s*/, "").trim();
      if (!name || !value || seen.has(name)) continue;
      seen.add(name);
      rows.push({ name, value });
    }
    return rows;
  }

  function sanitizeDescriptionHtml(html) {
    if (!html) return "";
    let doc;
    try {
      doc = new DOMParser().parseFromString(`<html><body>${html}</body></html>`, "text/html");
    } catch (_) {
      return "";
    }

    queryAll("script, style, link, noscript, iframe, meta, input, textarea, button, svg, [class*='descV8-charity']", doc).forEach((n) => n.remove());

    queryAll("a", doc).forEach((a) => {
      const span = doc.createElement("span");
      span.innerHTML = a.innerHTML;
      a.replaceWith(span);
    });

    queryAll("img", doc).forEach((img) => {
      const src = imageSource(img);
      if (!src) {
        img.remove();
        return;
      }
      img.setAttribute("src", src);
      [...img.attributes].forEach((attr) => {
        if (attr.name !== "src" && attr.name !== "alt") img.removeAttribute(attr.name);
      });
    });

    queryAll("*", doc).forEach((el) => {
      [...el.attributes].forEach((attr) => {
        const name = attr.name;
        if (/^on/i.test(name)) el.removeAttribute(name);
        else if (name === "style" || name === "href" || name === "target" || name === "rel") el.removeAttribute(name);
        else if (name.startsWith("data-")) el.removeAttribute(name);
      });
    });

    let out = doc.body.innerHTML.trim();
    out = out.replace(/>\s+</g, "><");
    return out;
  }

  function resolveDescription(title) {
    const root =
      document.getElementById("imageTextInfo-content") ||
      document.getElementById("J_DivItemDesc") ||
      document.querySelector("#J_DivItemDesc .parlist, .tb-detail .desc");
    if (root) {
      const sanitized = sanitizeDescriptionHtml(root.innerHTML);
      if (sanitized.length >= 20) return sanitized;
    }
    return title ? `<p>${title}</p>` : "";
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

  function isoDateNow() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  async function extractTmallProduct() {
    const itemId = productIdFromUrl(location.href) || productIdFromUrl(productCanonicalUrl());
    const title = resolveTitle();
    const price = resolvePrice();
    const images = galleryImages().join(";") || null;
    const groups = skuGroups();
    const options = buildOptions(groups);
    const variants = buildVariants(groups, itemId || "0", price, images);
    const specs = specificationsFromDom();
    const shipping = parseShippingDays();
    const brand = specs.find((s) => /品牌/.test(s.name))?.value || null;
    const description = resolveDescription(title);

    const payload = {
      date: isoDateNow(),
      url: productCanonicalUrl(),
      source: SOURCE,
      sku: itemId,
      price: price ?? 0,
      currency: "CNY",
      available_qty: null,
      images,
      product_id: itemId,
      existence: parseExistence(),
      title,
      title_en: null,
      description,
      description_en: null,
      summary: null,
      upc: null,
      brand,
      specifications: specs.length ? specs : null,
      categories: null,
      videos: null,
      options,
      variants,
      returnable: parseReturnable(),
      reviews: null,
      rating: null,
      sold_count: parseSoldCount(),
      shipping_fee: 0,
      shipping_days_min: shipping.min,
      shipping_days_max: shipping.max,
      weight: null,
      width: null,
      height: null,
      length: null,
      has_only_default_variant: !variants || variants.length <= 1,
    };

    payload._validation_errors = validateProductSourceShape(payload);
    return payload;
  }

  const api = {
    extractTmallProduct,
    validateProductSourceShape,
    resolveTitle,
    resolvePrice,
    skuGroups,
    specificationsFromDom,
    sanitizeDescriptionHtml,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.TmallProductExtractor = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);