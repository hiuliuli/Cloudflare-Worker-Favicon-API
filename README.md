# 🌐 Favicon API Service on Cloudflare Workers

一个部署在 Cloudflare Workers 上的轻量级、高性能网站图标获取服务。内置现代化管理面板，支持 Token 鉴权、多策略图标抓取及 IPv6 网站解析。

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Cloudflare%20Workers-orange.svg)
![Dependencies](https://img.shields.io/badge/dependencies-none-brightgreen.svg)

## ✨ 主要功能

*   **双重获取策略**：优先使用 Google S2 服务获取图标（速度极快），失败时自动回退到 HTML 解析模式（支持 `<link rel="icon">` 等标签）。
*   **安全鉴权**：API 接口强制要求 Token 验证，防止滥用。
*   **内置管理面板**：
    *   **零依赖**：纯原生 HTML/CSS/JS 实现，无 Vue/React/Tailwind 依赖，加载速度极快。
    *   **现代化 UI**：采用毛玻璃（Glassmorphism）设计，支持加载动画、密码显隐切换。
    *   **Token 管理**：可视化创建、查看、删除 Token。
    *   **API 测试**：面板内置 API 调试工具，实时预览图标抓取结果。
*   **KV 存储**：使用 Cloudflare KV 存储密码和 Token 数据。

## 🚀 部署指南

### 1. 准备工作
你需要一个 [Cloudflare](https://www.cloudflare.com/) 账号。

### 2. 创建 KV Namespace
1.  登录 Cloudflare Dashboard。
2.  进入 **Workers & Pages** -> **KV**。
3.  点击 **Create a Namespace**。
4.  命名为 `Favicon_KV` (或者你喜欢的名字)，点击 Add。

### 3. 创建 Worker
1.  进入 **Workers & Pages** -> **Overview**。
2.  点击 **Create Application** -> **Create Worker**。
3.  命名你的 Worker（例如 `favicon-api`），点击 Deploy。

### 4. 绑定 KV 数据库 (关键步骤)
1.  进入你刚才创建的 Worker 的设置页面 (**Settings**)。
2.  选择 **Variables** 选项卡。
3.  向下滚动到 **KV Namespace Bindings**。
4.  点击 **Add Binding**：
    *   **Variable name**: 填写 `MY_KV` (**必须完全一致**，代码中读取的是此变量名)。
    *   **KV Namespace**: 选择第 2 步创建的 `Favicon_KV`。
5.  点击 **Save and deploy**。

### 5. 部署代码
1.  点击 **Edit code** 进入在线编辑器。
2.  将 `worker.js` 的内容完全覆盖到编辑器中。
3.  点击右上角的 **Deploy**。

## 🛠️ 初始化与配置

1.  **首次访问**：
    在浏览器中访问你的 Worker 域名（例如 `https://favicon-api.your-name.workers.dev`）。
2.  **设置密码**：
    系统会检测到尚未初始化，显示 **"Initial Setup"** 界面。请输入一个强密码作为管理员密码。
3.  **登录面板**：
    使用刚才设置的密码登录 Dashboard。
4.  **创建 Token**：
    在 Dashboard 中点击 **Create** 按钮生成一个新的 Token。你将使用此 Token 调用 API。

## 🔌 API 文档

### 获取图标接口

**Endpoint:**
`GET /get`

**Parameters:**

| 参数 | 类型 | 必填 | 说明 | 默认值 | 示例 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `token` | String | ✅ | 在后台生成的访问令牌 | - | `f9f2f3...` |
| `url` | String | ✅ | 目标网站的 URL 或域名 | - | `github.com` |
| `size` | Number | ❌ | 图标尺寸 (像素) | `64` | `128` |

**示例请求:**

```bash
curl "https://your-worker.workers.dev/get?token=YOUR_TOKEN&url=github.com&size=64"
```

**响应:**
*   **成功**: 返回 `image/png`, `image/x-icon`, `image/svg+xml` 等图片流。
*   **失败**:
    *   `400 Bad Request`: 缺少参数。
    *   `401 Unauthorized`: Token 缺失。
    *   `403 Forbidden`: Token 无效。

**兜底机制:**
如果无法获取目标网站图标，API 将返回一张默认的灰色地球 SVG 图标。

## ⚙️ 管理 API (内部使用)

以下接口主要供前端面板使用，均需要 Header 鉴权 `Authorization: Bearer <AdminPassword>`。

*   `POST /api/setup`: 初始化设置密码。
*   `POST /api/login`: 校验管理员密码。
*   `GET /api/tokens`: 获取 Token 列表。
*   `POST /api/token/create`: 创建新 Token。
*   `POST /api/token/delete`: 删除 Token。

## 📂 数据存储结构 (KV)

数据存储在绑定的 `MY_KV` 中：

| Key | 类型 | 说明 |
| :--- | :--- | :--- |
| `pwd` | String | 管理员登录密码（明文存储，请确保 Worker URL 安全） |
| `tokens` | JSON Array | 存储所有 Token 的列表 |

## 📄 License

MIT License. Feel free to use and modify.
