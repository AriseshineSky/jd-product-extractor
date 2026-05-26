(function (global) {
  function recordsToJsonl(records) {
    return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
  }

  function defaultFilename(records) {
    const stamp = new Date().toISOString().slice(0, 10);
    const sku = records.at(-1)?.product_id || records.at(-1)?.sku || "product";
    return `jd-details-${stamp}-${sku}.jsonl`;
  }

  function downloadRecords(records, filename) {
    if (!Array.isArray(records) || !records.length) {
      throw new Error("没有可下载的商品数据");
    }

    const name = filename || defaultFilename(records);
    const blob = new Blob([recordsToJsonl(records)], {
      type: "application/x-ndjson;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.style.display = "none";
    document.documentElement.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  global.JdJsonlDownload = { downloadRecords, defaultFilename, recordsToJsonl };
})(typeof globalThis !== "undefined" ? globalThis : window);
