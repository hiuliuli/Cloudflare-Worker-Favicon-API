const DEFAULT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#cbd5e1"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!env.MY_KV) {
      return new Response(renderError("KV Database 'MY_KV' is not bound."), {
        headers: { "Content-Type": "text/html" },
      });
    }

    if (path === '/get') return handleGetFavicon(request, env);
    if (path.startsWith('/api/')) return handleApiRequest(request, env);

    return handleHtmlRender(request, env);
  },
};

// --- Logic: Icon Fetching ---

async function handleGetFavicon(request, env) {
  const url = new URL(request.url);
  const rawTargetUrl = url.searchParams.get('url');
  const token = url.searchParams.get('token');
  const size = url.searchParams.get('size') || '64';

  if (!token) return jsonResponse({ error: 'Token required' }, 401);
  
  // Verify Token
  const allTokens = await env.MY_KV.get('tokens', { type: 'json' });
  const isValid = allTokens && Array.isArray(allTokens) && allTokens.some(t => t.token === token);
  if (!isValid) return jsonResponse({ error: 'Invalid Token' }, 403);
  if (!rawTargetUrl) return jsonResponse({ error: 'URL parameter required' }, 400);

  // Normalize URL
  const targetUrl = normalizeUrl(rawTargetUrl);
  if (!targetUrl) return jsonResponse({ error: 'Invalid URL format' }, 400);

  // 1. Try Scraping HTML (Priority)
  try {
    const scrapedIconUrl = await getIconFromHtml(targetUrl);
    if (scrapedIconUrl) {
      const sRes = await fetch(scrapedIconUrl, { 
        headers: { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': targetUrl
        }
      });
      if (sRes.ok && sRes.headers.get("content-type")?.includes("image")) {
        return new Response(sRes.body, {
          headers: { 
            "Content-Type": sRes.headers.get("content-type"),
            "Cache-Control": "public, max-age=86400"
          }
        });
      }
    }
  } catch (e) {}

  // 2. Try Google S2 (Fallback)
  try {
    const googleUrl = `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(targetUrl)}&sz=${size}`;
    const gRes = await fetch(googleUrl);
    if (gRes.ok && gRes.headers.get("content-type")?.includes("image")) {
       return new Response(gRes.body, {
         headers: { 
           "Content-Type": gRes.headers.get("content-type"),
           "Cache-Control": "public, max-age=86400" 
         }
       });
    }
  } catch (e) {}

  // 3. Default Icon
  return new Response(DEFAULT_ICON_SVG, {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" }
  });
}

function normalizeUrl(input) {
  let urlStr = input.trim();
  if (!urlStr.match(/^[a-zA-Z]+:\/\//)) {
      urlStr = 'http://' + urlStr;
  }
  try {
      return new URL(urlStr).href;
  } catch (e) {
      return null;
  }
}

async function getIconFromHtml(targetUrl) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); 
    
    // Enhanced headers
    const response = await fetch(targetUrl, {
      headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': targetUrl,
          'Connection': 'keep-alive'
      },
      redirect: 'follow',
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) return null;

    let iconLink = null;
    await new HTMLRewriter()
      .on('link[rel~="icon"]', {
        element(element) {
          const href = element.getAttribute('href');
          if (href && !iconLink) iconLink = href;
        }
      })
      .on('link[rel~="shortcut icon"]', {
        element(element) {
          const href = element.getAttribute('href');
          if (href && !iconLink) iconLink = href;
        }
      })
      .transform(response)
      .text();

    if (!iconLink) {
        const u = new URL(targetUrl);
        return `${u.protocol}//${u.hostname}${u.port ? ':'+u.port : ''}/favicon.ico`;
    }
    
    return new URL(iconLink, targetUrl).href;
  } catch (e) {
    return null;
  }
}

// --- API ---

