#!/usr/bin/env python3
"""
域名列表生成脚本
1. 小草磁力：从 fwonggh/xccl 提取域名
2. 磁力百科：从中转站页面提取 CONFIG，用算法算出子域名
3. 虎风（hufeng）：从永久入口 ddcl.me / cltt.me 提取当前落地域名
4. 雨花阁（yuhuage）：从永久入口 iyuhuage.fun 提取当前落地域名
把生成的域名写入 domains.json，验证交给 Workers 运行时做

依赖：curl_cffi（用于模拟 Chrome TLS 指纹，绕过 WAF 403）
"""

import base64
import json
import re
import time
import urllib.request
import urllib.error
import ssl
from datetime import datetime, timezone
from pathlib import Path

try:
    from curl_cffi import requests as cffi_requests
    HAS_CFFI = True
except ImportError:
    HAS_CFFI = False

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

# 合法域名正则：允许一个点（如 hufeng.sbs）或多个点
VALID_DOMAIN_RE = re.compile(r'^https?://[\w-]+(\.[\w-]+)*\.[a-z]{2,}$', re.I)


def is_valid_domain_url(url):
    return bool(VALID_DOMAIN_RE.match(url.rstrip('/')))


# ========== 统一请求层（curl_cffi） ==========
def fetch_url(url, timeout=15, headers=None, impersonate='chrome120'):
    h = {**HEADERS, **(headers or {})}

    if HAS_CFFI:
        resp = cffi_requests.get(
            url,
            headers=h,
            timeout=timeout,
            impersonate=impersonate,
            allow_redirects=True,
            verify=False,
        )
        return resp.text, str(resp.url)
    else:
        req = urllib.request.Request(url, headers=h)
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            return resp.read().decode('utf-8', errors='replace'), resp.geturl()


def fetch_text(url, timeout=15, headers=None):
    text, _ = fetch_url(url, timeout=timeout, headers=headers)
    return text


# ========== urllib 专用请求（雨花阁用） ==========
def fetch_url_urllib(url, timeout=15, headers=None):
    h = {**HEADERS, **(headers or {})}
    req = urllib.request.Request(url, headers=h)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
        return resp.read().decode('utf-8', errors='replace'), resp.geturl()


# ========== 小草磁力域名提取 ==========
def extract_xiaocao_domains():
    print(f'[小草] 拉取源文件: {XIAOCAO_SOURCE_URL}')
    try:
        content = fetch_text(XIAOCAO_SOURCE_URL)
    except Exception as e:
        print(f'[小草] 拉取失败: {e}')
        return []

    print(f'[小草] 源文件长度: {len(content)} 字符')

    domains = set()

    for m in re.findall(r'https://www\.xccl\d+\.xyz', content):
        domains.add(m)

    from urllib.parse import unquote
    unescape_matches = re.findall(r'unescape\("([^"]+)"\)', content)
    for encoded in unescape_matches:
        try:
            decoded = unquote(encoded)
            for m in re.findall(r'https://www\.xccl\d+\.xyz', decoded):
                domains.add(m)
        except Exception as e:
            print(f'[小草] 解码失败: {e}')

    for m in re.findall(r'https://www\.xccl\d+\.xyz', content.replace('\\/', '/')):
        domains.add(m)

    result = sorted(domains)
    print(f'[小草] 提取到 {len(result)} 个域名')
    return result


# ========== 磁力百科域名生成 ==========
def extract_cilibaike_config(html):
    match = re.search(r'const\s+CONFIG\s*=\s*(\{[\s\S]*?\});', html)
    if not match:
        print('[磁力百科] 未找到 CONFIG')
        return None

    js_obj = match.group(1)

    try:
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
    h = 2166136261
    for ch in text:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def seeded_code(seed_text, length):
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
    print(f'[磁力百科] 拉取中转站: {CILIBaike_TRANSIT_URL}')
    try:
        html = fetch_text(CILIBaike_TRANSIT_URL)
    except Exception as e:
        print(f'[磁力百科] 中转站拉取失败: {e}')
        return []

    config = extract_cilibaike_config(html)
    if not config:
        return []

    return build_cilibaike_domains(config)


