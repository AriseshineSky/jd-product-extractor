# JD Product Extractor

Chrome 扩展（Manifest V3）：从**京东**商品详情页与搜索/列表页提取商品数据，输出与 **ProductSource / StandardProduct** 兼容的 **JSONL** 文件。

**版本**：1.4.0

---

## 功能概览

| 页面类型 | 支持能力 |
|----------|----------|
| 商品详情 `item.jd.com` 等 | 滚屏加载 → 完整 ProductSource → 详情缓存 / 下载 |
| 搜索/列表 `search.jd.com`、`list.jd.com` | 翻页缓存链接；批量或逐条抓取详情 |

核心特性：

- **双通道操作**：工具栏弹窗 + 页面右下角浮动面板
- **人类行为模拟**：贝塞尔滚屏、轨迹点击，降低懒加载漏字段
- **本地缓存分离**：详情与链接分开存储、下载、清空
- **断点续跑**：搜索抓取支持 checkpoint，验证页跳转后可恢复
- **无构建步骤**：源码即扩展，加载已解压目录即可使用

---

## 文档

| 文档 | 读者 | 内容 |
|------|------|------|
| **[用户使用指南](docs/用户指南.md)** | 普通用户 | 安装、按钮说明、推荐流程、常见问题 |
| **[开发者文档](docs/开发者文档.md)** | 开发者 | 架构、模块 API、消息协议、存储、适配与测试 |

---

## 安装

1. 克隆或下载本仓库：

```bash
git clone git@github.com:AriseshineSky/jd-product-extractor.git
cd jd-product-extractor
```

2. 打开浏览器扩展管理页：
   - **Chrome**：`chrome://extensions`
   - **Edge**：`edge://extensions`
3. 开启 **开发者模式** → **加载已解压的扩展程序** → 选择项目根目录（含 `manifest.json`）。
4. 将扩展图标固定到工具栏。

> 普通使用无需安装 Node.js。仅在本地跑离线解析测试时需要 `npm install`。

---

## 快速使用

### 京东商品详情页

1. 打开商品页，手动向下滚动以加载图文详情。
2. 点击扩展图标 **「提取并下载 JSONL」**，或页面右下角同名按钮。
3. 扩展自动滚屏并提取，写入 **详情缓存** 并下载 `jd-details-*.jsonl`。

### 京东搜索/列表页

推荐两步流程：

```
搜索页 → 翻页缓存链接 → （可选）下载链接 JSONL
      → 批量详情提取 → 下载详情 JSONL
```

也可一步完成：**翻页逐一点开详情提取**（保持搜索页在前台，耗时较长）。

更多按钮说明与常见问题见 **[用户指南](docs/用户指南.md)**。

---

## 输出文件

数据分两类，**互不混合**：

| 类型 | 说明 | 典型文件名 |
|------|------|------------|
| **详情 JSONL** | 商品详情完整信息（标题、规格、变体、描述等） | `jd-details-2026-05-26-1234567890.jsonl` |
| **链接 JSONL** | 搜索页收集的 URL、SKU、标题、关键词等 | `jd-links-2026-05-26-手机.jsonl` |

每行一条 JSON（NDJSON 格式）。详情字段与 **product-validator** 中 `ProductSource` / `Variant` 规则对齐。

链接记录示例：

```json
{"url":"https://item.jd.com/1234567890.html","sku":"1234567890","title":"…","search_keyword":"手机","search_page":"1","collected_at":"…"}
```

弹窗底部显示当前缓存条数，例如：`当前缓存：详情 239 条，链接 29 条`。

---

## 项目结构

```
jd-product-extractor/
├── manifest.json              # MV3 清单、权限、content_scripts
├── background.js                # Service Worker：存储、批量详情、续跑
├── popup/                       # 扩展弹窗 UI
├── src/
│   ├── extractor.js             # 京东详情页 → ProductSource
│   ├── search-extractor.js      # 京东搜索列表解析
│   ├── search-content.js        # 京东搜索页 UI 与深度抓取
│   ├── content.js               # 京东详情页 UI
│   ├── human-scroll.js          # 贝塞尔滚屏
│   ├── human-mouse.js           # 轨迹点击
│   └── download.js              # JSONL 下载
├── scripts/                     # Node 离线测试（linkedom）
├── icons/
└── docs/
```

---

## 开发与测试

修改任意 JS 后，在 `chrome://extensions` 点击扩展 **重新加载**，并 **刷新** 目标页面。

```bash
npm install

# 用本地保存的京东商品页 HTML 测详情解析
npm run test:saved -- /path/to/saved-item.html

# 用本地保存的京东搜索页 HTML 测列表解析
npm run test:search -- /path/to/saved-search.html
```

架构、消息协议、存储键名等技术细节见 **[开发者文档](docs/开发者文档.md)**。

---

## 注意事项

- 请遵守京东用户协议，合理控制访问频率，避免触发风控验证。
- 扩展在请求京东评价等接口时会使用当前浏览器的登录 Cookie（`credentials: "include"`），不会将 Cookie 写入导出文件。
- 重装扩展或清理浏览器数据会丢失 `chrome.storage.local` 中的缓存，请及时下载 JSONL 备份。
- 仅供学习与个人研究；使用本工具产生的法律责任由使用者自行承担。

---

## 许可与免责

本项目仅供学习与个人研究。请遵守京东用户协议，合理控制访问频率；使用本工具产生的法律责任由使用者自行承担。
