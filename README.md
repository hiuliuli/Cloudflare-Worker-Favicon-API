# Cloudflare-Worker-Favicon-API
一个基于 Cloudflare Workers 的高性能网站图标获取工具。它能够自动解析目标网站 HTML，获取最佳图标，支持防盗链 Token 验证、自定义尺寸缩放、智能缓存以及优雅的错误回退。
## ✨ 功能特性

*   **⚡️ 极速响应**：运行在 Cloudflare 边缘节点，利用全球 CDN 缓存。
*   **🔍 智能解析**：自动解析 HTML 中的 `<link rel="icon">`、`apple-touch-icon` 等标签，解析失败自动回退至 `/favicon.ico`。
*   **📐 尺寸调整**：支持通过 `size` 参数强制定义图标尺寸（使用 SVG 容器封装技术，100% 兼容）。
*   **🛡️ 安全验证**：支持 Token 访问控制，防止接口被恶意滥用。
*   **🎭 隐私保护**：直接访问根路径返回 `404 Not Found`，隐藏接口真实用途。
*   **🖼️ 优雅回退**：获取失败时自动返回内置的默认图标（灰色地球 SVG），防止前端裂图。
*   **💾 自动缓存**：支持 Cloudflare Cache API，减少源站请求频率。

## 🚀 快速部署

### Cloudflare Dashboard (推荐)

1.  登录 Cloudflare Dashboard。
2.  进入 **Workers & Pages** -> **Create Application** -> **Create Worker**。
3.  命名为 `favicon-api` (或你喜欢的名字)，点击 **Deploy**。
4.  点击 **Edit Code**，将项目代码 (`worker.js`) 复制粘贴进去，保存并部署。
5.  **设置 Token (可选但推荐)**：
    *   进入 Worker 设置页面 -> **Settings** -> **Variables and Secrets**。
    *   添加变量：
        *   **Name**: `TOKEN`
        *   **Value**: 设置你的密码（例如 `my_secret_key_2025`）。
    *   点击 **Save and deploy**。

## 🛠 API 使用说明

### 基本 URL 格式

```
https://<你的Worker域名>/?url=<目标网址>&token=<你的密码>&size=<尺寸>
```

### 参数详解

| 参数 | 类型 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- | :--- |
| `url` | string | **是** | 目标网站地址 (支持 `google.com` 或 `https://google.com`) | `github.com` |
| `token`| string | **是\***| 访问令牌 (如果在后台设置了 `TOKEN` 变量则必填) | `my_secret` |
| `size` | int | 否 | 期望的图标尺寸 (像素)，最大 512。设置后会强制返回 SVG 封装的图标。 | `32` |

> \*注：如果没有提供 `url` 参数，接口将直接返回 `404 Not Found`。

### 调用示例

**1. 基础获取：**
```http
GET https://favicon-api.workers.dev/?url=https://www.github.com&token=123456
```

**2. 指定尺寸 (32x32)：**
```http
GET https://favicon-api.workers.dev/?url=bilibili.com&token=123456&size=32
```

## ⚙️ 环境变量配置

在 Cloudflare Worker 的 **Settings** -> **Variables** 中设置：

*   `TOKEN`: (可选) 接口访问密码。
    *   如果不设置该变量，则接口对公众开放，无需密码。

## 📦 常见问题 (FAQ)

### 1. 为什么浏览器能打开，但在其他服务器/Worker 调用报错？
这是因为 Cloudflare 的 Bot Fight Mode 或 WAF 拦截了服务器间的请求。
*   **解决方案 (推荐)**：如果调用方也是 Cloudflare Worker，请使用 **Service Bindings** 进行内网调用，不要使用公网 URL。
*   **替代方案**：在请求头中伪造 `User-Agent` 模拟浏览器。

### 2. 获取到的图标是 SVG 格式？
是的。为了保证 `size` 参数在所有设备上都能准确生效（且无需使用付费的 Image Resizing 功能），当指定了 `size` 时，接口会将原始图片转为 Base64 并嵌入到一个固定尺寸的 `<svg>` 容器中返回。这能确保前端显示的尺寸绝对正确。

### 3. 控制台出现 `b.getContext is not a function` 报错？
这通常与接口无关。这是浏览器安装的某些插件（如 Dark Reader、截图工具等）试图处理返回的 SVG 图片时产生的兼容性错误。在无痕模式下访问通常不会出现此错误，不影响正常使用。

### 4. 为什么直接访问域名显示 "Not Found 404"？
这是为了安全设计的。只有携带了 `?url=...` 参数的请求才会被处理。直接访问根路径会伪装成 404 页面，隐藏 API 的存在。

## 📝 License

MIT License
