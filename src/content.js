(function () {
  const FLAG = "__jdProductExtractorReady";
  const STYLE_ID = "jd-product-extractor-style";
  const PANEL_ID = "jd-product-extractor-panel";

  function injectFloatingButton() {
    if (document.getElementById(PANEL_ID)) return;
    window[FLAG] = true;

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        #jd-product-extractor-panel {
          position: fixed;
          right: 18px;
          bottom: 24px;
          z-index: 2147483646;
          display: flex;
          flex-direction: column-reverse;
          gap: 8px;
          align-items: flex-end;
        }
        #jd-product-extractor-panel button {
          border: none;
          border-radius: 999px;
          padding: 10px 14px;
          font-size: 12px;
          font-weight: 600;
          color: #fff;
          cursor: pointer;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
          white-space: nowrap;
        }
        #jd-product-extractor-panel button:disabled {
          opacity: 0.65;
          cursor: wait;
        }
        #jd-product-extractor-only-btn { background: #2563eb; }
        #jd-product-extractor-btn { background: #e1251b; }
        #jd-product-extractor-toast {
          position: fixed;
          right: 18px;
          bottom: 120px;
          z-index: 2147483647;
          max-width: 340px;
          padding: 10px 12px;
          border-radius: 8px;
          font-size: 12px;
          line-height: 1.4;
          color: #fff;
          background: rgba(17, 24, 39, 0.92);
          display: none;
        }
      `;
      document.documentElement.appendChild(style);
    }

    const panel = document.createElement("div");
    panel.id = PANEL_ID;

    const onlyBtn = document.createElement("button");
    onlyBtn.id = "jd-product-extractor-only-btn";
    onlyBtn.type = "button";
    onlyBtn.textContent = "只提取商品信息";
    onlyBtn.addEventListener("click", () => runExtract(onlyBtn, { download: false }));

    const downloadBtn = document.createElement("button");
    downloadBtn.id = "jd-product-extractor-btn";
    downloadBtn.type = "button";
    downloadBtn.textContent = "提取并下载 JSONL";
    downloadBtn.addEventListener("click", () => runExtract(downloadBtn, { download: true }));

    panel.appendChild(downloadBtn);
    panel.appendChild(onlyBtn);
    document.documentElement.appendChild(panel);
  }

  function setPanelDisabled(disabled) {
    document.querySelectorAll(`#${PANEL_ID} button`).forEach((btn) => {
      btn.disabled = disabled;
    });
  }

  function showToast(text, isError = false) {
    let toast = document.getElementById("jd-product-extractor-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "jd-product-extractor-toast";
      document.documentElement.appendChild(toast);
    }
    toast.style.display = "block";
    toast.style.background = isError ? "rgba(185, 28, 28, 0.95)" : "rgba(17, 24, 39, 0.92)";
    toast.textContent = text;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      toast.style.display = "none";
    }, 6000);
  }

  async function humanScrollBeforeExtract(options = {}) {
    if (!window.JdHumanScroll?.scrollPageToBottom) {
      throw new Error("滚动模块未加载，请刷新页面后重试");
    }
    showToast("正在平滑滚动页面（请观看当前窗口）…");
    await window.JdHumanScroll.scrollPageToBottom(options);
  }

  async function runExtract(_button, { download = false } = {}) {
    setPanelDisabled(true);
    showToast(download ? "正在滚动并提取，完成后下载 JSONL…" : "正在滚动并提取商品信息…");

    try {
      await humanScrollBeforeExtract();
      showToast("滚动完成，正在解析商品数据…");

      const data = await JdProductExtractor.extractJdProduct();
      const { _validation_errors, ...product } = data;

      const saved = await chrome.runtime.sendMessage({
        type: "APPEND_JSONL_RECORD",
        product,
      });

      if (!saved?.ok) {
        throw new Error(saved?.error || "保存 JSONL 缓存失败");
      }

      if (download) {
        JdJsonlDownload.downloadRecords(saved.records, saved.filename);
      }

      const validationHint = _validation_errors?.length
        ? `，校验提示: ${_validation_errors.join("; ")}`
        : "";

      if (download) {
        showToast(`已下载 JSONL（缓存 ${saved.count} 条）${validationHint}`);
      } else {
        showToast(`已提取并写入缓存（共 ${saved.count} 条）${validationHint}`);
      }
    } catch (error) {
      showToast(String(error.message || error), true);
    } finally {
      setPanelDisabled(false);
    }
  }

  async function handleExtractMessage(message, sendResponse) {
    try {
      if (!window.JdProductExtractor?.extractJdProduct) {
        throw new Error("提取脚本未加载，请刷新商品页后重试");
      }

      const opts = message.options || {};
      const needScroll = opts.scroll !== false;

      if (needScroll) {
        await humanScrollBeforeExtract(opts.scroll || {});
      }

      const data = await window.JdProductExtractor.extractJdProduct(opts);
      const { _validation_errors, ...product } = data;

      let saved = null;
      if (opts.save !== false) {
        saved = await chrome.runtime.sendMessage({
          type: "APPEND_JSONL_RECORD",
          product,
        });
        if (!saved?.ok) throw new Error(saved?.error || "保存缓存失败");
      }

      if (opts.download === true && saved?.records) {
        JdJsonlDownload.downloadRecords(saved.records, saved.filename);
      }

      sendResponse({
        ok: true,
        data,
        saved,
        validation_errors: _validation_errors || [],
      });
    } catch (error) {
      sendResponse({ ok: false, error: String(error?.message || error) });
    }
  }

  if (!window.__jdProductExtractorMessageListener) {
    window.__jdProductExtractorMessageListener = true;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (
        message?.type !== "EXTRACT_JD_PRODUCT" &&
        message?.type !== "EXTRACT_JD_PRODUCT_WITH_SCROLL"
      ) {
        return;
      }

      handleExtractMessage(message, sendResponse);
      return true;
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectFloatingButton);
  } else {
    injectFloatingButton();
  }
})();
