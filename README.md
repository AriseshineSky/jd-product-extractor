# CN Product Extractor

Chrome 扩展：从京东/天猫商品详情页、淘宝搜索列表页提取商品数据，缓存到浏览器，输出 **ProductSource** 兼容的 **JSONL** 文件。导出文件可手动上传到 everymarket 后台（`/dashboard/cn_product_imports` 或 `/dashboard/product_imports`）导入商品。

**版本**：2.0.0

---

## 文档

| 文档 | 读者 | 内容 |
|------|------|------|
| **[用户使用指南](docs/用户指南.md)** | 普通用户 | 安装、按钮说明、推荐流程、常见问题 |
| **[开发者文档](docs/开发者文档.md)** | 开发者 | 架构、模块 API、消息协议、存储、适配与测试 |

---

## 快速开始

**用户**：安装扩展 → 打开京东/天猫商品页或淘宝搜索页 → 点击右下角浮动按钮或工具栏图标提取。详见 [用户指南](docs/用户指南.md)。

**开发者**：

```bash
git clone <repo>
# chrome://extensions → 开发者模式 → 加载已解压 → 选择本目录

npm install
npm run test:saved -- /path/to/saved-item.html
npm run test:tmall-saved -- /path/to/saved-tmall-item.html
npm run test:taobao-search -- /path/to/saved-search.html
```

**校验输出**（StandardProduct 兼容，需 product-validator 依赖）：

```bash
python3 scripts/validate_sample.py scripts/tmall_product.json
```

**提取 → 缓存 → 统一下载**：

1. 打开京东/天猫商品页或淘宝搜索页，点浮动按钮或扩展弹窗「提取并写入缓存」（默认不自动下载，缓存上限 10000 条，按商品去重）。
2. 批量提取完成后，点「统一下载全部 JSONL」导出缓存中全部记录为单个 `cn-details-*.jsonl` 文件。
3. 把该 JSONL 文件上传到 everymarket 后台的 **CN Product Imports** 页面（`/dashboard/cn_product_imports/new`）导入商品。

---

## 功能摘要

- **京东商品详情页**：滚屏加载 → 完整 ProductSource → **详情 JSONL**（`cn-details-*.jsonl`）
- **天猫商品详情页**（detail.tmall.com）：DOM 解析标题/价格/SKU 变体/图文详情/参数 → 完整 ProductSource
- **淘宝搜索列表页**（s.taobao.com）：提取列表级商品数据
- **详情缓存**：最多保留 **10000 条**，超出自动删除最旧；提取默认只写入缓存，可用「统一下载全部 JSONL」导出全部记录

---

## 许可与免责

仅供学习与个人研究。请遵守京东、天猫用户协议，合理控制访问频率；使用本工具产生的法律责任由使用者自行承担。