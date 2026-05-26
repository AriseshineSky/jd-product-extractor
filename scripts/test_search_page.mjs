#!/usr/bin/env node
/**
 * Test search extractor against a saved JD search HTML.
 * Usage: npm run test:search -- /path/to/saved-search.html
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseHTML } from "linkedom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = process.argv[2];

if (!htmlPath) {
  console.error("Usage: npm run test:search -- /path/to/saved-search.html");
  process.exit(1);
}

const absHtml = path.resolve(htmlPath);
const html = fs.readFileSync(absHtml, "utf8");
const itemUrlMatch = html.match(/search\.jd\.com\/Search\?[^"]+|keyword=([^&"]+)/);
const searchUrl = itemUrlMatch
  ? `https://search.jd.com/Search?keyword=${itemUrlMatch[1] || "test"}&enc=utf-8`
  : "https://search.jd.com/Search?keyword=test&enc=utf-8";

const { window } = parseHTML(html);
const location = new URL(searchUrl);
Object.defineProperty(window, "location", { value: location, writable: true });

const extractorCode = fs.readFileSync(path.join(__dirname, "../src/search-extractor.js"), "utf8");
const ctx = { window, document: window.document, location, console, URL, URLSearchParams };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(extractorCode, ctx);
ctx.JdHumanScroll = { scrollPageToBottom: async () => {} };

const result = await ctx.window.JdSearchExtractor.extractJdSearchProducts();
console.log("keyword:", result.keyword);
console.log("count:", result.count);
console.log("\n--- first 3 products ---");
result.products.slice(0, 3).forEach((p, i) => {
  const { _validation_errors, ...row } = p;
  console.log(`\n#${i + 1}`, row.title?.slice(0, 60));
  console.log("  sku:", row.sku, "price:", row.price);
  console.log("  shop:", row.shop_name, "reviews:", row.reviews);
  console.log("  image:", row.images?.slice(0, 80));
  if (_validation_errors?.length) console.log("  warn:", _validation_errors.join("; "));
});
