// Pages Functions - /api/search

import domainsConfig from '../../domains.json';

const JUNIORTER_API = 'https://torrent.juniorter.in/api/search-stream';
const JUNIORTER_PROVIDERS = [
  'yts', 'eztv', 'torrentclaw', 'piratebay', 'knaben', '1337x', 'limetorrents',
  'torrentfunk', 'torrentdownloads', 'torlock', 'yourbittorrent', 'magnetz',
  'bitsearch', 'solidtorrents', 'torrentscsv', 'therarbg', 'animetosho', 'nyaa',
  'mikan', 'tokyotosho', 'dmhy', 'acgrip', 'subsplease', 'rutor',
  'audiobookbay', 'academictorrents'
].join(',');

const KNABEN_API = 'https://api.knaben.org/v1';

let CCTV10_DEBUG = {};

export async function onRequest(context) {
  const { request, waitUntil } = context;
  const url = new URL(request.url);
  const query = url.searchParams.get('q');
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const sort = url.searchParams.get('sort') || 'relevance';

  const sourcesParam = url.searchParams.get('sources') || '0magnet,xiaocao,juniorter,cilibaike,knaben,yuhuage,hufeng,cctv10,cilimao';
  const sources = sourcesParam.split(',').map(s => s.trim()).filter(Boolean);

  if (!query) {
    return jsonResponse({ error: 'Missing query parameter' }, 400);
  }

  CCTV10_DEBUG = {};

  const startTime = Date.now();

  try {
    const tasks = [];

    if (sources.includes('0magnet')) {
      tasks.push({ name: '0magnet', promise: fetchFrom0Magnet(query, sort, page, waitUntil) });
    }
    if (sources.includes('xiaocao')) {
      tasks.push({ name: 'xiaocao', promise: fetchFromXiaocao(query, page, sort, waitUntil) });
    }
    if (sources.includes('juniorter')) {
      tasks.push({ name: 'juniorter', promise: fetchFromJuniorter(query, page, sort, waitUntil) });
    }
    if (sources.includes('cilibaike')) {
      tasks.push({ name: 'cilibaike', promise: fetchFromCilibaike(query, page, sort, waitUntil) });
    }
    if (sources.includes('knaben')) {
      tasks.push({ name: 'knaben', promise: fetchFromKnaben(query, page, sort, waitUntil) });
    }
    if (sources.includes('yuhuage')) {
      tasks.push({ name: 'yuhuage', promise: fetchFromYuhuage(query, page, sort, waitUntil) });
    }
    if (sources.includes('hufeng')) {
      tasks.push({ name: 'hufeng', promise: fetchFromHufeng(query, page, sort, waitUntil) });
    }
    if (sources.includes('cctv10')) {
      tasks.push({ name: 'cctv10', promise: fetchFromCctv10(query, page, sort, waitUntil) });
    }
    if (sources.includes('cilimao')) {
      tasks.push({ name: 'cilimao', promise: fetchFromCilimao(query, page, sort, waitUntil) });
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
        cctv10Raw: CCTV10_DEBUG,
        ...debug,
      },
    });

  } catch (err) {
    console.error('Search error:', err);
    return jsonResponse({ error: 'Search failed', detail: String(err), cctv10Raw: CCTV10_DEBUG }, 502);
  }
}

