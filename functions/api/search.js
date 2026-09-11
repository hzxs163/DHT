// Pages Functions - /api/search

export async function onRequest(context) {
  const { request, waitUntil } = context;
  const url = new URL(request.url);
  const query = url.searchParams.get('q');
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const sort = url.searchParams.get('sort') || 'relevance';

  if (!query) {
    return jsonResponse({ error: 'Missing query parameter' }, 400);
  }

  const startTime = Date.now();

  try {
    // 多源并行抓取
    const [omagnetResult, btsowResult] = await Promise.allSettled([
      fetchFrom0Magnet(query, sort, waitUntil),
      fetchFromBTSOW(query, waitUntil),
    ]);

    const allItems = [];

    if (omagnetResult.status === 'fulfilled') {
      allItems.push(...omagnetResult.value);
    } else {
      console.error('ØMagnet failed:', omagnetResult.reason);
    }

    if (btsowResult.status === 'fulfilled') {
      allItems.push(...btsowResult.value);
    } else {
      console.error('BTSOW failed:', btsowResult.reason);
    }

    // 去重（按 info_hash）
    const seen = new Set();
    const deduped = [];
    for (const item of allItems) {
      const hashMatch = item.magnet && item.magnet.match(/btih:([a-fA-F0-9]{40})/);
      const key = hashMatch ? hashMatch[1].toLowerCase() : item.name;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(item);
      }
    }

    const timing = Date.now() - startTime;
    return jsonResponse({
      results: deduped,
      total: deduped.length,
      timing,
    });

  } catch (err) {
    console.error('Search error:', err);
    return jsonResponse({ error: 'Search failed' }, 502);
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
    const hashMatch = full.match(/xt=urn:btih:([a-fA-F0-9]{40})/);
    if (hashMatch) return `magnet:?xt=urn:btih:${hashMatch[1]}`;
  }
  return '';
}

// ========== BTSOW 数据源 ==========
async function fetchFromBTSOW(query, waitUntil) {
  const searchUrl = `https://btsow.live/search/${encodeURIComponent(query)}`;
  const searchHtml = await fetchWithCache(searchUrl, 3600, waitUntil);

  const items = parseBTSOWSearchResults(searchHtml);
  if (items.length === 0) return [];

  return await batchFetchBTSOWDetails(items, 5, waitUntil);
}

function parseBTSOWSearchResults(html) {
  // 用正则从 HTML 中提取结果列表
  // BTSOW 的结果通常包含在链接中，链接文本是文件名，href 是详情页路径
  const items = [];
  // 匹配类似 <a href="/xxx" ...>文件名</a> 的结构
  // 具体正则需要根据实际 HTML 调整，这里用通用模式
  const linkRegex = /<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const name = match[2].trim();

    // 过滤掉导航链接、广告等无关链接
    if (name.length < 3) continue;
    if (href.includes('/search') || href.includes('/convert') || href.includes('javascript')) continue;
    if (!href.startsWith('/')) continue;

    items.push({
      name: name,
      size: '',
      date: '',
      detailPath: href,
      source: 'btsow',
    });
  }

  return items;
}

async function batchFetchBTSOWDetails(items, concurrency, waitUntil) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const promises = batch.map(async (item) => {
      try {
        const detailUrl = `https://btsow.live${item.detailPath}`;
        const detailHtml = await fetchWithCache(detailUrl, 86400, waitUntil);
        const magnet = extractMagnetFromBTSOW(detailHtml);
        // 尝试从详情页补充大小和日期
        const sizeMatch = detailHtml.match(/Size:\s*([\d.]+\s*[KMGT]?B)/i);
        const dateMatch = detailHtml.match(/Convert Date:\s*([\d-]+)/i);
        return {
          ...item,
          size: sizeMatch ? sizeMatch[1] : item.size,
          date: dateMatch ? dateMatch[1] : item.date,
          magnet,
          detailUrl,
        };
      } catch (err) {
        console.error(`BTSOW detail failed: ${item.detailPath}`, err);
        return { ...item, magnet: '', detailUrl: '' };
      }
    });
    results.push(...(await Promise.all(promises)));
  }
  return results;
}

function extractMagnetFromBTSOW(html) {
  // 从详情页提取 magnet 链接
  const match = html.match(/magnet:\?xt=urn:btih:[a-fA-F0-9]{40}[^"'<>\s]*/i);
  if (match) {
    const full = match[0];
    const hashMatch = full.match(/xt=urn:btih:([a-fA-F0-9]{40})/i);
    if (hashMatch) return `magnet:?xt=urn:btih:${hashMatch[1]}`;
  }
  return '';
}

// ========== 通用缓存与响应 ==========
async function fetchWithCache(url, ttl, waitUntil) {
  const cache = caches.default;
  const cacheKey = new Request(url, { method: 'GET' });

  let response = await cache.match(cacheKey);
  if (response) return response.text();

  response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MagnetSearch/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);

  const html = await response.text();
  const cacheResponse = new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': `public, max-age=${ttl}`,
    },
  });

  if (waitUntil) waitUntil(cache.put(cacheKey, cacheResponse));
  else await cache.put(cacheKey, cacheResponse);

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
