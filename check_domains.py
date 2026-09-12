#!/usr/bin/env python3
"""
域名列表生成脚本
1. 小草磁力：从 fwonggh/xccl 提取域名
2. 磁力百科：从中转站页面提取 CONFIG，用算法算出子域名
3. 虎风（hufeng）：从永久入口 ddcl.me / cltt.me 跟随跳转，提取当前落地域名
4. 雨花阁（yuhuage）：从永久入口 iyuhuage.fun 跟随跳转，提取当前落地域名
把生成的域名写入 domains.json，验证交给 Workers 运行时做
"""

import base64
import json
import re
import ssl
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# ========== 小草磁力 ==========
XIAOCAO_SOURCE_URL = 'https://raw.githubusercontent.com/fwonggh/xccl/main/index.html'

# ========== 磁力百科中转站 ==========
CILIBaike_TRANSIT_URL = 'https://xn--tfr084furbf5a.com/'
ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

# ========== 虎风永久入口 ==========
HUFENG_ENTRY_URLS = [
    'https://ddcl.me',
    'https://cltt.me',
]

# 落地域名特征：通常是 hufeng.xxx 或类似
HUFENG_DOMAIN_RE = re.compile(r'https?://(?:[\w-]+\.)*(?:hufeng|hf)[\w-]*\.[a-z]{2,}', re.I)

# ========== 雨花阁永久入口 ==========
YUHUAGE_ENTRY_URLS = [
    'https://iyuhuage.fun',
]

OUTPUT_FILE = Path(__file__).parent / 'domains.json'

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
}


def fetch_url(url, timeout=15):
    """请求 URL，返回文本内容"""
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode('utf-8', errors='replace')


# ========== 小草磁力域名提取 ==========
def extract_xiaocao_domains():
    """从 fwonggh/xccl 的 index.html 提取小草磁力域名"""
    print(f'[小草] 拉取源文件: {XIAOCAO_SOURCE_URL}')
    try:
        content = fetch_url(XIAOCAO_SOURCE_URL)
    except Exception as e:
        print(f'[小草] 拉取失败: {e}')
        return []

    print(f'[小草] 源文件长度: {len(content)} 字符')

    domains = set()

    # 直接正则匹配
    for m in re.findall(r'https://www\.xccl\d+\.xyz', content):
        domains.add(m)

    # 解码 unescape 的编码内容
    from urllib.parse import unquote
    unescape_matches = re.findall(r'unescape\("([^"]+)"\)', content)
    for encoded in unescape_matches:
        try:
            decoded = unquote(encoded)
            for m in re.findall(r'https://www\.xccl\d+\.xyz', decoded):
                domains.add(m)
        except Exception as e:
            print(f'[小草] 解码失败: {e}')

    # 从转义内容里提取
    for m in re.findall(r'https://www\.xccl\d+\.xyz', content.replace('\\/', '/')):
        domains.add(m)

    result = sorted(domains)
    print(f'[小草] 提取到 {len(result)} 个域名')
    return result


# ========== 磁力百科域名生成 ==========
def extract_cilibaike_config(html):
    """从磁力百科中转站页面提取 CONFIG"""
    match = re.search(r'const\s+CONFIG\s*=\s*(\{[\s\S]*?\});', html)
    if not match:
        print('[磁力百科] 未找到 CONFIG')
        return None

    js_obj = match.group(1)

    try:
        # 把 JS 对象字面量转成 JSON
        js_obj = re.sub(r'(\w+)\s*:', r'"\1":', js_obj)
        js_obj = js_obj.replace("'", '"')
        js_obj = re.sub(r',\s*\}', '}', js_obj)
        js_obj = re.sub(r'//[^\n]*', '', js_obj)

        config = json.loads(js_obj)
        print(f'[磁力百科] 提取到 CONFIG: {config}')
        return config
    except Exception as e:
        print(f'[磁力百科] CONFIG 解析失败: {e}')
        print(f'[磁力百科] 原始内容: {js_obj[:200]}')
        return None


def hash32(text):
    """FNV-1a 32位哈希，复现中转站页面的算法"""
    h = 2166136261
    for ch in text:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def seeded_code(seed_text, length):
    """xorshift 随机码生成，复现中转站页面的算法"""
    state = hash32(seed_text) or 1
    output = ''
    for _ in range(length):
        state ^= (state << 13) & 0xFFFFFFFF
        state ^= state >> 17
        state ^= (state << 5) & 0xFFFFFFFF
        state &= 0xFFFFFFFF
        output += ALPHABET[state % len(ALPHABET)]
    return output