async function handleApiRequest(request, env) {
  const url = new URL(request.url);
  const method = request.method;

  if (method === 'POST') {
    let body;
    try { body = await request.json(); } catch(e) { return jsonResponse({error:'Invalid JSON'}, 400); }

    if (url.pathname === '/api/setup') {
      const currentPwd = await env.MY_KV.get('pwd');
      if (currentPwd) return jsonResponse({ error: 'Initialized' }, 400);
      if (!body.password) return jsonResponse({ error: 'Password empty' }, 400);
      await env.MY_KV.put('pwd', body.password);
      return jsonResponse({ success: true });
    }

    if (url.pathname === '/api/login') {
      const storedPwd = await env.MY_KV.get('pwd');
      if (body.password === storedPwd) return jsonResponse({ success: true });
      return jsonResponse({ error: 'Invalid password' }, 401);
    }

    const authError = await checkAuth(request, env);
    if (authError) return authError;

    if (url.pathname === '/api/token/create') {
      const newToken = {
        name: body.name || 'Unnamed',
        token: crypto.randomUUID(),
        created: new Date().toISOString().split('T')[0]
      };
      let list = await env.MY_KV.get('tokens', { type: 'json' });
      if (!list || !Array.isArray(list)) list = [];
      list.push(newToken);
      await env.MY_KV.put('tokens', JSON.stringify(list));
      return jsonResponse({ success: true, token: newToken });
    }

    if (url.pathname === '/api/token/delete') {
      let list = await env.MY_KV.get('tokens', { type: 'json' });
      if (!list || !Array.isArray(list)) list = [];
      const newList = list.filter(t => t.token !== body.token);
      await env.MY_KV.put('tokens', JSON.stringify(newList));
      return jsonResponse({ success: true });
    }
  }

  if (method === 'GET' && url.pathname === '/api/tokens') {
    const authError = await checkAuth(request, env);
    if (authError) return authError;
    const list = await env.MY_KV.get('tokens', { type: 'json' });
    return jsonResponse({ tokens: list || [] });
  }

  return jsonResponse({ error: 'Not found' }, 404);
}

async function checkAuth(request, env) {
    const authHeader = request.headers.get('Authorization');
    const storedPwd = await env.MY_KV.get('pwd');
    if (!authHeader || authHeader !== `Bearer ${storedPwd}`) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
    }
    return null;
}

// --- HTML Rendering ---

