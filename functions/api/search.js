// Pages Functions - /api/search

export async function onRequest(context) {
  const { request, waitUntil } = context;
  const url = new URL(request.url);
  const query = url.searchParams.get('q');
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const sort = url.searchParams.get('sort') || 'relevance';

  // 读取选中的源，默认全部
  const sourcesParam = url.searchParams.get('sources') || '0magnet,xiaocao';
  const sources = sourcesParam.split(',').map(s => s.trim()).filter(Boolean);

  if (!query) {
    return jsonResponse({ error: 'Missing query parameter' }, 400);
  }

  const startTime = Date.now();

  try {
    const tasks = [];

    if (sources.includes('0magnet')) {
      tasks.push({
        name: '0magnet',
        promise: fetchFrom0Magnet(query, sort, waitUntil),
      });
    }
    if (sources.includes('xiaocao')) {
      tasks.push({
        name: 'xiaocao',
        promise: fetchFromXiaocao(query, page, waitUntil),
      });
    }

    const results = await Promise.allSettled(tasks.map(t => t.promise));

    const allItems = [];
    const debug = {};

    results.forEach((r, i) => {
      const name = tasks[i].name;
      if (r.status === 'fulfilled') {
        allItems.push(...r.value);
        debug[`${name}Status`] = 'fulfilled';
        debug[`${name}Count`] = r.value.length;
      } else {
        console.error(`${name} failed:`, r.reason);
        debug[`${name}Status`] = 'rejected';
        debug[`${name}Count`] = 0;
        debug[`${name}Error`] = String(r.reason);
      }
    });

    // 去重：优先按 info_hash，没有 hash 时按名称
    const seen = new Set();
    const deduped = [];
    for (const item of allItems) {
      const hashMatch = item.magnet && item.magnet.match(/btih:([a-zA-Z0-9]{32,40})/);
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
      debug: {
        sources: sources,
        totalBeforeDedup: allItems.length,
        ...debug,
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

// ========== 小草磁力数据源 ==========
async function fetchFromXiaocao(query, page, waitUntil) {
  const searchUrl = `https://www.xccl261.xyz/search/kw-${encodeURIComponent(query)}-${page}.html`;
  const html = await fetchWithCache(searchUrl, 3600, waitUntil);

  return parseXiaocaoResults(html);
}

function parseXiaocaoResults(html) {
  const items = [];

  // 每个结果是一个 .search-item 块
  const itemRegex = /<div class="search-item[^"]*">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
  let itemMatch;

  while ((itemMatch = itemRegex.exec(html)) !== null) {
    const block = itemMatch[1];

    // 标题和详情页路径
    const titleMatch = block.match(/<a[^>]+href="(\/hash\/([a-fA-F0-9]{40})\.html)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;

    const detailPath = titleMatch[1];
    const infoHash = titleMatch[2];
    let name = titleMatch[3].replace(/<[^>]+>/g, '').trim();
    if (!name) continue;

    // 文件大小
    const sizeMatch = block.match(/文件大小:\s*<b[^>]*>([^<]+)<\/b>/);
    // 创建时间
    const dateMatch = block.match(/创建时间:\s*<b>([^<]+)<\/b>/);
    // 下载热度
    const hotMatch = block.match(/下载热度:\s*<b>([^<]+)<\/b>/);

    items.push({
      name,
      size: sizeMatch ? sizeMatch[1].trim() : '',
      date: dateMatch ? dateMatch[1].trim() : '',
      hot: hotMatch ? hotMatch[1].trim() : '',
      magnet: `magnet:?xt=urn:btih:${infoHash}`,
      detailUrl: `https://www.xccl261.xyz${detailPath}`,
      source: 'xiaocao',
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
