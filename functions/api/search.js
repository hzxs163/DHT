// Pages Functions - /api/search

export async function onRequest(context) {
  const { request, waitUntil } = context;
  const url = new URL(request.url);
  const query = url.searchParams.get('q');

  // ===== 临时测试：直接看吴签磁力返回了什么 =====
  if (url.searchParams.get('test') === 'wuqian') {
    const res = await fetch('https://wuqianto.cc/search?keyword=%E6%AF%92%E6%B6%B2', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Referer': 'https://wuqianto.cc/',
      },
    });
    const html = await res.text();
    return jsonResponse({
      status: res.status,
      length: html.length,
      hasPanel: html.includes('panel panel-default'),
      hasDetail: html.includes('/detail/'),
      hasSearchForm: html.includes('search-form'),
      hasChallenge: html.includes('Checking your browser'),
      preview: html.substring(0, 500),
    });
  }
  // ===== 测试结束 =====

  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const sort = url.searchParams.get('sort') || 'relevance';

  if (!query) {
    return jsonResponse({ error: 'Missing query parameter' }, 400);
  }

  const startTime = Date.now();

  try {
    const [omagnetResult, wuqianResult] = await Promise.allSettled([
      fetchFrom0Magnet(query, sort, waitUntil),
      fetchFromWuqian(query, waitUntil),
    ]);

    const allItems = [];

    if (omagnetResult.status === 'fulfilled') {
      allItems.push(...omagnetResult.value);
    } else {
      console.error('ØMagnet failed:', omagnetResult.reason);
    }

    if (wuqianResult.status === 'fulfilled') {
      allItems.push(...wuqianResult.value);
    } else {
      console.error('Wuqian failed:', wuqianResult.reason);
    }

    // 去重：优先按 info_hash，没有 hash 时按名称
    const seen = new Set();
    const deduped = [];
    for (const item of allItems) {
      // 跳过吴签磁力的调试标记项
      if (item.name === '__WUQIAN_CHALLENGE__') continue;
      if (item.name && item.name.startsWith('__WUQIAN_NO_PANEL__')) continue;

      const hashMatch = item.magnet && item.magnet.match(/btih:([a-zA-Z0-9]{32})/);
      const key = hashMatch ? hashMatch[1].toLowerCase() : item.name;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(item);
      }
    }

    const timing = Date.now() - startTime;

    const wuqianChallenge = wuqianResult.status === 'fulfilled' &&
      wuqianResult.value.some(item => item.name === '__WUQIAN_CHALLENGE__');

    const wuqianNoPanel = wuqianResult.status === 'fulfilled' &&
      wuqianResult.value.some(item => item.name && item.name.startsWith('__WUQIAN_NO_PANEL__'));

    const wuqianNoPanelInfo = wuqianResult.status === 'fulfilled'
      ? (wuqianResult.value.find(item => item.name && item.name.startsWith('__WUQIAN_NO_PANEL__'))?.name || null)
      : null;

    return jsonResponse({
      results: deduped,
      total: deduped.length,
      timing,
      debug: {
        omagnetStatus: omagnetResult.status,
        omagnetCount: omagnetResult.status === 'fulfilled' ? omagnetResult.value.length : 0,
        wuqianStatus: wuqianResult.status,
        wuqianCount: wuqianResult.status === 'fulfilled' ? wuqianResult.value.length : 0,
        wuqianChallenge: wuqianChallenge,
        wuqianNoPanel: wuqianNoPanel,
        wuqianNoPanelInfo: wuqianNoPanelInfo,
        wuqianError: wuqianResult.status === 'rejected' ? String(wuqianResult.reason) : null,
        totalBeforeDedup: allItems.length,
      },
    });

  } catch (err) {
    console.error('Search error:', err);
    return jsonResponse({ error: 'Search failed', detail: String(err) }, 502);
  }
}

// ========== ØMagnet 数据源 ==========
async function fetchFrom0Magnet(query, sort, waitUntil) {
  const searchUrl = `https://0magnet.com/search?q=${encodeURIComponent(query)}&sort=${sort}`;
  const searchHtml = await fetchWithCache(searchUrl, 3600, waitUntil);

  const items = await parse0MagnetSearchResults(searchHtml);
  if (items.length === 0) return [];

  return await batchFetch0MagnetDetails(items, 5, waitUntil);
}

