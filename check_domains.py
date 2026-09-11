#!/usr/bin/env python3
"""
从 fwonggh/xccl 仓库的 index.html 提取小草磁力域名列表
写入 domains.json，供 Pages Functions 读取
"""

import json
import re
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

import requests

# 源文件地址（GitHub raw）
SOURCE_URL = 'https://raw.githubusercontent.com/fwonggh/xccl/main/index.html'

OUTPUT_FILE = Path(__file__).parent / 'domains.json'

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; DomainListBot/1.0)',
}


def fetch_source() -> str:
    """拉取源文件内容"""
    resp = requests.get(SOURCE_URL, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    return resp.text


def extract_domains(content: str) -> list:
    """从源文件里提取所有域名"""
    domains = set()

    # 方法一：直接正则匹配（源文件里可能有明文域名）
    for m in re.findall(r'https://www\.xccl\d+\.xyz', content):
        domains.add(m)

    # 方法二：解码 unescape 的编码内容
    # 源文件里域名藏在 unescape("%3C...") 里
    unescape_matches = re.findall(r'unescape\("([^"]+)"\)', content)
    for encoded in unescape_matches:
        try:
            decoded = urllib.parse.unquote(encoded)
            for m in re.findall(r'https://www\.xccl\d+\.xyz', decoded):
                domains.add(m)
        except Exception as e:
            print(f'解码失败: {e}')

    # 方法三：从 JS 数组里提取（decoded 后可能还有转义）
    # 匹配 'https://www.xcclXXX.xyz' 或 "https://www.xcclXXX.xyz"
    for m in re.findall(r'https://www\.xccl\d+\.xyz', content.replace('\\/', '/')):
        domains.add(m)

    return sorted(domains)


def main():
    print(f'拉取源文件: {SOURCE_URL}')
    try:
        content = fetch_source()
    except Exception as e:
        print(f'拉取失败: {e}')
        # 失败时不覆盖已有的 domains.json
        if OUTPUT_FILE.exists():
            print('保留现有的 domains.json')
            return
        raise

    print(f'源文件长度: {len(content)} 字符')
    domains = extract_domains(content)

    if not domains:
        print('警告: 没有提取到任何域名！')
        if OUTPUT_FILE.exists():
            print('保留现有的 domains.json')
            return

    result = {
        'updated_at': datetime.now(timezone.utc).isoformat(),
        'source': SOURCE_URL,
        'domains': domains,
        'total': len(domains),
    }

    OUTPUT_FILE.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )

    print(f'提取到 {len(domains)} 个域名，已写入 {OUTPUT_FILE}')
    for d in domains:
        print(f'  - {d}')


if __name__ == '__main__':
    main()