function simplifyMagnet(magnet) {
  if (!magnet) return '';
  const match = magnet.match(/xt=urn:btih:([a-zA-Z0-9]{32,40})/i);
  if (match) return `magnet:?xt=urn:btih:${match[1]}`;
  return magnet;
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(2)} ${units[i]}`;
}

// ========== 读取 domains.json ==========
function getDomainsConfig() {
  const data = domainsConfig || {};
  return {
    xiaocao: Array.isArray(data.xiaocao) ? data.xiaocao : [],
    cilibaike: Array.isArray(data.cilibaike) ? data.cilibaike : [],
    hufeng: Array.isArray(data.hufeng) ? data.hufeng : [],
    yuhuage: Array.isArray(data.yuhuage) ? data.yuhuage : [],
    cctv10: Array.isArray(data.cctv10) ? data.cctv10 : [],
    cilimao: Array.isArray(data.cilimao) ? data.cilimao : [],
  };
}

// ========== Knaben ==========
async function fetchFromKnaben(query, page, sort, waitUntil) {
  const size = 100;
  const from = (page - 1) * size;

  let orderBy = 'seeders';
  switch (sort) {
    case 'length': orderBy = 'bytes'; break;
    case 'time':
    case 'newest': orderBy = 'date'; break;
    case 'requests': orderBy = 'peers'; break;
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

  const cacheKey = new Request(`https://knaben-cache.local/?q=${encodeURIComponent(query)}&page=${page}&sort=${sort}`, { method: 'GET' });
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

    if (!response.ok) throw new Error(`Knaben HTTP ${response.status}`);

    const text = await response.clone().text();
    const cacheResponse = new Response(text, {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=1800' },
    });
    if (waitUntil) waitUntil(cache.put(cacheKey, cacheResponse));
    else await cache.put(cacheKey, cacheResponse);
  }

  return parseKnabenResults(await response.json());
}

function parseKnabenResults(data) {
  const items = [];
  for (const hit of (data.hits || [])) {
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

// ========== 磁力百科 ==========
async function fetchFromCilibaike(query, page, sort, waitUntil) {
  const config = getDomainsConfig();
  const domains = config.cilibaike;
  if (domains.length === 0) return [];

  let order = '0';
  switch (sort) {
    case 'length': order = '1'; break;
    case 'time':
    case 'newest': order = '2'; break;
    case 'requests': order = '3'; break;
    default: order = '0'; break;
  }

  const searchPath = `/search-${encodeURIComponent(query)}-0-${order}-${page}.html`;

  for (const domain of domains) {
    try {
      const html = await fetchWithCache(`${domain}${searchPath}?lang=zh_CN`, 3600, waitUntil);
      if (!html.includes('resource-card')) continue;
      const items = parseCilibaikeResults(html, domain);
      if (items.length > 0) return items;
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
    let name = titleMatch[3].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    name = name.replace(/^【[^】]+】\s*/, '');
    if (!name) continue;

    const metaMatch = block.match(/<div class="meta resource-meta">([\s\S]*?)<\/div>/);
    let size = '', date = '';
    if (metaMatch) {
      const meta = metaMatch[1];
      const sizeMatch = meta.match(/大小：\s*<span>([^<]+)<\/span>/);
      const dateMatch = meta.match(/添加时间：\s*<span>([^<]+)<\/span>/);
      if (sizeMatch) size = sizeMatch[1].trim();
      if (dateMatch) date = dateMatch[1].trim();
    }

    items.push({
      name, size, date,
      magnet: `magnet:?xt=urn:btih:${infoHash}`,
      detailUrl: `${domain}${detailPath}`,
      source: 'cilibaike',
    });
  }
  return items;
}

// ========== Juniorter ==========
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
    if (!response.ok) throw new Error(`Juniorter HTTP ${response.status}`);

    const cacheResponse = new Response(await response.clone().text(), {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'public, max-age=1800' },
    });
    if (waitUntil) waitUntil(cache.put(cacheKey, cacheResponse));
    else await cache.put(cacheKey, cacheResponse);
  }

  return parseJuniorterSSE(await response.text());
}

function parseJuniorterSSE(text) {
  const items = [];
  let currentEvent = null, currentData = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('event: ')) currentEvent = line.slice(7).trim();
    else if (line.startsWith('data: ')) currentData = line.slice(6);
    else if (line === '' && currentEvent && currentData) {
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
        } catch (e) {}
      }
      currentEvent = null; currentData = '';
    }
  }
  return items;
}

// ========== 小草磁力 ==========
function getXiaocaoSortPath(sort) {
  switch (sort) {
    case 'length': return '-length';
    case 'time': return '-time';
    case 'requests': return '-requests';
    default: return '';
  }
}

