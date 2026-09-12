// Pages Functions - /api/douban-weekly
// 豆瓣电影一周口碑榜，带 1 小时内存缓存 + 兜底数据
const DOUBAN_CHART_URL = 'https://movie.douban.com/chart';
const CACHE_TTL = 3600 * 1000; // 1 小时
const FALLBACK = [
  { rank: 1, title: '抓特务', url: 'https://movie.douban.com/subject/36812879/' },
  { rank: 2, title: '欧盟制造', url: 'https://movie.douban.com/subject/36956292/' },
  { rank: 3, title: '歪心狼对阵ACME', url: 'https://movie.douban.com/subject/27190137/' },
  { rank: 4, title: '银魂 吉原大炎上', url: 'https://movie.douban.com/subject/37482099/' },
  { rank: 5, title: '凤仙花', url: 'https://movie.douban.com/subject/36907269/' },
  { rank: 6, title: '求救信号', url: 'https://movie.douban.com/subject/36439868/' },
  { rank: 7, title: '一切从头来过', url: 'https://movie.douban.com/subject/36922688/' },
  { rank: 8, title: '一直在这里', url: 'https://movie.douban.com/subject/38481360/' },
  { rank: 9, title: '战时离婚指南', url: 'https://movie.douban.com/subject/36513585/' },
  { rank: 10, title: '夜巡毒枭', url: 'https://movie.douban.com/subject/38220877/' },
];
// Worker 实例级缓存（实例存活期间有效）
let cache = { data: null, ts: 0 };
function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
function parseWeekly(html, limit) {
  const idx = html.indexOf('一周口碑榜');
  if (idx === -1) return [];
  let seg = html.slice(idx, idx + 8000);
  for (const stop of ['北美票房榜', '新片榜', 'Top 250']) {
    const p = seg.indexOf(stop);
    if (p !== -1) seg = seg.slice(0, p);
  }
  const re = /<div class="no">(\d+)<\/div>\s*<div class="name">\s*<a[^>]*href="([^"]+)"[^>]*>\s*([^<]+?)\s*<\/a>/gs;
  const items = [];
  let m;
  while ((m = re.exec(seg)) !== null) {
    items.push({ rank: parseInt(m[1], 10), url: m[2].trim(), title: m[3].trim() });
    if (items.length >= limit) break;
  }
  return items;
}
async function getWeekly(limit) {
  const now = Date.now();
  if (cache.data && now - cache.ts < CACHE_TTL) {
    return cache.data.slice(0, limit);
  }
  try {
    const res = await fetch(DOUBAN_CHART_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://movie.douban.com/',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();
    const data = parseWeekly(html, limit);
    if (data.length) {
      cache = { data, ts: now };
      return data.slice(0, limit);
    }
  } catch (e) {
    console.error('douban-weekly fetch failed:', e);
  }
  // 抓取失败：先更新缓存为兜底，避免每次都重试打豆瓣
  if (!cache.data) cache = { data: FALLBACK, ts: now };
  return (cache.data || FALLBACK).slice(0, limit);
}
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10) || 10, 10);
  const data = await getWeekly(limit);
  return jsonResponse({ ok: true, data });
}