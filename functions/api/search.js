// Pages Functions - /api/search

const JUNIORTER_API = 'https://torrent.juniorter.in/api/search-stream';
const JUNIORTER_PROVIDERS = [
  'yts', 'eztv', 'torrentclaw', 'piratebay', 'knaben', '1337x', 'limetorrents',
  'torrentfunk', 'torrentdownloads', 'torlock', 'yourbittorrent', 'magnetz',
  'bitsearch', 'solidtorrents', 'torrentscsv', 'therarbg', 'animetosho', 'nyaa',
  'mikan', 'tokyotosho', 'dmhy', 'acgrip', 'subsplease', 'rutor',
  'audiobookbay', 'academictorrents'
].join(',');

const KNABEN_API = 'https://api.knaben.org/v1';

// 磁力多真实后端（从 wz.dobt.cc 混淆代码中解出）
const CILIDUO_API = 'https://doc2.htomcdn.com:39988';

export async function onRequest(context) {
  const { request, waitUntil } = context;
  const url = new URL(request.url);
  const query = url.searchParams.get('q');
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const sort = url.searchParams.get('sort') || 'relevance';

  const sourcesParam = url.searchParams.get('sources') || '0magnet,xiaocao,juniorter,cilibaike,knaben,ciliduo';
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
        promise: fetchFrom0Magnet(query, sort, page, waitUntil),
      });
    }
    if (sources.includes('xiaocao')) {
      tasks.push({
        name: 'xiaocao',
        promise: fetchFromXiaocao(query, page, sort, request, waitUntil),
      });
    }
    if (sources.includes('juniorter')) {
      tasks.push({
        name: 'juniorter',
        promise: fetchFromJuniorter(query, page, sort, waitUntil),
      });
    }
    if (sources.includes('cilibaike')) {
      tasks.push({
        name: 'cilibaike',
        promise: fetchFromCilibaike(query, page, sort, request, waitUntil),
      });
    }
    if (sources.includes('knaben')) {
      tasks.push({
        name: 'knaben',
        promise: fetchFromKnaben(query, page, sort, waitUntil),
      });
    }
    if (sources.includes('ciliduo')) {
      tasks.push({
        name: 'ciliduo',
        promise: fetchFromCiliduo(query, page, sort, waitUntil),
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
        page: page,
        totalBeforeDedup: allItems.length,
        ...debug,
      },
    });

  } catch (err) {
    console.error('Search error:', err);
    return jsonResponse({ error: 'Search failed', detail: String(err) }, 502);
  }
}

// ========== 磁力链接简化 ==========
function simplifyMagnet(magnet) {
  if (!magnet) return '';
  const match = magnet.match(/xt=urn:btih:([a-zA-Z0-9]{32,40})/i);
  if (match) {
    return `magnet:?xt=urn:btih:${match[1]}`;
  }
  return magnet;
}