async function fetchFromXiaocao(query, page, sort, waitUntil) {
  const config = getDomainsConfig();
  const domains = config.xiaocao;
  if (domains.length === 0) return [];
  const sortPath = getXiaocaoSortPath(sort);

  for (const domain of domains) {
    try {
      const html = await fetchWithCache(`${domain}/search/kw-${encodeURIComponent(query)}${sortPath}-${page}.html`, 3600, waitUntil);
      if (!html.includes('search-item')) continue;
      const items = parseXiaocaoResults(html, domain);
      if (items.length > 0) return items;
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
    const name = titleMatch[3].replace(/<[^>]+>/g, '').trim();
    if (!name) continue;

    const sizeMatch = block.match(/文件大小:\s*<b[^>]*>([^<]+)<\/b>/);
    const dateMatch = block.match(/创建时间:\s*(?:&nbsp;|\s)*<b>([^<]+)<\/b>/);
    const hotMatch = block.match(/下载热度:\s*(?:&nbsp;|\s)*<b>([^<]+)<\/b>/);

    items.push({
      name,
      size: sizeMatch ? sizeMatch[1].trim() : '',
      date: dateMatch ? dateMatch[1].trim() : '',
      hot: hotMatch ? hotMatch[1].trim() : '',
      magnet: `magnet:?xt=urn:btih:${titleMatch[2]}`,
      detailUrl: `${domain}${titleMatch[1]}`,
      source: 'xiaocao',
    });
  }
  return items;
}

// ========== ØMagnet ==========
async function fetchFrom0Magnet(query, sort, page, waitUntil) {
  const searchHtml = await fetchWithCache(`https://0magnet.com/search?q=${encodeURIComponent(query)}&sort=${sort}&page=${page}`, 3600, waitUntil);
  const items = await parse0MagnetSearchResults(searchHtml);
  if (items.length === 0) return [];
  return await batchFetch0MagnetDetails(items, 5, waitUntil);
}

async function parse0MagnetSearchResults(html) {
  const items = [];
  const parts = html.split(/<tr[^>]*>/);
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];
    const linkMatch = block.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch) continue;
    const detailPath = linkMatch[1];
    const name = linkMatch[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!name || !detailPath.includes('/')) continue;

    const sizeMatch = block.match(/<td[^>]*>\s*(\d+(?:\.\d+)?\s*(?:B|KB|MB|GB|TB))\s*<\/td>/i);

    items.push({
      name,
      size: sizeMatch ? sizeMatch[1].trim() : '',
      date: '',
      detailPath,
      source: '0magnet',
    });
  }
  return items;
}

async function batchFetch0MagnetDetails(items, concurrency, waitUntil) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      const item = items[i];
      try {
        const detailUrl = item.detailPath.startsWith('http')
          ? item.detailPath
          : `https://0magnet.com${item.detailPath}`;
        const html = await fetchWithCache(detailUrl, 3600, waitUntil);
        const magnetMatch = html.match(/magnet:\?xt=urn:btih:[a-zA-Z0-9]{32,40}/);
        if (magnetMatch) {
          results.push({
            name: item.name,
            size: item.size,
            date: item.date,
            magnet: simplifyMagnet(magnetMatch[0]),
            detailUrl,
            source: '0magnet',
          });
        }
      } catch (e) {}
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

// ========== 雨花阁 ==========
async function fetchFromYuhuage(query, page, sort, waitUntil) {
  const config = getDomainsConfig();
  const domains = config.yuhuage;
  if (domains.length === 0) return [];

  const searchPath = `/search/${encodeURIComponent(query)}-${page}.html`;

  for (const domain of domains) {
    try {
      const html = await fetchWithCache(`${domain}${searchPath}`, 3600, waitUntil);
      const items = parseYuhuageResults(html, domain);
      if (items.length > 0) return items;
    } catch (err) {
      console.error(`Yuhuage domain ${domain} failed:`, err);
    }
  }
  return [];
}

