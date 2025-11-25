const DEFAULT_ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640">
  <path fill="#999" d="M415.9 344L225 344C227.9 408.5 242.2 467.9 262.5 511.4C273.9 535.9 286.2 553.2 297.6 563.8C308.8 574.3 316.5 576 320.5 576C324.5 576 332.2 574.3 343.4 563.8C354.8 553.2 367.1 535.8 378.5 511.4C398.8 467.9 413.1 408.5 416 344zM224.9 296L415.8 296C413 231.5 398.7 172.1 378.4 128.6C367 104.2 354.7 86.8 343.3 76.2C332.1 65.7 324.4 64 320.4 64C316.4 64 308.7 65.7 297.5 76.2C286.1 86.8 273.8 104.2 262.4 128.6C242.1 172.1 227.8 231.5 224.9 296zM176.9 296C180.4 210.4 202.5 130.9 234.8 78.7C142.7 111.3 74.9 195.2 65.5 296L176.9 296zM65.5 344C74.9 444.8 142.7 528.7 234.8 561.3C202.5 509.1 180.4 429.6 176.9 344L65.5 344zM463.9 344C460.4 429.6 438.3 509.1 406 561.3C498.1 528.6 565.9 444.8 575.3 344L463.9 344zM575.3 296C565.9 195.2 498.1 111.3 406 78.7C438.3 130.9 460.4 210.4 463.9 296L575.3 296z"/>
</svg>
`;

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const targetUrlStr = url.searchParams.get("url");
    const userToken = (url.searchParams.get("token") || "").trim();
    const sizeParam = url.searchParams.get("size");

    if (!targetUrlStr) {
      return new Response("Not Found 404", { status: 404 });
    }

    const systemToken = (env.TOKEN || env.token || "").trim();
    if (systemToken) {
      if (!userToken || userToken !== systemToken) {
        return new Response("Error: 403 Forbidden (Invalid Token)", { status: 403 });
      }
    }

    let targetSize = sizeParam ? parseInt(sizeParam) : null;
    if (targetSize && (isNaN(targetSize) || targetSize < 0)) targetSize = null;
    if (targetSize > 512) targetSize = 512;

    const returnDefaultIcon = () => {
      let svgContent = DEFAULT_ICON_SVG;
      if (targetSize) {
        svgContent = svgContent.replace('<svg', `<svg width="${targetSize}" height="${targetSize}"`);
      }
      return new Response(svgContent, {
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "public, max-age=3600",
          "Access-Control-Allow-Origin": "*"
        },
      });
    };

    let targetUrl;
    try {
      targetUrl = new URL(targetUrlStr.startsWith("http") ? targetUrlStr : `https://${targetUrlStr}`);
    } catch (e) {
      return returnDefaultIcon();
    }

    const cacheKey = new Request(url.toString(), request);
    const cache = caches.default;
    const cachedRes = await cache.match(cacheKey);
    if (cachedRes) return cachedRes;

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
      "Referer": targetUrl.origin
    };

    const fetchWithTimeout = async (resource, options = {}, timeout = 5000) => {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetch(resource, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
      } catch (error) {
        clearTimeout(id);
        throw error;
      }
    };

    async function getIconData() {
      try {
        const targetResp = await fetchWithTimeout(targetUrl.href, { headers }, 4000); // 缩短超时，给 fallback 留时间
        
        let finalIconUrl = null;
        const contentType = targetResp.headers.get("content-type");

        if (contentType && contentType.includes("image")) {
           finalIconUrl = targetUrl.href;
        } else if (targetResp.ok) {
           let iconHref = null;

           const rewriter = new HTMLRewriter()
             .on('link[rel="apple-touch-icon"]', { element(e) { if (!iconHref) iconHref = e.getAttribute("href"); } })
             .on('link[rel="apple-touch-icon-precomposed"]', { element(e) { if (!iconHref) iconHref = e.getAttribute("href"); } })
             .on('link[rel="icon"]', { element(e) { if (!iconHref) iconHref = e.getAttribute("href"); } })
             .on('link[rel="shortcut icon"]', { element(e) { if (!iconHref) iconHref = e.getAttribute("href"); } });
           
           await rewriter.transform(targetResp).text();

           if (iconHref) {
             finalIconUrl = new URL(iconHref, targetUrl.href).href;
           }
        }

        if (!finalIconUrl && targetResp.ok) {
           finalIconUrl = new URL("/favicon.ico", targetUrl.origin).href;
        }

        if (finalIconUrl) {
           const iconResp = await fetchWithTimeout(finalIconUrl, { headers }, 4000);
           if (iconResp.ok && iconResp.headers.get("content-type")?.includes("image")) {
              const buf = await iconResp.arrayBuffer();
              return { buffer: buf, type: iconResp.headers.get("content-type") };
           }
        }
      } catch (e) {
        // 忽略 fetch 错误，继续向下执行 fallback
        // console.log("Direct fetch failed, trying fallback...");
      }

      return null; 
    }

    try {
      let iconData = await getIconData();

      if (!iconData) {
        try {
          const fallbackSize = targetSize ? targetSize : 64; 
          const googleApiUrl = `https://www.google.com/s2/favicons?domain=${targetUrl.hostname}&sz=${fallbackSize}`;
          
          const gResp = await fetchWithTimeout(googleApiUrl, { headers }, 4000);
          if (gResp.ok && gResp.headers.get("content-type")?.includes("image")) {
             const buf = await gResp.arrayBuffer();
             iconData = { buffer: buf, type: gResp.headers.get("content-type") };
          }
        } catch (e) {
           // Fallback 也失败了，那就真没办法了
        }
      }

      if (!iconData) throw new Error("All methods failed");

      let finalBody;
      let finalContentType;

      if (targetSize) {
        const base64Img = arrayBufferToBase64(iconData.buffer);
        finalBody = `
<svg xmlns="http://www.w3.org/2000/svg" width="${targetSize}" height="${targetSize}" viewBox="0 0 ${targetSize} ${targetSize}">
  <image href="data:${iconData.type};base64,${base64Img}" width="${targetSize}" height="${targetSize}" style="image-rendering: auto;" />
</svg>`;
        finalContentType = "image/svg+xml";
      } else {
        finalBody = iconData.buffer;
        finalContentType = iconData.type;
      }

      const newResp = new Response(finalBody, {
        headers: {
          "Content-Type": finalContentType,
          "Cache-Control": "public, max-age=86400",
          "Access-Control-Allow-Origin": "*"
        }
      });
      
      ctx.waitUntil(cache.put(cacheKey, newResp.clone()));
      return newResp;

    } catch (err) {
      return returnDefaultIcon();
    }
  },
};