# ========== 虎风域名提取 ==========
def extract_hufeng_domains():
    domains = set()

    now = datetime.now()
    zz_sub = f'{now.month}{now.day}'

    for entry in HUFENG_ENTRY_URLS:
        print(f'[虎风] 请求入口: {entry}')
        try:
            html, final_url = fetch_url(
                entry,
                timeout=20,
                headers={'Referer': entry + '/', 'Accept': '*/*'},
            )
            print(f'[虎风] 入口页面长度: {len(html)}')
            print(f'[虎风] 入口最终 URL: {final_url}')

            # ① HTTP 层跳转
            m = re.match(r'(https?://[^/]+)', final_url)
            if m and not any(h.replace('https://', '') in final_url for h in HUFENG_ENTRY_URLS):
                url = m.group(1).rstrip('/')
                if 'hufeng' in url or '.hf' in url:
                    domains.add(url)
                    print(f'[虎风] HTTP 跳转到: {url}')

            # ② atob + api.JS 三层解析
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
                    js, _ = fetch_url(
                        api_url,
                        timeout=20,
                        headers={'Referer': entry + '/', 'Accept': '*/*'},
                    )
                    print(f'[虎风] api.JS 返回长度: {len(js)}')

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

            # ③ HTML 解析兜底
            for m in re.findall(r'http-equiv=["\']?refresh["\']?[^>]*content=["\']?[^;]+;\s*url=([^"\'>\s]+)', html, re.I):
                mm = re.match(r'(?:https?:)?//([^/]+)', m)
                if mm:
                    url = f'https://{mm.group(1)}'.rstrip('/')
                    if is_valid_domain_url(url):
                        domains.add(url)

            for m in re.findall(r'(?:location\.href|location\.replace|location\.assign)\s*[=(]\s*["\']([^"\']+)', html, re.I):
                mm = re.match(r'(?:https?:)?//([^/]+)', m)
                if mm:
                    url = f'https://{mm.group(1)}'.rstrip('/')
                    if is_valid_domain_url(url):
                        domains.add(url)

            for m in re.findall(r'(?:https?:)?//([\w.-]*(?:hufeng|hf)[\w.-]*\.[a-z]{2,})', html, re.I):
                url = f'https://{m}'.rstrip('/')
                if is_valid_domain_url(url):
                    domains.add(url)

            for frag in re.findall(r'.{0,60}(?:hufeng|location|refresh).{0,60}', html, re.I):
                print(f'[虎风] 片段: {frag!r}')

        except Exception as e:
            print(f'[虎风] 入口 {entry} 失败: {e}')

    result = sorted(
        d for d in domains
        if not any(entry_host in d for entry_host in HUFENG_ENTRY_URLS)
        and 'jumpcdn' not in d
        and 'xn--r8s65df7admf92a' not in d
        and is_valid_domain_url(d)
    )
    print(f'[虎风] 提取到 {len(result)} 个落地域名')
    for d in result:
        print(f'    - {d}')
    return result


# ========== 雨花阁域名提取 ==========
def extract_yuhuage_domains():
    """
    雨花阁：用 urllib 请求 iyuhuage.fun，拿 302 跳转后的最终 URL。
    本地已验证 urllib 能拿到 https://www.yuhuage008.xyz/。
    """
    domains = set()

    for entry in YUHUAGE_ENTRY_URLS:
        print(f'[雨花阁] 请求入口: {entry}')
        try:
            html, final_url = fetch_url_urllib(entry, timeout=20)
            print(f'[雨花阁] 最终 URL: {final_url}')
            print(f'[雨花阁] 页面长度: {len(html)}')

            # 1) HTTP 跳转后的最终 URL
            m = re.match(r'(https?://[^/]+)', final_url)
            if m:
                url = m.group(1).rstrip('/')
                if not any(h.replace('https://', '') in url for h in YUHUAGE_ENTRY_URLS):
                    if is_valid_domain_url(url):
                        domains.add(url)
                        print(f'[雨花阁] HTTP 跳转到: {url}')

            # 2) HTML 里的 mobile-agent meta
            for m in re.findall(r'<meta[^>]+url=([^"\'>\s]+)', html, re.I):
                mm = re.match(r'(?:https?:)?//([^/]+)', m)
                if mm:
                    url = f'https://{mm.group(1)}'.rstrip('/')
                    if not any(h.replace('https://', '') in url for h in YUHUAGE_ENTRY_URLS):
                        if is_valid_domain_url(url):
                            domains.add(url)
                            print(f'[雨花阁] meta 解析到: {url}')

            # 3) HTML 里所有 yuhuage 域名
            for m in re.findall(r'(?:https?:)?//([\w.-]*yuhuage[\w.-]*\.[a-z]{2,})', html, re.I):
                url = f'https://{m}'.rstrip('/')
                if not any(h.replace('https://', '') in url for h in YUHUAGE_ENTRY_URLS):
                    if is_valid_domain_url(url):
                        domains.add(url)

        except Exception as e:
            print(f'[雨花阁] 入口 {entry} 失败: {e}')

    result = sorted(domains)
    print(f'[雨花阁] 提取到 {len(result)} 个落地域名')
    for d in result:
        print(f'    - {d}')
    return result


def load_previous_domains():
    if not OUTPUT_FILE.exists():
        return {}
    try:
        return json.loads(OUTPUT_FILE.read_text(encoding='utf-8'))
    except Exception as e:
        print(f'[保底] 读取旧 domains.json 失败: {e}')
        return {}


def main():
    if not HAS_CFFI:
        print('⚠️  未安装 curl_cffi，回退到 urllib。建议 pip install curl_cffi 以过 WAF。')

    previous = load_previous_domains()

    result = {
        'updated_at': datetime.now(timezone.utc).isoformat(),
        'xiaocao': [],
        'cilibaike': [],
        'hufeng': [],
        'yuhuage': [],
    }

    result['xiaocao'] = extract_xiaocao_domains()
    result['cilibaike'] = get_cilibaike_domains()

    hufeng_domains = extract_hufeng_domains()
    if hufeng_domains:
        result['hufeng'] = hufeng_domains
    else:
        fallback = previous.get('hufeng', [])
        if fallback:
            print(f'[虎风] 提取为空，保留上次的 {len(fallback)} 个域名')
        result['hufeng'] = fallback

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
