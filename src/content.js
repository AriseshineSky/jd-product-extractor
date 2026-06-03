(function () {
  const FLAG = "__jdProductExtractorReady";
  const STYLE_ID = "jd-product-extractor-style";
  const PANEL_ID = "jd-product-extractor-panel";

  if (window.JdPageUrl?.detectPageMode(location.href) !== "item") return;

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
          pointer-events: auto;
        }
        #jd-product-extractor-desc-dialog {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          display: none;
          align-items: center;
          justify-content: center;
          background: rgba(15, 23, 42, 0.45);
        }
        #jd-product-extractor-desc-dialog .jd-desc-dialog-panel {
          max-width: 360px;
          margin: 16px;
          padding: 18px 20px;
          border-radius: 12px;
          background: #fff;
          color: #111827;
          box-shadow: 0 18px 40px rgba(15, 23, 42, 0.22);
        }
        #jd-product-extractor-desc-dialog h3 {
          margin: 0 0 10px;
          font-size: 15px;
          line-height: 1.4;
        }
        #jd-product-extractor-desc-dialog p {
          margin: 0 0 16px;
          font-size: 13px;
          line-height: 1.6;
          color: #4b5563;
        }
        #jd-product-extractor-desc-dialog button {
          border: none;
          border-radius: 8px;
          padding: 8px 14px;
          font-size: 13px;
          font-weight: 600;
          color: #fff;
          background: #2563eb;
          cursor: pointer;
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

  function hideItemToast() {
    const toast = document.getElementById("jd-product-extractor-toast");
    if (toast) toast.style.display = "none";
    clearTimeout(showToast._timer);
    showToast._timer = null;
  }

  function bindItemToastBehavior(toast) {
    if (toast.dataset.leaveBound) return;
    toast.dataset.leaveBound = "1";
    toast.addEventListener("mouseenter", () => {
      clearTimeout(showToast._timer);
      showToast._timer = null;
    });
    toast.addEventListener("mouseleave", hideItemToast);
  }

  const DESCRIPTION_REQUIRED_MESSAGE =
    "商品描述尚未加载。请先向下滚动页面，等待图文详情加载完成后再点击提取。";

  function showDescriptionRequiredDialog() {
    let dialog = document.getElementById("jd-product-extractor-desc-dialog");
    if (!dialog) {
      dialog = document.createElement("div");
      dialog.id = "jd-product-extractor-desc-dialog";
      dialog.innerHTML = `
        <div class="jd-desc-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="jd-desc-dialog-title">
          <h3 id="jd-desc-dialog-title">请先加载商品描述</h3>
          <p>${DESCRIPTION_REQUIRED_MESSAGE}</p>
          <button type="button">我知道了</button>
        </div>
      `;
      const close = () => {
        dialog.style.display = "none";
      };
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) close();
      });
      dialog.querySelector("button")?.addEventListener("click", close);
      document.documentElement.appendChild(dialog);
    }
    dialog.style.display = "flex";
  }

  function ensurePageDescriptionLoaded() {
    if (window.JdProductExtractor?.hasPageDescriptionLoaded?.()) return;
    showDescriptionRequiredDialog();
    const error = new Error(DESCRIPTION_REQUIRED_MESSAGE);
    error.code = "DESCRIPTION_NOT_LOADED";
    throw error;
  }

  function showToast(text, isError = false) {
    let toast = document.getElementById("jd-product-extractor-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "jd-product-extractor-toast";
      document.documentElement.appendChild(toast);
      bindItemToastBehavior(toast);
    }
    toast.style.display = "block";
    toast.style.background = isError ? "rgba(185, 28, 28, 0.95)" : "rgba(17, 24, 39, 0.92)";
    toast.textContent = text;
    clearTimeout(showToast._timer);
    if (!toast.matches(":hover")) {
      showToast._timer = setTimeout(hideItemToast, 6000);
    }
  }

  async function humanScrollBeforeExtract(options = {}) {
    if (!window.JdHumanScroll?.scrollPageToBottom) {
      throw new Error("滚动模块未加载，请刷新页面后重试");
    }
    showToast("正在平滑滚动页面（暂停任务将同步停止滚屏）…");
    await window.JdHumanScroll.scrollPageToBottom({
      ...options,
      shouldContinue: options.shouldContinue,
    });
  }

  async function runExtract(_button, { download = false } = {}) {
    setPanelDisabled(true);
    showToast(download ? "正在提取并下载 JSONL…" : "正在提取商品信息…");

    try {
      ensurePageDescriptionLoaded();
      showToast("正在解析商品数据…");

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
      if (error?.code !== "DESCRIPTION_NOT_LOADED") {
        showToast(String(error.message || error), true);
      }
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
      const needScroll = opts.scroll === true;

      if (needScroll) {
        await humanScrollBeforeExtract(opts.scroll || {});
      } else {
        ensurePageDescriptionLoaded();
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
      sendResponse({
        ok: false,
        error: String(error?.message || error),
        code: error?.code || undefined,
      });
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
