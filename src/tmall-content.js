(function () {
  const FLAG = "__tmallProductExtractorReady";
  const STYLE_ID = "tmall-product-extractor-style";
  const PANEL_ID = "tmall-product-extractor-panel";

  if (typeof window.JdPageUrl?.detectPageMode !== "function") return;
  if (window.JdPageUrl.detectPageMode(location.href) !== "item") return;
  if (window.JdPageUrl.detectPlatform(location.href) !== "taobao") return;

  function showToast(text, isError = false) {
    let toast = document.getElementById("tmall-product-extractor-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "tmall-product-extractor-toast";
      toast.style.cssText = `
        position: fixed; right: 18px; bottom: 120px; z-index: 2147483647;
        max-width: 340px; padding: 10px 12px; border-radius: 8px;
        font-size: 12px; line-height: 1.4; color: #fff;
        background: rgba(17, 24, 39, 0.92); display: none; pointer-events: auto;
      `;
      document.documentElement.appendChild(toast);
    }
    toast.style.display = "block";
    toast.style.background = isError ? "rgba(185, 28, 28, 0.95)" : "rgba(17, 24, 39, 0.92)";
    toast.textContent = text;
    setTimeout(() => {
      toast.style.display = "none";
    }, 6000);
  }

  function injectPanel() {
    if (document.getElementById(PANEL_ID) || window[FLAG]) return;
    window[FLAG] = true;

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        #tmall-product-extractor-panel {
          position: fixed; right: 18px; bottom: 24px; z-index: 2147483646;
          display: flex; flex-direction: column-reverse; gap: 8px; align-items: flex-end;
        }
        #tmall-product-extractor-panel button {
          border: none; border-radius: 999px; padding: 10px 14px; font-size: 12px;
          font-weight: 600; color: #fff; cursor: pointer;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18); white-space: nowrap;
        }
        #tmall-product-extractor-panel button:disabled { opacity: 0.65; cursor: wait; }
        #tmall-product-extractor-btn { background: #ff5000; }
        #tmall-product-extractor-download-btn { background: #4b5563; }
      `;
      document.documentElement.appendChild(style);
    }

    const panel = document.createElement("div");
    panel.id = PANEL_ID;

    const extractBtn = document.createElement("button");
    extractBtn.id = "tmall-product-extractor-btn";
    extractBtn.type = "button";
    extractBtn.textContent = "提取并写入缓存";
    extractBtn.addEventListener("click", () => runExtract());

    const downloadBtn = document.createElement("button");
    downloadBtn.id = "tmall-product-extractor-download-btn";
    downloadBtn.type = "button";
    downloadBtn.textContent = "下载全部 JSONL";
    downloadBtn.addEventListener("click", downloadAllRecords);

    panel.appendChild(extractBtn);
    panel.appendChild(downloadBtn);
    document.documentElement.appendChild(panel);
  }

  async function downloadAllRecords() {
    const records = await chrome.runtime.sendMessage({ type: "GET_JSONL_RECORDS" });
    if (!records?.ok || !records.count) {
      showToast("缓存为空，请先提取商品", true);
      return;
    }
    JdJsonlDownload.downloadRecords(records.records, records.filename);
    showToast(`已下载全部 JSONL（共 ${records.count} 条）`);
  }

  async function runExtract() {
    showToast("正在提取商品信息…");
    try {
      const data = await window.TmallProductExtractor.extractTmallProduct();
      const { _validation_errors, ...product } = data;

      const saved = await chrome.runtime.sendMessage({
        type: "APPEND_JSONL_RECORD",
        product,
      });
      if (!saved?.ok) throw new Error(saved?.error || "保存 JSONL 缓存失败");

      const validationHint = _validation_errors?.length
        ? `，校验提示: ${_validation_errors.join("; ")}`
        : "";
      showToast(`已提取并写入缓存（缓存 ${saved.count} 条）${validationHint}`);
    } catch (error) {
      showToast(String(error?.message || error), true);
    }
  }

  async function handleExtractMessage(message, sendResponse) {
    try {
      if (!window.TmallProductExtractor?.extractTmallProduct) {
        throw new Error("提取脚本未加载，请刷新商品页后重试");
      }
      const data = await window.TmallProductExtractor.extractTmallProduct();
      const { _validation_errors, ...product } = data;

      let saved = null;
      if (message?.options?.save !== false) {
        saved = await chrome.runtime.sendMessage({
          type: "APPEND_JSONL_RECORD",
          product,
        });
        if (!saved?.ok) throw new Error(saved?.error || "保存缓存失败");
      }

      sendResponse({
        ok: true,
        data,
        saved,
        validation_errors: _validation_errors || [],
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: String(error?.message || error),
      });
    }
  }

  if (!window.__tmallProductExtractorMessageListener) {
    window.__tmallProductExtractorMessageListener = true;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "EXTRACT_TMALL_PRODUCT") return;
      handleExtractMessage(message, sendResponse);
      return true;
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectPanel);
  } else {
    injectPanel();
  }
})();