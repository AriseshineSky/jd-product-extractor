#!/usr/bin/env node
/**
 * Test Tmall extractor against a saved item HTML (e.g. from Save Page).
 * Usage: npm run test:tmall-saved -- /path/to/saved-tmall.html
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseHTML } from "linkedom";
import vm from "node:vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = process.argv[2];

if (!htmlPath) {
  console.error("Usage: npm run test:tmall-saved -- /path/to/saved-tmall-item.html");
  process.exit(1);
}

const absHtml = path.resolve(htmlPath);
if (!fs.existsSync(absHtml)) {
  console.error("File not found:", absHtml);
  process.exit(1);
}

const html = fs.readFileSync(absHtml, "utf8");
const saveUrlMatch = html.match(/meta name="savepage-url" content="([^"]+)"/);
const itemUrl = saveUrlMatch?.[1] || "https://detail.tmall.com/item.htm?id=0";

const { window } = parseHTML(html);
const { document } = window;

const location = new URL(itemUrl);
Object.defineProperty(window, "location", {
  value: location,
  writable: true,
});

const extractorPath = path.join(__dirname, "../src/tmall-extractor.js");
const extractorCode = fs.readFileSync(extractorPath, "utf8");
const context = {
  window,
  document,
  location,
  globalThis: window,
  console,
  URL,
  URLSearchParams,
  DOMParser: window.DOMParser,
  setTimeout,
  clearTimeout,
  fetch: async () => ({ ok: false, status: 0, text: async () => "" }),
};
vm.createContext(context);
vm.runInContext(extractorCode, context);

const { TmallProductExtractor } = context.window;
if (!TmallProductExtractor) {
  console.error("Failed to load tmall extractor");
  process.exit(1);
}

console.log("Item URL:", location.href);
console.log(await TmallProductExtractor.extractTmallProduct().then((p) => {
  const { _validation_errors, ...product } = p;
  return JSON.stringify(product, null, 2);
}));

const payload = await TmallProductExtractor.extractTmallProduct();
const { _validation_errors, ...product } = payload;

if (TmallProductExtractor.validateProductSourceShape) {
  const errors = TmallProductExtractor.validateProductSourceShape(product);
  if (errors.length) {
    console.log("\nValidation:", errors.join("; "));
  } else {
    console.log("\nValidation: OK");
  }
}

const outPath = path.join(__dirname, "tmall_product.json");
fs.writeFileSync(outPath, JSON.stringify(product, null, 2) + "\n");
console.log("Saved to", outPath);

if (_validation_errors?.length) {
  console.log("\nExtractor self-check:", _validation_errors.join("; "));
}