function parseYuhuageResults(html, domain) {
  const items = [];
  const parts = html.split(/<div class="search-item detail-width">/);
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];

    const linkMatch = block.match(/<h3><a[^>]+href="\/hash\/([a-fA-F0-9]{40})\.html"[^>]*>([\s\S]*?)<\/a><\/h3>/);
    if (!linkMatch) continue;
    const infoHash = linkMatch[1];
    let name = linkMatch[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!name) continue;

    const dateMatch = block.match(/创建时间：<b>\s*([^<]+)/);
    const sizeMatch = block.match(/大小：<b[^>]*>([^<]+)<\/b>/);

    items.push({
      name,
      size: sizeMatch ? sizeMatch[1].trim() : '',
      date: dateMatch ? dateMatch[1].trim() : '',
      magnet: `magnet:?xt=urn:btih:${infoHash}`,
      detailUrl: `${domain}/hash/${infoHash}.html`,
      source: 'yuhuage',
    });
  }
  return items;
}

// ========== 虎风 ==========
async function fetchFromHufeng(query, page, sort, waitUntil) {
  const config = getDomainsConfig();
  const domains = config.hufeng;
  if (domains.length === 0) return [];

  const searchPath = `/search/${encodeURIComponent(query)}_ctime_${page}.html`;

  for (const domain of domains) {
    try {
      const html = await fetchWithCache(`${domain}${searchPath}`, 3600, waitUntil);
      const items = parseHufengResults(html, domain);
      if (items.length > 0) return items;
    } catch (err) {
      console.error(`Hufeng domain ${domain} failed:`, err);
    }
  }
  return [];
}

function parseHufengResults(html, domain) {
  const items = [];
  const parts = html.split(/<div class="result">/);
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];

    const linkMatch = block.match(/<a[^>]+href="\/([a-fA-F0-9]{40})\.html"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch) continue;
    const infoHash = linkMatch[1];
    let name = linkMatch[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!name) continue;

    const dateMatch = block.match(/时间：\s*([^<]+)/);
    const sizeMatch = block.match(/大小：\s*([^<]+)/);

    items.push({
      name,
      size: sizeMatch ? sizeMatch[1].trim() : '',
      date: dateMatch ? dateMatch[1].trim() : '',
      magnet: `magnet:?xt=urn:btih:${infoHash}`,
      detailUrl: `${domain}/${infoHash}.html`,
      source: 'hufeng',
    });
  }
  return items;
}

// ========== U3C3 (cctv10) ==========
async function fetchFromCctv10(query, page, sort, waitUntil) {
  const config = getDomainsConfig();
  const domains = config.cctv10;
  CCTV10_DEBUG.domains = domains;
  CCTV10_DEBUG.query = query;

  if (domains.length === 0) return [];

  for (const domain of domains) {
    try {
      const homeHtml = await fetchWithCache(`${domain}/`, 300, waitUntil);
      CCTV10_DEBUG.homeLen = homeHtml.length;
      CCTV10_DEBUG.homeHasNmefafej = homeHtml.includes('nmefafej');

      let search2 = null;
      const matches = [...homeHtml.matchAll(/nmefafej\s*=\s*["']([a-zA-Z0-9]+)["']/g)];
      CCTV10_DEBUG.matches = matches.map(m => m[1]);
      if (matches.length > 0) {
        search2 = matches[matches.length - 1][1];
      }

      if (!search2) {
        const m = homeHtml.match(/search2=([a-zA-Z0-9]+)/);
        if (m) search2 = m[1];
      }

      CCTV10_DEBUG.search2 = search2;

      if (!search2) {
        CCTV10_DEBUG.error = 'no search2 found';
        continue;
      }

      const searchPath = `/?search2=${search2}&search=${encodeURIComponent(query)}`;
      const searchUrl = `${domain}${searchPath}`;
      CCTV10_DEBUG.searchUrl = searchUrl;

      const html = await fetchWithCache(searchUrl, 3600, waitUntil);
      CCTV10_DEBUG.searchLen = html.length;
      CCTV10_DEBUG.searchHasTorrentList = html.includes('torrent-list');

      if (!html.includes('torrent-list')) continue;
      const items = parseCctv10Results(html, domain);
      CCTV10_DEBUG.parsedCount = items.length;

      if (items.length > 0) return items;
    } catch (err) {
      CCTV10_DEBUG.error = String(err);
      console.error(`Cctv10 domain ${domain} failed:`, err);
    }
  }
  return [];
}

function parseCctv10Results(html, domain) {
  const items = [];
  const parts = html.split(/<tr class="default">/);
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];

    const magnetMatch = block.match(/href="(magnet:\?xt=urn:btih:([a-fA-F0-9]{40})[^"]*)"/);
    if (!magnetMatch) continue;
    const magnet = simplifyMagnet(magnetMatch[1]);
    const infoHash = magnetMatch[2];

    const titleMatch = block.match(/<a href="\/view\?id=[^"]+"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;
    let name = titleMatch[1]
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name) continue;

    const tds = block.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [];
    let size = '';
    let date = '';
    for (const td of tds) {
      const content = td.replace(/<[^>]+>/g, '').trim();
      if (!size && /^\d+(\.\d+)?\s*(B|KB|MB|GB|TB)$/i.test(content)) {
        size = content;
      }
      if (!date && /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(content)) {
        date = content;
      }
    }

    items.push({
      name,
      size,
      date,
      magnet,
      detailUrl: `${domain}/view?id=${infoHash}`,
      source: 'cctv10',
    });
  }
  return items;
}

