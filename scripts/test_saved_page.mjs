#!/usr/bin/env node
/**
 * Test extractor against a saved JD item HTML (e.g. from Save Page).
 * Usage: npm run test:saved -- /path/to/saved.html
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseHTML } from "linkedom";
import vm from "node:vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = process.argv[2];

if (!htmlPath) {
  console.error("Usage: npm run test:saved -- /path/to/saved-jd-item.html");
  process.exit(1);
}

const absHtml = path.resolve(htmlPath);
if (!fs.existsSync(absHtml)) {
  console.error("File not found:", absHtml);
  process.exit(1);
}

const saveUrlMatch = fs
  .readFileSync(absHtml, "utf8")
  .match(/meta name="savepage-url" content="([^"]+)"/);
const itemUrl =
  saveUrlMatch?.[1]?.split("?")[0] ||
  `https://item.jd.com/${absHtml.match(/(\d{10,})\.html/)?.[1] || "0"}.html`;

const html = fs.readFileSync(absHtml, "utf8");
const { window } = parseHTML(html);
const { document } = window;

const location = new URL(itemUrl);
Object.defineProperty(window, "location", {
  value: location,
  writable: true,
});

const extractorPath = path.join(__dirname, "../src/extractor.js");
const extractorCode = fs.readFileSync(extractorPath, "utf8");
const context = {
  window,
  document,
  location,
  globalThis: window,
  console,
  DOMParser: window.DOMParser,
  setTimeout,
  clearTimeout,
  fetch: async () => ({ ok: false, status: 0, text: async () => "" }),
  pageConfig: undefined,
};
vm.createContext(context);
vm.runInContext(extractorCode, context);

const { JdProductExtractor } = context.window;
if (!JdProductExtractor) {
  console.error("Failed to load extractor");
  process.exit(1);
}

console.log("Item URL:", itemUrl);
console.log("New page (DOM mode):", JdProductExtractor.isNewJdItemPage());
console.log("DOM product preview:", JSON.stringify(JdProductExtractor.tryBuildProductFromDom(), null, 2));

const payload = await JdProductExtractor.extractJdProduct({ pageConfigTimeoutMs: 3000 });
const { _validation_errors, ...product } = payload;

console.log("\n--- ProductSource ---");
console.log(JSON.stringify(product, null, 2));
if (_validation_errors?.length) {
  console.log("\nValidation:", _validation_errors.join("; "));
} else {
  console.log("\nValidation: OK");
}