async function handleHtmlRender(request, env) {
  const pwd = await env.MY_KV.get('pwd');
  const mode = !pwd ? 'setup' : 'app';
  
  return new Response(renderFullPage(mode, request.url), { 
    headers: { 'Content-Type': 'text/html; charset=UTF-8' } 
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function renderError(msg) {
  return `<h3>Error: ${msg}</h3>`;
}

// --- Frontend ---

function renderFullPage(initialMode, currentUrl) {
  const domain = currentUrl ? new URL(currentUrl).origin : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Favicon Service</title>
    <style>
        :root {
            --primary: #2563eb;
            --primary-hover: #1d4ed8;
            --success: #10b981;
            --success-hover: #059669;
            --bg: #f8fafc;
            --surface: rgba(255, 255, 255, 0.85);
            --border: #e2e8f0;
            --text-main: #1e293b;
            --text-sub: #64748b;
            --danger: #ef4444;
            --danger-bg: #fee2e2;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg);
            background-image: radial-gradient(#e5e7eb 1px, transparent 1px);
            background-size: 24px 24px;
            color: var(--text-main);
            display: flex;
            flex-direction: column;
            min-height: 100vh;
            padding: 2rem 1rem;
        }
        .hidden { display: none !important; }
        .glass {
            background: var(--surface);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255,255,255,0.6);
            box-shadow: 0 10px 15px -3px rgba(0,0,0,0.05), 0 4px 6px -2px rgba(0,0,0,0.025);
            border-radius: 16px;
        }
        
        /* Buttons */
        .btn {
            cursor: pointer;
            padding: 0 1.2rem;
            height: 40px;
            border-radius: 8px;
            font-weight: 600;
            font-size: 0.95rem;
            border: none;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            position: relative;
        }
        .btn-primary { background: var(--primary); color: white; }
        .btn-primary:hover:not(:disabled) { background: var(--primary-hover); transform: translateY(-1px); }
        .btn-primary:disabled { opacity: 0.7; cursor: not-allowed; }
        
        .btn-success { background: var(--success); color: white; }
        .btn-success:hover:not(:disabled) { background: var(--success-hover); transform: translateY(-1px); }
        .btn-success:disabled { opacity: 0.7; cursor: not-allowed; }

        .btn-outline { background: white; border: 1px solid var(--border); color: var(--text-sub); }
        .btn-outline:hover { border-color: var(--primary); color: var(--primary); }
        
        .btn-logout { background: white; border: 1px solid var(--border); color: var(--text-sub); }
        .btn-logout:hover { border-color: var(--danger); color: var(--danger); }

        .btn-delete { 
            background: transparent; border: 1px solid var(--danger-bg); color: var(--danger); 
            height: 28px; padding: 0 0.75rem; font-size: 0.8rem; transition: all 0.2s; min-width: 60px;
        }
        .btn-delete:hover:not(:disabled) { 
            background: var(--danger); color: white; border-color: var(--danger);
            box-shadow: 0 2px 4px rgba(239, 68, 68, 0.2);
        }
        .btn-delete:disabled { opacity: 0.6; cursor: wait; }

        .loader {
            width: 18px; height: 18px; border: 2px solid currentColor;
            border-bottom-color: transparent; border-radius: 50%;
            display: inline-block; animation: rotation 1s linear infinite;
        }
        @keyframes rotation { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

        /* INPUTS */
        .input-group { position: relative; width: 100%; margin-bottom: 1.5rem; }
        
        .input {
            width: 100%;
            height: 46px; 
            line-height: normal;
            padding: 0 1rem;
            border-radius: 8px;
            border: 1px solid var(--border);
            outline: none;
            transition: border-color 0.2s, box-shadow 0.2s;
            font-size: 1rem;
            background: white;
            color: var(--text-main);
        }
        .input.has-icon { padding-right: 42px; }
        .input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1); }
        
        .toggle-pwd {
            position: absolute;
            right: 10px;
            top: 0; bottom: 0; margin: auto;
            height: 28px; width: 28px;
            background: none; border: none; cursor: pointer; color: var(--text-sub);
            padding: 0; display: flex; align-items: center; justify-content: center;
            border-radius: 4px; transition: color 0.2s;
        }
        .toggle-pwd:hover { color: var(--primary); background: #f1f5f9; }

        /* Layouts */
        .center-screen { margin: auto; width: 100%; max-width: 400px; text-align: center; }
        .dashboard-container { width: 100%; max-width: 900px; margin: 0 auto; }
        
        .header-logo {
            width: 60px; height: 60px; background: #dbeafe; color: var(--primary);
            border-radius: 50%; display: flex; align-items: center; justify-content: center;
            margin: 0 auto 1.5rem;
        }
        h1 { font-size: 1.8rem; font-weight: 700; margin-bottom: 0.5rem; letter-spacing: -0.025em; }
        p.desc { color: var(--text-sub); margin-bottom: 2rem; }

        .top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
        
        /* Fixed: Vertical alignment of icon next to title */
        .top-bar h2 { font-size: 1.5rem; display: flex; align-items: center; gap: 0.75rem; }
        .top-bar h2 span { display: flex; align-items: center; justify-content: center; }

        .card { padding: 1.5rem; margin-bottom: 1.5rem; }
        .card h3 { font-size: 1.1rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem; color: var(--text-main); }
        
        .code-block {
            background: #1e293b; color: #e2e8f0; padding: 1rem; border-radius: 8px;
            font-family: monospace; font-size: 0.85rem; overflow-x: auto; white-space: nowrap; margin-bottom: 1rem;
        }
        .hl-method { color: #4ade80; font-weight: bold; }
        .hl-param { color: #facc15; }
        .hl-val { color: #93c5fd; }

        .table-wrap { overflow-x: auto; border-radius: 8px; border: 1px solid var(--border); }
        table { width: 100%; border-collapse: collapse; font-size: 0.9rem; background: white; }
        th { background: #f1f5f9; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.05em; color: var(--text-sub); padding: 0.75rem 1rem; text-align: left; font-weight: 600; }
        td { padding: 0.75rem 1rem; border-top: 1px solid var(--border); color: var(--text-main); vertical-align: middle; }
        tr:hover td { background: #f8fafc; }
        .token-cell { font-family: monospace; background: #f1f5f9; padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.8rem; user-select: all; color: #475569; }

        #toast {
            position: fixed; bottom: 40px; left: 50%; transform: translateX(-50%) translateY(100px);
            background: #1e293b; color: white; padding: 0.75rem 2rem; border-radius: 50px;
            box-shadow: 0 10px 25px -3px rgba(0,0,0,0.2); opacity: 0;
            transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            font-size: 0.95rem; font-weight: 500; z-index: 100; white-space: nowrap;
        }
        #toast.show { transform: translateX(-50%) translateY(0); opacity: 1; }
        .fade-in { animation: fadeIn 0.4s ease-out forwards; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    </style>
</head>
<body>

    <div id="toast">Message</div>

    <!-- Setup -->
    <div id="view-setup" class="center-screen glass fade-in hidden" style="padding: 3rem 2.5rem;">
        <div class="header-logo"><svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg></div>
        <h1>Welcome</h1>
        <p class="desc">Set an admin password to secure your API.</p>
        <form onsubmit="handleSetup(event)">
            <div class="input-group">
                <input type="password" id="setup-pwd" class="input has-icon" placeholder="Create Password" required>
                <button type="button" class="toggle-pwd" onclick="togglePwd('setup-pwd', this)">
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                </button>
            </div>
            <button type="submit" class="btn btn-primary" style="width: 100%; height: 46px;">Initialize Service</button>
        </form>
    </div>

    <!-- Login -->
    <div id="view-login" class="center-screen glass fade-in hidden" style="padding: 3rem 2.5rem;">
        <div class="header-logo"><svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"></path></svg></div>
        <h1>Login</h1>
        <p class="desc">Enter your admin password to continue.</p>
        <form onsubmit="handleLogin(event)">
            <div class="input-group">
                <input type="password" id="login-pwd" class="input has-icon" placeholder="Password" required>
                <button type="button" class="toggle-pwd" onclick="togglePwd('login-pwd', this)">
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                </button>
            </div>
            <button type="submit" class="btn btn-primary" style="width: 100%; height: 46px;">Access Dashboard</button>
        </form>
    </div>

    <!-- Dashboard -->
    <div id="view-dashboard" class="dashboard-container fade-in hidden">
        <div class="top-bar">
            <h2>
                <span style="color:var(--primary)">
                   <svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                </span>
                Favicon Service
            </h2>
            <button onclick="logout()" class="btn btn-logout" style="font-size:0.85rem; height: 36px;">
                Logout
            </button>
        </div>

        <!-- API Tester -->
        <div class="card glass">
            <h3>
                <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path></svg>
                API Usage
            </h3>
            <div class="code-block">
                <span class="hl-method">GET</span> ${domain}/get?token=<span class="hl-val">{TOKEN}</span>&size=<span class="hl-val">64</span>&url=<span class="hl-param">example.com</span>
            </div>
            <div style="display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap;">
                <div style="flex:1; min-width: 200px;">
                    <label style="font-size:0.75rem; font-weight:bold; color:var(--text-sub); display:block; margin-bottom:4px;">TEST URL</label>
                    <input type="text" id="test-url" class="input" value="github.com" placeholder="example.com">
                </div>
                <div style="width: 80px;">
                    <label style="font-size:0.75rem; font-weight:bold; color:var(--text-sub); display:block; margin-bottom:4px;">SIZE</label>
                    <input type="number" id="test-size" class="input" value="64">
                </div>
                <button id="btn-test" onclick="runTest()" class="btn btn-primary" style="height: 46px; padding: 0 1.5rem;">Test</button>
            </div>
            <div id="test-result" style="margin-top: 1rem; padding: 0.75rem; background: white; border: 1px solid var(--border); border-radius: 8px; display: none; align-items: center; gap: 1rem;">
                <img id="test-img" src="" width="32" height="32" style="border-radius: 4px; border: 1px solid #eee;">
                <a id="test-link" href="#" target="_blank" style="font-size: 0.85rem; color: var(--primary); word-break: break-all;"></a>
            </div>
        </div>

        <!-- Token Manager -->
        <div class="card glass">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                <h3>
                    <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"></path></svg>
                    Access Tokens
                </h3>
                <div style="display:flex; gap: 0.5rem; align-items: center;">
                    <input type="text" id="new-token-name" class="input" placeholder="Token Name" style="width: 140px; height: 38px;">
                    <button id="btn-create" onclick="createToken()" class="btn btn-success" style="height: 38px;">Create</button>
                </div>
            </div>
            
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th style="width:30%">Name</th>
                            <th style="width:40%">Token</th>
                            <th style="width:20%">Created</th>
                            <th style="width:10%; text-align:right">Action</th>
                        </tr>
                    </thead>
                    <tbody id="token-list"></tbody>
                </table>
            </div>
            <div id="empty-msg" class="hidden" style="text-align:center; padding: 1.5rem; color: var(--text-sub); font-size: 0.9rem;">
                No tokens found. Create one to use the API.
            </div>
        </div>
    </div>

<script>
    const API_ORIGIN = '${domain}';
    let localPwd = localStorage.getItem('app_pwd');
    let tokens = [];
    const serverMode = '${initialMode}';

    function init() {
        if (serverMode === 'setup') {
            show('view-setup');
        } else {
            if (localPwd) {
                show('view-dashboard');
                loadTokens();
            } else {
                show('view-login');
            }
        }
    }

    function show(id) {
        ['view-setup', 'view-login', 'view-dashboard'].forEach(v => {
            const el = document.getElementById(v);
            if (v === id) el.classList.remove('hidden');
            else el.classList.add('hidden');
        });
    }

    // Toggle Password
    function togglePwd(inputId, btn) {
        const input = document.getElementById(inputId);
        const isPwd = input.type === 'password';
        input.type = isPwd ? 'text' : 'password';
        
        if(isPwd) {
            btn.innerHTML = \`<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path></svg>\`;
        } else {
            btn.innerHTML = \`<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>\`;
        }
    }

    function setLoading(btn, isLoading) {
        if (isLoading) {
            btn.dataset.originalHtml = btn.innerHTML;
            btn.innerHTML = '<span class="loader"></span>';
            btn.disabled = true;
        } else {
            btn.innerHTML = btn.dataset.originalHtml || btn.innerHTML;
            btn.disabled = false;
        }
    }

    async function handleSetup(e) {
        e.preventDefault();
        const btn = e.submitter;
        const pwd = document.getElementById('setup-pwd').value;
        setLoading(btn, true);
        const res = await apiCall('/api/setup', 'POST', { password: pwd });
        setLoading(btn, false);

        if (res.success) {
            localStorage.setItem('app_pwd', pwd);
            localPwd = pwd;
            show('view-dashboard');
            loadTokens();
            toast('Setup complete');
        } else {
            toast(res.error || 'Setup failed');
        }
    }

    async function handleLogin(e) {
        e.preventDefault();
        const btn = e.submitter;
        const pwd = document.getElementById('login-pwd').value;
        setLoading(btn, true);
        const res = await apiCall('/api/login', 'POST', { password: pwd });
        setLoading(btn, false);

        if (res.success) {
            localStorage.setItem('app_pwd', pwd);
            localPwd = pwd;
            show('view-dashboard');
            loadTokens();
        } else {
            toast('Invalid password');
        }
    }

    function logout() {
        localStorage.removeItem('app_pwd');
        localPwd = null;
        document.getElementById('login-pwd').value = '';
        show('view-login');
        toast('Logged out');
    }

    async function loadTokens() {
        const res = await apiCall('/api/tokens', 'GET');
        if (res.error) {
            if(res.status === 401) logout();
            return;
        }
        tokens = res.tokens || [];
        renderTable();
    }

    async function createToken() {
        const nameInput = document.getElementById('new-token-name');
        const btn = document.getElementById('btn-create');
        const name = nameInput.value.trim();
        if (!name) return toast('Please enter a name');
        
        setLoading(btn, true);
        const res = await apiCall('/api/token/create', 'POST', { name });
        setLoading(btn, false);
        
        if (res.success) {
            tokens.push(res.token);
            renderTable();
            nameInput.value = '';
            toast('Token created successfully');
        }
    }

    async function deleteToken(tokenStr, btn) {
        if(!confirm('Are you sure you want to delete this token?')) return;
        setLoading(btn, true);
        const res = await apiCall('/api/token/delete', 'POST', { token: tokenStr });
        setLoading(btn, false);
        
        if (res.success) {
            tokens = tokens.filter(t => t.token !== tokenStr);
            renderTable();
            toast('Token deleted');
        }
    }

    function renderTable() {
        const tbody = document.getElementById('token-list');
        const emptyMsg = document.getElementById('empty-msg');
        if (tokens.length === 0) {
            tbody.innerHTML = '';
            emptyMsg.classList.remove('hidden');
            return;
        }
        emptyMsg.classList.add('hidden');
        tbody.innerHTML = tokens.map(t => \`
            <tr>
                <td style="font-weight:500">\${escapeHtml(t.name)}</td>
                <td><span class="token-cell">\${t.token}</span></td>
                <td style="color:var(--text-sub); font-size:0.85rem">\${t.created}</td>
                <td style="text-align:right">
                    <button onclick="deleteToken('\${t.token}', this)" class="btn btn-delete">Delete</button>
                </td>
            </tr>
        \`).join('');
    }

    async function runTest() {
        if (tokens.length === 0) return toast('Create a token first');
        const btn = document.getElementById('btn-test');
        const urlVal = document.getElementById('test-url').value;
        const sizeVal = document.getElementById('test-size').value;
        const token = tokens[0].token;
        const finalUrl = \`\${API_ORIGIN}/get?token=\${token}&size=\${sizeVal}&url=\${encodeURIComponent(urlVal)}\`;
        
        setLoading(btn, true);
        const img = new Image();
        img.onload = () => { showResult(finalUrl); setLoading(btn, false); };
        img.onerror = () => { showResult(finalUrl); setLoading(btn, false); };
        img.src = finalUrl;
    }

    function showResult(url) {
        const resBox = document.getElementById('test-result');
        const imgEl = document.getElementById('test-img');
        const link = document.getElementById('test-link');
        imgEl.src = url;
        link.textContent = url;
        link.href = url;
        resBox.style.display = 'flex';
    }

    async function apiCall(path, method, body) {
        const opts = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + localPwd
            }
        };
        if (body) opts.body = JSON.stringify(body);
        try {
            const req = await fetch(path, opts);
            const data = await req.json();
            data.status = req.status;
            return data;
        } catch (e) {
            return { error: 'Network error', status: 500 };
        }
    }

    function toast(msg) {
        const el = document.getElementById('toast');
        el.textContent = msg;
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 3000);
    }

    function escapeHtml(text) {
        if (!text) return text;
        return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    init();
</script>
</body>
</html>`;
}
