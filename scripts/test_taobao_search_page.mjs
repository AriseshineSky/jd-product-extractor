#!/usr/bin/env node
/**
 * Test Taobao search extractor against saved HTML.
 * Usage: npm run test:taobao-search -- fixtures/taobao-search-sample.html
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = process.argv[2] || path.join(__dirname, "../fixtures/taobao-search-sample.html");

const absHtml = path.resolve(htmlPath);
const html = fs.readFileSync(absHtml, "utf8");
const searchUrl =
  "https://s.taobao.com/search?q=%E8%A4%AA%E9%BB%91%E7%B4%A0&tab=mall&page=1";

const { window } = parseHTML(html);
const location = new URL(searchUrl);
Object.defineProperty(window, "location", { value: location, writable: true });

const extractorCode = fs.readFileSync(
  path.join(__dirname, "../src/taobao-search-extractor.js"),
  "utf8"
);
const ctx = {
  window,
  document: window.document,
  location,
  console,
  URL,
  URLSearchParams,
  setTimeout,
  clearTimeout,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(extractorCode, ctx);
ctx.JdHumanScroll = { scrollPageToBottom: async () => {} };

const result = await ctx.TaobaoSearchExtractor.extractTaobaoSearchProducts({ scroll: false });
console.log("keyword:", result.keyword);
console.log("count:", result.count);
console.log("\n--- products ---");
result.products.forEach((p, i) => {
  const { _validation_errors, ...row } = p;
  console.log(`\n#${i + 1}`, row.title?.slice(0, 60));
  console.log("  source:", row.source, "sku:", row.sku, "price:", row.price);
  console.log("  shop:", row.shop_name, "sold:", row.sold_count);
  console.log("  url:", row.url);
  if (_validation_errors?.length) console.log("  warn:", _validation_errors.join("; "));
});

if (result.count !== 3) {
  console.error(`Expected 3 products, got ${result.count}`);
  process.exit(1);
}