async function parse0MagnetSearchResults(html) {
  const items = [];
  let currentItem = null;

  const rewriter = new HTMLRewriter()
    .on('table.file-list tbody tr', {
      element(el) {
        if (currentItem) items.push(currentItem);
        currentItem = { name: '', size: '', date: '', detailPath: '', source: '0magnet' };
      },
    })
    .on('td.result-title a', {
      element(el) {
        if (!currentItem) return;
        const href = el.getAttribute('href');
        if (href) currentItem.detailPath = href;
      },
      text(text) {
        if (!currentItem) return;
        currentItem.name += text.text;
      },
    })
    .on('td.result-meta div', {
      text(text) {
        if (!currentItem) return;
        const t = text.text.trim();
        if (!t) return;
        if (t.includes('GB') || t.includes('MB') || t.includes('KB') || t.includes('B')) {
          if (!currentItem.size) currentItem.size = t;
        } else if (t.match(/\d{4}-\d{2}-\d{2}/)) {
          currentItem.date = t;
        }
      },
    });

  await rewriter.transform(new Response(html)).text();
  if (currentItem && currentItem.name) items.push(currentItem);
  return items;
}

async function batchFetch0MagnetDetails(items, concurrency, waitUntil) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const promises = batch.map(async (item) => {
      try {
        const detailUrl = `https://0magnet.com${item.detailPath}`;
        const detailHtml = await fetchWithCache(detailUrl, 86400, waitUntil);
        const magnet = extractMagnetFrom0Magnet(detailHtml);
        return { ...item, magnet, detailUrl };
      } catch (err) {
        console.error(`0Magnet detail failed: ${item.detailPath}`, err);
        return { ...item, magnet: '', detailUrl: '' };
      }
    });
    results.push(...(await Promise.all(promises)));
  }
  return results;
}

function extractMagnetFrom0Magnet(html) {
  const match = html.match(/id="input-magnet"[^>]*value="([^"]+)"/);
  if (match) {
    const full = match[1]
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    const hashMatch = full.match(/xt=urn:btih:([a-zA-Z0-9]+)/);
    if (hashMatch) return `magnet:?xt=urn:btih:${hashMatch[1]}`;
  }
  return '';
}

// ========== 吴签磁力数据源 ==========
async function fetchFromWuqian(query, waitUntil) {
  const searchUrl = `https://wuqianto.cc/search?keyword=${encodeURIComponent(query)}&sos=relevance&sofs=all&sot=all&soft=all&som=auto&p=1`;
  const html = await fetchWithCache(searchUrl, 3600, waitUntil);

  // 检测 Cloudflare 质询页
  if (html.includes('Checking your browser') || html.includes('cf-browser-verification')) {
    return [{ name: '__WUQIAN_CHALLENGE__', size: '', date: '', magnet: '', detailUrl: '', source: 'wuqian' }];
  }

  return parseWuqianResults(html);
}

function parseWuqianResults(html) {
  const items = [];

  // 调试：先看 HTML 里有没有关键特征
  const hasPanel = html.includes('panel panel-default');
  const hasDetailLink = html.includes('/detail/');
  const hasSearchForm = html.includes('search-form');

  if (!hasPanel) {
    return [{
      name: `__WUQIAN_NO_PANEL__ len=${html.length} hasDetail=${hasDetailLink} hasSearchForm=${hasSearchForm}`,
      size: '',
      date: '',
      magnet: '',
      detailUrl: '',
      source: 'wuqian',
    }];
  }

  // 匹配每个 panel 块
  const panelRegex = /<div class="panel panel-default border-radius">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
  let panelMatch;

  while ((panelMatch = panelRegex.exec(html)) !== null) {
    const panel = panelMatch[1];

    const titleMatch = panel.match(/<a href="(\/detail\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;

    const detailPath = titleMatch[1];
    let name = titleMatch[2].replace(/<[^>]+>/g, '').trim();
    if (!name) continue;

    const hashMatch = detailPath.match(/\/detail\/[^/]+\/([a-zA-Z0-9]+)/);
    if (!hashMatch) continue;
    const infoHash = hashMatch[1];

    const sizeMatch = panel.match(/文件大小:\s*<span>([^<]+)<\/span>/);
    const dateMatch = panel.match(/收录时间:\s*<span>([^<]+)<\/span>/);

    items.push({
      name,
      size: sizeMatch ? sizeMatch[1].trim() : '',
      date: dateMatch ? dateMatch[1].trim() : '',
      magnet: `magnet:?xt=urn:btih:${infoHash}`,
      detailUrl: `https://wuqianto.cc${detailPath}`,
      source: 'wuqian',
    });
  }

  return items;
}

// ========== 通用缓存与响应 ==========
async function fetchWithCache(url, ttl, waitUntil) {
  const cache = caches.default;
  const cacheKey = new Request(url, { method: 'GET' });

  let response = await cache.match(cacheKey);
  if (response) return response.text();

  response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Referer': 'https://wuqianto.cc/',
    },
  });

  const html = await response.text();

  if (response.ok) {
    const cacheResponse = new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': `public, max-age=${ttl}`,
      },
    });
    if (waitUntil) waitUntil(cache.put(cacheKey, cacheResponse));
    else await cache.put(cacheKey, cacheResponse);
  }

  return html;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
