#!/usr/bin/env python3
"""
域名列表生成脚本
1. 小草磁力：从 fwonggh/xccl 提取域名
2. 磁力百科：从中转站页面提取 CONFIG，用算法算出子域名
把可用的域名写入 domains.json
"""

import json
import re
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

# ========== 小草磁力 ==========
XIAOCAO_SOURCE_URL = 'https://raw.githubusercontent.com/fwonggh/xccl/main/index.html'

# ========== 磁力百科中转站 ==========
CILIBaike_TRANSIT_URL = 'https://xn--tfr084furbf5a.com/'
ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

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
    unescape_matches = re.findall(r'unescape\("([^"]+)"\)', content)
    for encoded in unescape_matches:
        try:
            from urllib.parse import unquote
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
        # 1. 给没有引号的 key 加引号
        js_obj = re.sub(r'(\w+)\s*:', r'"\1":', js_obj)
        # 2. 单引号转双引号
        js_obj = js_obj.replace("'", '"')
        # 3. 去掉末尾可能多余的逗号
        js_obj = re.sub(r',\s*\}', '}', js_obj)
        # 4. 去掉注释
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


def verify_domain(url):
    """验证域名是否可用（返回 True 表示可用）"""
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status != 200:
                return False
            text = resp.read().decode('utf-8', errors='replace')
            # 检查页面特征
            if '磁力百科' in text or 'search' in text.lower() or 'resource-card' in text:
                return True
            return False
    except Exception:
        return False


def main():
    result = {
        'updated_at': datetime.now(timezone.utc).isoformat(),
        'xiaocao': [],
        'cilibaike': [],
    }

    # 小草磁力：只提取，不验证（Workers 运行时验证）
    xiaocao_domains = extract_xiaocao_domains()
    result['xiaocao'] = xiaocao_domains

    # 磁力百科：提取 + 生成 + 验证
    cilibaike_domains = get_cilibaike_domains()
    if cilibaike_domains:
        print('[磁力百科] 验证域名可用性...')
        available = []
        for url in cilibaike_domains:
            if verify_domain(url):
                print(f'  [✓] {url}')
                available.append(url)
            else:
                print(f'  [×] {url}')
                time.sleep(0.3)
        result['cilibaike'] = available
    else:
        result['cilibaike'] = []

    OUTPUT_FILE.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )

    print()
    print(f'已写入 {OUTPUT_FILE}')
    print(f'  小草磁力: {len(result["xiaocao"])} 个')
    print(f'  磁力百科: {len(result["cilibaike"])} 个')


if __name__ == '__main__':
    main()