// ========== 磁力猫 ==========
function decodeAtobHtml(html) {
  const m = html.match(/window\.atob\("([^"]+)"\)/);
  if (!m) return null;
  try {
    return decodeURIComponent(atob(m[1]));
  } catch (e) {
    return null;
  }
}

async function fetchFromCilimao(query, page, sort, waitUntil) {
  const config = getDomainsConfig();
  const domains = config.cilimao;
  if (domains.length === 0) return [];

  const wordB64 = btoa(query).replace(/=+$/, '');

  for (const domain of domains) {
    try {
      const searchUrl = `${domain}/search?word=${wordB64}&sort=rele&p=${page}`;
      const html = await fetchWithCache(searchUrl, 1800, waitUntil);
      const decoded = decodeAtobHtml(html);
      if (!decoded) continue;

      const links = [];
      const linkRe = /<a[^>]+href="(\/information\/[a-zA-Z0-9]+)"[^>]*>([\s\S]*?)<\/a>/g;
      let m;
      while ((m = linkRe.exec(decoded)) !== null) {
        const detailPath = m[1];
        const name = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (name) links.push({ detailPath, name });
      }

      if (links.length === 0) continue;

      const items = await batchFetchCilimaoDetails(links, 5, domain, waitUntil);
      if (items.length > 0) return items;
    } catch (err) {
      console.error(`Cilimao domain ${domain} failed:`, err);
    }
  }
  return [];
}

async function batchFetchCilimaoDetails(links, concurrency, domain, waitUntil) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < links.length) {
      const i = index++;
      const link = links[i];
      try {
        const detailUrl = `${domain}${link.detailPath}`;
        const html = await fetchWithCache(detailUrl, 3600, waitUntil);
        const decoded = decodeAtobHtml(html);
        if (!decoded) continue;

        const magnetMatch = decoded.match(/href="(magnet:\?xt=urn:btih:[a-fA-F0-9]{40}[^"]*)"/);
        if (!magnetMatch) continue;
        const magnet = simplifyMagnet(magnetMatch[1]);

        const sizeMatch = decoded.match(/文件大小：<\/b>([^<]+)<\/b>/);
        const dateMatch = decoded.match(/收录时间：<\/b>\s*([^<]+)/);

        results.push({
          name: link.name,
          size: sizeMatch ? sizeMatch[1].trim() : '',
          date: dateMatch ? dateMatch[1].trim() : '',
          magnet,
          detailUrl,
          source: 'cilimao',
        });
      } catch (e) {}
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

// ========== 工具函数 ==========
async function fetchWithCache(url, ttl, waitUntil) {
  const cacheKey = new Request(url, { method: 'GET' });
  const cache = caches.default;

  let response = await cache.match(cacheKey);
  if (!response) {
    response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);

    const text = await response.clone().text();
    const cacheResponse = new Response(text, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': `public, max-age=${ttl}`,
      },
    });
    if (waitUntil) waitUntil(cache.put(cacheKey, cacheResponse));
    else await cache.put(cacheKey, cacheResponse);

    response = new Response(text, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  return await response.text();
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
