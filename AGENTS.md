# AGENTS.md — CN Product Extractor

Chrome MV3 extension that extracts product data from JD/Tmall detail pages and Taobao search pages into ProductSource-compatible JSONL. Extraction writes to a browser cache; "统一下载全部 JSONL" exports it as one file for manual upload to the everymarket dashboard (`/dashboard/cn_product_imports`).

## Build & run

- **No build step.** The repo root is the extension: load unpacked at `chrome://extensions`. `npm install` is only for offline tests (the sole dep is `linkedom`).
- After editing any JS, reload the extension **and** refresh the target page (content scripts are not re-injected on extension reload).
- `manifest.json` is the source of truth for content script wiring, not the docs.

## Verification (no lint/typecheck configured; these scripted tests are it)

- `npm run test:saved -- /path/to/saved-item.html` — JD detail parsing (run with `vm` + linkedom)
- `npm run test:tmall-saved -- /path/to/saved-tmall.html` — Tmall detail; also writes `scripts/tmall_product.json`
- `npm run test:taobao-search -- /path/to/saved-search.html` — Taobao search list
- Tests need a Save-Page HTML file; `fixtures/` is gitignored for that purpose. `fetch` is stubbed in tests, so extraction code must not depend on network.
- `python3 scripts/validate_sample.py <json>` validates against `ProductSource`/`StandardProduct`, but imports the **sibling `product-validator` repo** (`../product-validator/src`) — it fails if that repo isn't checked out next to this one.

## Architecture

- Scripts are classic IIFEs that attach APIs to the shared `window`/`global` object (`JdPageUrl`, `JdProductExtractor`, `TmallProductExtractor`, `TaobaoSearchExtractor`, `JdJsonlDownload`, ...). The content_scripts JS array order in `manifest.json` defines what globals are available; new scripts must be added there **and** to the fallback inject lists in `popup/popup.js` (`injectSearchScripts` ~line 109, `injectItemScripts` ~line 124).
- `background.js` (service worker) owns the detail cache: key `cn_jsonl_records`, dedup (by `product_id`/`sku`/`url`), max 10000 records (evicts oldest). Extraction is cache-only by default; "统一下载全部 JSONL" exports the whole cache in one file. It also migrates legacy keys (`jd_jsonl_records`, `jd_crawl_*`, `jd_product_url_queue`) on startup. Batch appends use `APPEND_JSONL_RECORDS` (storage is rewritten per message, so taobao list results are appended in one call).
- Message protocol (details in `docs/开发者文档.md` 消息协议): popup → content via `tabs.sendMessage` (`EXTRACT_JD_PRODUCT_WITH_SCROLL`, `EXTRACT_TMALL_PRODUCT`, `EXTRACT_TAOBAO_SEARCH_LIST`; on failure popup re-injects scripts and retries); content/popup → background via `runtime.sendMessage` (`APPEND_/GET_/DOWNLOAD_/CLEAR_JSONL_RECORDS`). Keep popup, content, and background handlers in sync.

## Platform quirks

- Tmall/Taobao class names carry hash suffixes (`mainTitle--R75fTcZL`): match with `[class*="prefix--"]`, never hardcode full class names.
- Saved pages localize images to `data:` URLs; the real URL lives in `data-savepage-src` / `data-savepage-currentsrc` (`imageSource()` handles this).
- JD detail description is lazy-loaded: must scroll first and the detail section must contain ≥20 chars; Tmall is SSR, no scrolling needed.

## Docs

- All docs (`README.md`, `docs/开发者文档.md`, `docs/用户指南.md`) are in Chinese. The dev doc is slightly stale (references deleted `jd-scroll-pause.js` and `scripts/test_search_page.mjs`) — trust `manifest.json` and `scripts/` when they conflict.