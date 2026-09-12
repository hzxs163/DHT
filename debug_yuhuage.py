#!/usr/bin/env python3
"""
雨花阁调试脚本
请求 iyuhuage.fun，打印：
1. curl_cffi 和 urllib 两种方式的结果
2. HTTP 状态码、最终 URL、重定向历史
3. 是否 Cloudflare 盾（Just a moment / __cf_chl）
4. HTML 前 5000 字符
5. 所有含 yuhuage / location / href / meta / cf_chl 的片段
6. 所有 http(s) 链接
7. 所有 <script> 内容
"""

import re
import ssl
import urllib.request
import urllib.error

try:
    from curl_cffi import requests as cffi_requests
    HAS_CFFI = True
except ImportError:
    HAS_CFFI = False
    print('⚠️  未安装 curl_cffi，只用 urllib')

ENTRY = 'https://iyuhuage.fun'

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
}


def sep(title):
    print()
    print('=' * 70)
    print(f'  {title}')
    print('=' * 70)


def is_cf_challenge(html, headers=None):
    """判断是不是 Cloudflare 盾"""
    markers = ['Just a moment', '__cf_chl', 'cf-chl', '_cf_chl_opt', 'challenge-platform']
    for m in markers:
        if m in html:
            return True, m
    if headers:
        if headers.get('Server', '').lower() == 'cloudflare':
            if 'cf-mitigated' in {k.lower() for k in headers}:
                return True, 'cf-mitigated'
    return False, ''


def dump(name, status, final_url, html, headers=None):
    sep(f'{name} 响应')
    print(f'状态码: {status}')
    print(f'最终 URL: {final_url}')
    print(f'页面长度: {len(html)} 字符')

    is_cf, marker = is_cf_challenge(html, headers)
    print(f'是否 CF 盾: {"是" if is_cf else "否"}' + (f' (匹配到 {marker!r})' if is_cf else ''))

    if headers:
        print()
        print('--- 响应头 ---')
        for k, v in headers.items():
            print(f'  {k}: {v}')

    sep(f'{name} HTML 前 5000 字符')
    print(html[:5000])

    sep(f'{name} 含 yuhuage / location / href / meta / cf_chl 的片段')
    frags = re.findall(
        r'.{0,80}(?:yuhuage|location\.href|location\.replace|window\.location|meta[^>]*refresh|meta[^>]*url|cf_chl|__cf|Just a moment).{0,80}',
        html, re.I)
    if frags:
        for i, f in enumerate(frags[:50], 1):
            print(f'  [{i}] {f!r}')
    else:
        print('  （无）')

    sep(f'{name} 所有 http(s) 链接')
    urls = sorted(set(re.findall(r'https?://[\w.-]+\.[a-z]{2,}[^\s"\'<>]*', html, re.I)))
    if urls:
        for u in urls[:50]:
            print(f'  {u}')
    else:
        print('  （无）')

    sep(f'{name} 所有 <script> 内容（前 500 字符）')
    scripts = re.findall(r'<script[^>]*>([\s\S]*?)</script>', html, re.I)
    shown = 0
    for i, s in enumerate(scripts, 1):
        s = s.strip()
        if s:
            shown += 1
            print(f'  --- script {i} ({len(s)} 字符) ---')
            print(f'  {s[:500]}')
            if shown >= 10:
                print(f'  ...（共 {len(scripts)} 个 script，只显示前 10 个）')
                break
    if shown == 0:
        print('  （无）')


def try_cffi():
    if not HAS_CFFI:
        return
    sep('尝试 1：curl_cffi (impersonate=chrome120)')
    try:
        resp = cffi_requests.get(
            ENTRY,
            headers=HEADERS,
            timeout=20,
            impersonate='chrome120',
            allow_redirects=True,
            verify=False,
        )
        print(f'状态码: {resp.status_code}')
        print(f'最终 URL: {resp.url}')
        if resp.history:
            print(f'重定向历史 ({len(resp.history)} 次):')
            for h in resp.history:
                print(f'  {h.status_code} {h.url} -> {h.headers.get("Location", "?")}')
        else:
            print('无重定向历史')
        dump('curl_cffi', resp.status_code, str(resp.url), resp.text, dict(resp.headers))
    except Exception as e:
        print(f'curl_cffi 失败: {type(e).__name__}: {e}')


def try_cffi_chrome131():
    if not HAS_CFFI:
        return
    sep('尝试 2：curl_cffi (impersonate=chrome131)')
    try:
        resp = cffi_requests.get(
            ENTRY,
            headers=HEADERS,
            timeout=20,
            impersonate='chrome131',
            allow_redirects=True,
            verify=False,
        )
        print(f'状态码: {resp.status_code}')
        print(f'最终 URL: {resp.url}')
        dump('curl_cffi-chrome131', resp.status_code, str(resp.url), resp.text, dict(resp.headers))
    except Exception as e:
        print(f'curl_cffi chrome131 失败: {type(e).__name__}: {e}')


def try_urllib():
    sep('尝试 3：urllib')
    try:
        req = urllib.request.Request(ENTRY, headers=HEADERS)
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        with urllib.request.urlopen(req, timeout=20, context=ctx) as resp:
            html = resp.read().decode('utf-8', errors='replace')
            print(f'状态码: {resp.status}')
            print(f'最终 URL: {resp.geturl()}')
            dump('urllib', resp.status, resp.geturl(), html, dict(resp.headers))
    except urllib.error.HTTPError as e:
        print(f'HTTPError: {e.code} {e.reason}')
        print('响应头:')
        for k, v in e.headers.items():
            print(f'  {k}: {v}')
        try:
            body = e.read().decode('utf-8', errors='replace')
            print(f'响应体前 3000 字符:\n{body[:3000]}')
        except Exception:
            pass
    except Exception as e:
        print(f'urllib 失败: {type(e).__name__}: {e}')


def main():
    print(f'目标: {ENTRY}')
    print(f'curl_cffi 可用: {HAS_CFFI}')
    try_cffi()
    try_cffi_chrome131()
    try_urllib()
    sep('完成')


if __name__ == '__main__':
    main()