// ========== 字节转可读格式 ==========
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(2)} ${units[i]}`;
}

// ========== Knaben 数据源（API） ==========
async function fetchFromKnaben(query, page, sort, waitUntil) {
  const size = 100;
  const from = (page - 1) * size;

  // 排序映射
  let orderBy = 'seeders';
  switch (sort) {
    case 'length': orderBy = 'bytes'; break;
    case 'time':
    case 'newest': orderBy = 'date'; break;
    case 'requests': orderBy = 'peers'; break;
    case 'relevance':
    default: orderBy = 'seeders'; break;
  }

  const body = {
    search_type: '100%',
    search_field: 'title',
    query: query,
    order_by: orderBy,
    order_direction: 'desc',
    from: from,
    size: size,
    hide_unsafe: true,
    hide_xxx: false,
  };

  const cacheKey = new Request(
  `https://knaben-cache.local/?q=${encodeURIComponent(query)}&page=${page}&sort=${sort}`,
  { method: 'GET' }
);
  const cache = caches.default;

  let response = await cache.match(cacheKey);
  if (!response) {
    response = await fetch(KNABEN_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Origin': 'https://knaben.xyz',
        'Referer': 'https://knaben.xyz/',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Knaben HTTP ${response.status}`);
    }

    const cloned = response.clone();
    const text = await cloned.text();
    const cacheResponse = new Response(text, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=1800',
      },
    });
    if (waitUntil) waitUntil(cache.put(cacheKey, cacheResponse));
    else await cache.put(cacheKey, cacheResponse);
  }

  const data = await response.json();
  return parseKnabenResults(data);
}

function parseKnabenResults(data) {
  const items = [];
  const hits = data.hits || [];

  for (const hit of hits) {
    if (!hit.title) continue;

    const magnet = hit.magnetUrl ? simplifyMagnet(hit.magnetUrl) : (hit.hash ? `magnet:?xt=urn:btih:${hit.hash}` : '');
    if (!magnet) continue;

    items.push({
      name: hit.title,
      size: formatBytes(hit.bytes),
      date: hit.date ? hit.date.slice(0, 10) : '',
      seeds: hit.seeders || 0,
      peers: hit.peers || 0,
      magnet: magnet,
      detailUrl: hit.details || '',
      source: 'knaben',
    });
  }

  return items;
}

// ========== 读取 domains.json ==========
async function getDomainsConfig(request) {
  try {
    const domainsUrl = new URL('/domains.json', request.url);
    const res = await fetch(domainsUrl.toString());
    if (res.ok) {
      const data = await res.json();
      return {
        xiaocao: Array.isArray(data.xiaocao) ? data.xiaocao : [],
        cilibaike: Array.isArray(data.cilibaike) ? data.cilibaike : [],
      };
    }
  } catch (err) {
    console.error('Failed to load domains.json:', err);
  }
  return { xiaocao: [], cilibaike: [] };
}

// ========== 磁力百科数据源 ==========
async function fetchFromCilibaike(query, page, sort, request, waitUntil) {
  const config = await getDomainsConfig(request);
  const domains = config.cilibaike;

  if (domains.length === 0) {
    console.warn('Cilibaike: no available domains');
    return [];
  }

  let order = '0';
  switch (sort) {
    case 'length': order = '1'; break;
    case 'time':
    case 'newest': order = '2'; break;
    case 'requests': order = '3'; break;
    case 'relevance':
    default: order = '0'; break;
  }

  const searchPath = `/search-${encodeURIComponent(query)}-0-${order}-${page}.html`;

  for (const domain of domains) {
    try {
      const searchUrl = `${domain}${searchPath}?lang=zh_CN`;
      const html = await fetchWithCache(searchUrl, 3600, waitUntil);

      if (!html.includes('resource-card')) {
        continue;
      }

      const items = parseCilibaikeResults(html, domain);
      if (items.length > 0) {
        console.log(`Cilibaike using domain: ${domain}`);
        return items;
      }
    } catch (err) {
      console.error(`Cilibaike domain ${domain} failed:`, err);
    }
  }

  return [];
}

function parseCilibaikeResults(html, domain) {
  const items = [];

  const parts = html.split(/<article class="resource resource-card"[^>]*>/);
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];

    const titleMatch = block.match(/<h2><a[^>]+href="(\/hash\/([a-fA-F0-9]{40})\.html)"[^>]*>([\s\S]*?)<\/a><\/h2>/);
    if (!titleMatch) continue;

    const detailPath = titleMatch[1];
    const infoHash = titleMatch[2];
    let name = titleMatch[3]
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    name = name.replace(/^【[^】]+】\s*/, '');
    if (!name) continue;

    const metaMatch = block.match(/<div class="meta resource-meta">([\s\S]*?)<\/div>/);
    let size = '';
    let date = '';

    if (metaMatch) {
      const meta = metaMatch[1];
      const sizeMatch = meta.match(/大小：\s*<span>([^<]+)<\/span>/);
      const dateMatch = meta.match(/添加时间：\s*<span>([^<]+)<\/span>/);
      if (sizeMatch) size = sizeMatch[1].trim();
      if (dateMatch) date = dateMatch[1].trim();
    }

    items.push({
      name,
      size,
      date,
      magnet: `magnet:?xt=urn:btih:${infoHash}`,
      detailUrl: `${domain}${detailPath}`,
      source: 'cilibaike',
    });
  }

  return items;
}

// ========== Juniorter 数据源 ==========
async function fetchFromJuniorter(query, page, sort, waitUntil) {
  const juniorterSort = (sort === 'time' || sort === 'newest') ? 'date' : 'seeds';
  const apiUrl = `${JUNIORTER_API}?q=${encodeURIComponent(query)}&sort=${juniorterSort}&pageSize=50&providers=${encodeURIComponent(JUNIORTER_PROVIDERS)}`;

  const cacheKey = new Request(apiUrl, { method: 'GET' });
  const cache = caches.default;

  let response = await cache.match(cacheKey);
  if (!response) {
    response = await fetch(apiUrl, {
      headers: {
        'Accept': 'text/event-stream',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://torrent.juniorter.in/ch/',
      },
    });

    if (!response.ok) {
      throw new Error(`Juniorter HTTP ${response.status}`);
    }

    const cloned = response.clone();
    const cacheResponse = new Response(await cloned.text(), {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'public, max-age=1800',
      },
    });
    if (waitUntil) waitUntil(cache.put(cacheKey, cacheResponse));
    else await cache.put(cacheKey, cacheResponse);
  }

  const text = await response.text();
  return parseJuniorterSSE(text);
}

function parseJuniorterSSE(text) {
  const items = [];
  const lines = text.split('\n');

  let currentEvent = null;
  let currentData = '';

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      currentData = line.slice(6);
    } else if (line === '' && currentEvent && currentData) {
      if (currentEvent === 'provider') {
        try {
          const parsed = JSON.parse(currentData);
          if (parsed.ok && Array.isArray(parsed.results)) {
            for (const r of parsed.results) {
              if (r.magnet && r.title) {
                items.push({
                  name: r.title,
                  size: r.size || '',
                  date: r.date ? r.date.slice(0, 10) : '',
                  seeds: r.seeds || 0,
                  peers: r.peers || 0,
                  magnet: simplifyMagnet(r.magnet),
                  detailUrl: r.url || '',
                  source: 'juniorter',
                });
              }
            }
          }
        } catch (e) {
          // 忽略
        }
      }
      currentEvent = null;
      currentData = '';
    }
  }

  return items;
}

// ========== 小草磁力数据源 ==========
function getXiaocaoSortPath(sort) {
  switch (sort) {
    case 'length': return '-length';
    case 'time': return '-time';
    case 'requests': return '-requests';
    case 'relevance':
    default: return '';
  }
}

async function fetchFromXiaocao(query, page, sort, request, waitUntil) {
  const config = await getDomainsConfig(request);
  const domains = config.xiaocao;

  if (domains.length === 0) {
    console.warn('Xiaocao: no available domains');
    return [];
  }

  const sortPath = getXiaocaoSortPath(sort);

  for (const domain of domains) {
    try {
      const searchUrl = `${domain}/search/kw-${encodeURIComponent(query)}${sortPath}-${page}.html`;
      const html = await fetchWithCache(searchUrl, 3600, waitUntil);

      if (!html.includes('search-item')) {
        continue;
      }

      const items = parseXiaocaoResults(html, domain);
      if (items.length > 0) {
        console.log(`Xiaocao using domain: ${domain}`);
        return items;
      }
    } catch (err) {
      console.error(`Xiaocao domain ${domain} failed:`, err);
    }
  }

  return [];
}

function parseXiaocaoResults(html, domain) {
  const items = [];

  const parts = html.split(/<div class="search-item[^"]*">/);
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];

    const titleMatch = block.match(/<a[^>]+href="(\/hash\/([a-fA-F0-9]{40})\.html)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;

    const detailPath = titleMatch[1];
    const infoHash = titleMatch[2];
    let name = titleMatch[3].replace(/<[^>]+>/g, '').trim();
    if (!name) continue;

    const sizeMatch = block.match(/文件大小:\s*<b[^>]*>([^<]+)<\/b>/);
    const dateMatch = block.match(/创建时间:\s*(?:&nbsp;|\s)*<b>([^<]+)<\/b>/);
    const hotMatch = block.match(/下载热度:\s*(?:&nbsp;|\s)*<b>([^<]+)<\/b>/);

    items.push({
      name,
      size: sizeMatch ? sizeMatch[1].trim() : '',
      date: dateMatch ? dateMatch[1].trim() : '',
      hot: hotMatch ? hotMatch[1].trim() : '',
      magnet: `magnet:?xt=urn:btih:${infoHash}`,
      detailUrl: `${domain}${detailPath}`,
      source: 'xiaocao',
    });
  }

  return items;
}

// ========== ØMagnet 数据源 ==========
async function fetchFrom0Magnet(query, sort, page, waitUntil) {
  const searchUrl = `https://0magnet.com/search?q=${encodeURIComponent(query)}&sort=${sort}&page=${page}`;
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

// ========== 磁力多数据源（wz.dobt.cc 真实后端） ==========
async function fetchFromCiliduo(query, page, sort, waitUntil) {
  // 排序映射：磁力多支持 viewnum / size / date
  let sortParam = '';
  switch (sort) {
    case 'length': sortParam = 'size'; break;
    case 'time':
    case 'newest': sortParam = 'date'; break;
    case 'requests': sortParam = 'viewnum'; break;
    case 'relevance':
    default: sortParam = ''; break;
  }

  const searchUrl = `${CILIDUO_API}/search?word=${encodeURIComponent(query)}&sort=${sortParam}&page=${page}`;

  const html = await fetchWithCacheGBK(searchUrl, 3600, waitUntil);

  if (!html.includes('ssbox')) {
    return [];
  }

  return parseCiliduoResults(html);
}

function parseCiliduoResults(html) {
  const items = [];

  const parts = html.split(/<div class="ssbox">/);
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];

    const titleMatch = block.match(/<h3>[\s\S]*?<a[^>]+href="(\/doc\/([a-fA-F0-9]{40}))"[^>]*>([\s\S]*?)<\/a><\/h3>/);
    if (!titleMatch) continue;

    const detailPath = titleMatch[1];
    const infoHash = titleMatch[2];
    let name = titleMatch[3]
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name) continue;

    const magnetMatch = block.match(/href="(magnet:\?xt=urn:btih:[^"]+)"/i);
    const magnet = magnetMatch ? simplifyMagnet(magnetMatch[1]) : `magnet:?xt=urn:btih:${infoHash}`;

    const sizeMatch = block.match(/大小：\s*<b[^>]*>([^<]+)<\/b>/);
    const dateMatch = block.match(/添加时间：\s*<b>([^<]+)<\/b>/);
    const hotMatch = block.match(/热度：\s*<b>([^<]+)<\/b>/);

    items.push({
      name,
      size: sizeMatch ? sizeMatch[1].trim() : '',
      date: dateMatch ? dateMatch[1].trim() : '',
      hot: hotMatch ? hotMatch[1].trim() : '',
      magnet,
      detailUrl: `${CILIDUO_API}${detailPath}`,
      source: 'ciliduo',
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

// GBK 抓取（专用于磁力多）
async function fetchWithCacheGBK(url, ttl, waitUntil) {
  const cache = caches.default;
  const cacheKey = new Request(url, { method: 'GET' });

  let response = await cache.match(cacheKey);
  if (response) return response.text();

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Referer': 'https://wz.dobt.cc/',
    },
  });

  const buffer = await res.arrayBuffer();
  let html;
  try {
    html = new TextDecoder('gbk').decode(buffer);
  } catch (e) {
    html = new TextDecoder('utf-8').decode(buffer);
  }

  if (res.ok) {
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
