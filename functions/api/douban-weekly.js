// Pages Functions - /api/douban-weekly
// 豆瓣电影「正在上映」热门影片，带 1 小时缓存 + 兜底数据
const NOWPLAYING_URL = 'https://movie.douban.com/cinema/nowplaying/beijing/';
const CACHE_TTL = 3600 * 1000; // 1 小时
// 兜底：最近热映商业片（磁力站搜得到）
const FALLBACK = [
  { rank: 1, title: '杀死比尔：血色全传', url: 'https://movie.douban.com/subject/1291580/' },
  { rank: 2, title: '欢迎来龙餐馆', url: 'https://movie.douban.com/' },
  { rank: 3, title: '我想留在你身边', url: 'https://movie.douban.com/' },
  { rank: 4, title: '奥德赛', url: 'https://movie.douban.com/' },
  { rank: 5, title: '空枪', url: 'https://movie.douban.com/' },
  { rank: 6, title: '坠落2：死点', url: 'https://movie.douban.com/' },
  { rank: 7, title: '燃烧吧！爸爸', url: 'https://movie.douban.com/' },
  { rank: 8, title: '肖申克的救赎', url: 'https://movie.douban.com/subject/1292052/' },
  { rank: 9, title: '蜘蛛侠：崭新之日', url: 'https://movie.douban.com/' },
  { rank: 10, title: '复仇者联盟4：终局之战', url: 'https://movie.douban.com/subject/26100958/' },
];
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
function parseNowPlaying(html, limit) {
  // 豆瓣正在上映页面：<li class="list-item" data-title="片名" data-score="评分" ...>
  const re = /<li[^>]*class="list-item"[^>]*data-title="([^"]+)"[^>]*data-score="([^"]*)"/g;
  const items = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const title = m[1].trim();
    const score = parseFloat(m[2]) || 0;
    if (!title) continue;
    items.push({ title, score });
  }
  // 有评分的优先（更热门），评分高的排前面；无评分的（新片）排后面
  items.sort((a, b) => b.score - a.score);
  return items.slice(0, limit).map((it, i) => ({
    rank: i + 1,
    title: it.title,
    url: 'https://movie.douban.com/subject_search?search_text=' + encodeURIComponent(it.title),
  }));
}
async function getHotMovies(limit) {
  const now = Date.now();
  if (cache.data && now - cache.ts < CACHE_TTL) {
    return cache.data.slice(0, limit);
  }
  try {
    const res = await fetch(NOWPLAYING_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://movie.douban.com/',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();
    const data = parseNowPlaying(html, limit);
    if (data.length) {
      cache = { data, ts: now };
      return data.slice(0, limit);
    }
  } catch (e) {
    console.error('douban nowplaying fetch failed:', e);
  }
  if (!cache.data) cache = { data: FALLBACK, ts: now };
  return (cache.data || FALLBACK).slice(0, limit);
}
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10) || 10, 15);
  const data = await getHotMovies(limit);
  return jsonResponse({ ok: true, data });
}
