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
    const searchUrl = `https://0magnet.com/search?q=${encodeURIComponent(query)}&sort=${sort}`;
    const searchHtml = await fetchWithCache(searchUrl, 3600, waitUntil);

    const items = await parseSearchResults(searchHtml, query);
    if (items.length === 0) {
      return jsonResponse({ results: [], total: 0, timing: Date.now() - startTime });
    }

    const concurrency = 5;
    const detailedItems = await batchFetchDetails(items, concurrency, waitUntil);

    const timing = Date.now() - startTime;
    return jsonResponse({
      results: detailedItems,
      total: items.length,
      timing,
    });

  } catch (err) {
    console.error('Search error:', err);
    return jsonResponse({ error: 'Failed to fetch from ØMagnet' }, 502);
  }
}

async function parseSearchResults(html, query) {
  const items = [];
  let currentItem = null;

  const rewriter = new HTMLRewriter()
    .on('table.file-list tbody tr', {
      element(el) {
        if (currentItem) items.push(currentItem);
        currentItem = { name: '', size: '', date: '', detailPath: '' };
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

async function batchFetchDetails(items, concurrency, waitUntil) {
  const results = [];

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const promises = batch.map(async (item) => {
      try {
        const detailUrl = `https://0magnet.com${item.detailPath}`;
        const detailHtml = await fetchWithCache(detailUrl, 86400, waitUntil);
        const magnet = extractMagnet(detailHtml);
        return { ...item, magnet, detailUrl };
      } catch (err) {
        console.error(`Failed to fetch detail: ${item.detailPath}`, err);
        return { ...item, magnet: '', detailUrl: '' };
      }
    });

    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
  }

  return results;
}

function extractMagnet(html) {
  const match = html.match(/id="input-magnet"[^>]*value="([^"]+)"/);
  if (match) {
    return match[1]
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }
  return '';
}

async function fetchWithCache(url, ttl, waitUntil) {
  const cache = caches.default;
  const cacheKey = new Request(url, { method: 'GET' });

  let response = await cache.match(cacheKey);
  if (response) {
    return response.text();
  }

  response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MagnetSearch/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  const html = await response.text();

  const cacheResponse = new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': `public, max-age=${ttl}`,
    },
  });

  if (waitUntil) {
    waitUntil(cache.put(cacheKey, cacheResponse));
  } else {
    await cache.put(cacheKey, cacheResponse);
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