def build_cilibaike_domains(config):
    """根据 CONFIG 算出当前 slot 对应的子域名"""
    domains = config.get('domains', [])
    interval_minutes = config.get('intervalMinutes', 30)
    code_length = config.get('codeLength', 8)
    salt = config.get('salt', '')

    if not domains or not salt:
        print('[磁力百科] CONFIG 缺少必要字段')
        return []

    interval_ms = max(1, interval_minutes) * 60000
    slot = int(time.time() * 1000) // interval_ms

    result = []
    for i, base in enumerate(domains):
        code = seeded_code(f'{salt}|{base}|{slot}|{i}', code_length)
        result.append(f'https://{code}.{base}')

    print(f'[磁力百科] 生成 {len(result)} 个域名 (slot={slot})')
    return result


def get_cilibaike_domains():
    """获取磁力百科当前可用的子域名"""
    print(f'[磁力百科] 拉取中转站: {CILIBaike_TRANSIT_URL}')
    try:
        html = fetch_url(CILIBaike_TRANSIT_URL)
    except Exception as e:
        print(f'[磁力百科] 中转站拉取失败: {e}')
        return []

    config = extract_cilibaike_config(html)
    if not config:
        return []

    return build_cilibaike_domains(config)


# ========== 虎风域名提取 ==========
def extract_hufeng_domains():
    """
    虎风永久入口 ddcl.me / cltt.me 是三层 JS 混淆跳转：
      1. 入口页返回一段 JS，用 atob() 藏 api.JS 的域名后缀
      2. 请求 https://gn{月日}{后缀}/api.JS?1,{base64(入口URL)} 拿到第二段 JS
      3. 第二段 JS 里再用 atob() 藏落地域名（用 | 代替 .）
    """
    domains = set()

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    browser_headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
    }

    now = datetime.now()
    zz_sub = f'{now.month}{now.day}'  # 9月11日 → "911"

    for entry in HUFENG_ENTRY_URLS:
        print(f'[虎风] 请求入口: {entry}')
        try:
            req = urllib.request.Request(entry, headers={**browser_headers, 'Referer': entry + '/'})
            with urllib.request.urlopen(req, timeout=20, context=ctx) as resp:
                html = resp.read().decode('utf-8', errors='replace')
            print(f'[虎风] 入口页面长度: {len(html)}')

            entry_b64 = base64.b64encode(entry.encode()).decode()

            api_suffixes = []
            for b64 in re.findall(r'atob\([\'"]([^\'"]+)[\'"]\)', html):
                try:
                    decoded = base64.b64decode(b64).decode('utf-8', errors='replace')
                    api_suffixes.append(decoded)
                except Exception:
                    pass

            print(f'[虎风] 解出的 api 后缀: {api_suffixes}')

            for suffix in api_suffixes:
                api_url = f'https://gn{zz_sub}{suffix}/api.JS?1,{entry_b64}'
                print(f'[虎风] 请求 api.JS: {api_url}')
                try:
                    req2 = urllib.request.Request(api_url, headers={**browser_headers, 'Referer': entry + '/'})
                    with urllib.request.urlopen(req2, timeout=20, context=ctx) as resp2:
                        js = resp2.read().decode('utf-8', errors='replace')
                    print(f'[虎风] api.JS 返回长度: {len(js)}')
                    print(f'[虎风] api.JS 返回开头: {js[:200]}')

                    for b64 in re.findall(r'atob\([\'"]([^\'"]+)[\'"]\)', js):
                        try:
                            decoded = base64.b64decode(b64).decode('utf-8', errors='replace')
                            decoded = decoded.replace('|', '.')
                            for m in re.findall(r'https?://[a-z0-9.-]+\.[a-z]{2,}', decoded, re.I):
                                host = m.split('//')[1].lower()
                                if host.startswith('gn') or 'jumpcdn' in host or 'xn--r8s65df7admf92a' in host:
                                    continue
                                domains.add(m)
                        except Exception:
                            pass

                    for m in HUFENG_DOMAIN_RE.findall(js):
                        domains.add(m)

                except Exception as e:
                    print(f'[虎风] api.JS 请求失败: {e}')

        except Exception as e:
            print(f'[虎风] 入口 {entry} 失败: {e}')

    result = sorted(
        d for d in domains
        if not any(entry_host in d for entry_host in HUFENG_ENTRY_URLS)
        and 'jumpcdn' not in d
        and 'xn--r8s65df7admf92a' not in d
    )
    print(f'[虎风] 提取到 {len(result)} 个落地域名')
    for d in result:
        print(f'    - {d}')
    return result


