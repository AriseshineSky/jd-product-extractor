# JD Product Extractor

Chrome 扩展：从京东商品详情页、搜索/列表页提取商品数据，输出 **ProductSource** 兼容的 **JSONL** 文件。

**版本**：1.1.0

---

## 文档

| 文档 | 读者 | 内容 |
|------|------|------|
| **[用户使用指南](docs/用户指南.md)** | 普通用户 | 安装、按钮说明、推荐流程、常见问题 |
| **[开发者文档](docs/开发者文档.md)** | 开发者 | 架构、模块 API、消息协议、存储、适配与测试 |

---

## 快速开始

**用户**：安装扩展 → 打开京东商品页或搜索页 → 点击右下角浮动按钮或工具栏图标提取。详见 [用户指南](docs/用户指南.md)。

**开发者**：

```bash
git clone <repo>
# chrome://extensions → 开发者模式 → 加载已解压 → 选择本目录

npm install
npm run test:saved -- /path/to/saved-item.html
npm run test:search -- /path/to/saved-search.html
```

---

## 功能摘要

- **商品详情页**：滚屏加载 → 完整 ProductSource → **详情 JSONL**（`jd-details-*.jsonl`）
- **搜索/列表页**：翻页缓存链接 → **链接 JSONL**（`jd-links-*.jsonl`）；批量/深度抓取写入详情缓存
- **本地缓存**：详情与链接分开存储、分开下载、分开清空

---

## 许可与免责

仅供学习与个人研究。请遵守京东用户协议，合理控制访问频率；使用本工具产生的法律责任由使用者自行承担。