# ========== 雨花阁域名提取 ==========
def extract_yuhuage_domains():
    """
    雨花阁永久入口 iyuhuage.fun 是 Apache 302 跳转，
    请求后 urllib 自动跟随，resp.geturl() 就是落地域名。
    注意：不要带 Referer，否则 Apache 会返回 403。
    """
    domains = set()

    browser_headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
    }

    for entry in YUHUAGE_ENTRY_URLS:
        print(f'[雨花阁] 请求入口: {entry}')
        try:
            # 不传 Referer
            req = urllib.request.Request(entry, headers=browser_headers)
            with urllib.request.urlopen(req, timeout=20) as resp:
                final_url = resp.geturl()
                html = resp.read().decode('utf-8', errors='replace')

            print(f'[雨花阁] 最终 URL: {final_url}')
            print(f'[雨花阁] 页面长度: {len(html)}')

            # 1) urllib 跟随跳转后的最终 URL
            m = re.match(r'(https?://[^/]+)', final_url)
            if m:
                domains.add(m.group(1))

            # 2) 兜底：从 HTML 里找 canonical 链接
            for m in re.findall(r'<link[^>]+rel=["\']canonical["\'][^>]+href=["\']([^"\']+)', html, re.I):
                mm = re.match(r'(https?://[^/]+)', m)
                if mm:
                    domains.add(mm.group(1))

            # 3) 兜底：从 HTML 里找 JS 跳转目标
            for m in re.findall(r'(?:location\.href|location\.replace)\s*[=(]\s*["\']([^"\']+)', html, re.I):
                mm = re.match(r'(https?://[^/]+)', m)
                if mm:
                    domains.add(mm.group(1))

        except urllib.error.HTTPError as e:
            # 403/301/302 时 Location 头可能仍有值
            print(f'[雨花阁] HTTP {e.code}，尝试从 Location 头拿跳转')
            loc = e.headers.get('Location')
            if loc:
                m = re.match(r'(https?://[^/]+)', loc)
                if m:
                    domains.add(m.group(1))
        except Exception as e:
            print(f'[雨花阁] 入口 {entry} 失败: {e}')

    result = sorted(
        d for d in domains
        if not any(entry_host in d for entry_host in YUHUAGE_ENTRY_URLS)
    )
    print(f'[雨花阁] 提取到 {len(result)} 个落地域名')
    for d in result:
        print(f'    - {d}')
    return result


def load_previous_domains():
    """读取上一次生成的 domains.json，用于保底"""
    if not OUTPUT_FILE.exists():
        return {}
    try:
        return json.loads(OUTPUT_FILE.read_text(encoding='utf-8'))
    except Exception as e:
        print(f'[保底] 读取旧 domains.json 失败: {e}')
        return {}


def main():
    previous = load_previous_domains()

    result = {
        'updated_at': datetime.now(timezone.utc).isoformat(),
        'xiaocao': [],
        'cilibaike': [],
        'hufeng': [],
        'yuhuage': [],
    }

    # 小草磁力：只提取，不验证
    xiaocao_domains = extract_xiaocao_domains()
    result['xiaocao'] = xiaocao_domains

    # 磁力百科：只生成，不验证
    cilibaike_domains = get_cilibaike_domains()
    result['cilibaike'] = cilibaike_domains

    # 虎风：从永久入口提取落地域名，失败时保留上次结果
    hufeng_domains = extract_hufeng_domains()
    if hufeng_domains:
        result['hufeng'] = hufeng_domains
    else:
        fallback = previous.get('hufeng', [])
        if fallback:
            print(f'[虎风] 提取为空，保留上次的 {len(fallback)} 个域名')
        result['hufeng'] = fallback

    # 雨花阁：从永久入口提取落地域名，失败时保留上次结果
    yuhuage_domains = extract_yuhuage_domains()
    if yuhuage_domains:
        result['yuhuage'] = yuhuage_domains
    else:
        fallback = previous.get('yuhuage', [])
        if fallback:
            print(f'[雨花阁] 提取为空，保留上次的 {len(fallback)} 个域名')
        result['yuhuage'] = fallback

    OUTPUT_FILE.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )

    print()
    print(f'已写入 {OUTPUT_FILE}')
    print(f'  小草磁力: {len(result["xiaocao"])} 个')
    print(f'  磁力百科: {len(result["cilibaike"])} 个')
    print(f'  虎风: {len(result["hufeng"])} 个')
    print(f'  雨花阁: {len(result["yuhuage"])} 个')
    if result['cilibaike']:
        print('  磁力百科域名:')
        for d in result['cilibaike']:
            print(f'    - {d}')
    if result['hufeng']:
        print('  虎风域名:')
        for d in result['hufeng']:
            print(f'    - {d}')
    if result['yuhuage']:
        print('  雨花阁域名:')
        for d in result['yuhuage']:
            print(f'    - {d}')


if __name__ == '__main__':
    main()
