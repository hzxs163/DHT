#!/usr/bin/env python3
"""
小草磁力域名探测脚本
定时运行，探测候选域名，把可用的写入 domains.json
"""

import json
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

# 候选域名列表，发现新域名时手动加进来
CANDIDATE_DOMAINS = [
    'https://www.xccl268.xyz',
    'https://www.xccl267.xyz',
    'https://www.xccl266.xyz',
    'https://www.xccl265.xyz',
    'https://www.xccl264.xyz',
    'https://www.xccl263.xyz',
    'https://www.xccl261.xyz',
    'https://www.xccl260.xyz',
    'https://www.xccl270.xyz',
    'https://www.xccl271.xyz',
]

# 探测用的测试关键词和页码
TEST_PATH = '/search/kw-test-1.html'

# 请求头，模拟浏览器
HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/120.0.0.0 Safari/537.36'
    ),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
}

# 超时时间（秒）
TIMEOUT = 10

# 输出文件
OUTPUT_FILE = Path(__file__).parent / 'domains.json'


def check_domain(domain: str) -> bool:
    """探测单个域名是否可用。返回 True 表示可用。"""
    url = domain.rstrip('/') + TEST_PATH
    try:
        resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT, allow_redirects=True)
        if resp.status_code != 200:
            print(f'  [×] {domain} -> HTTP {resp.status_code}')
            return False

        # 检查页面里是否包含小草磁力的特征
        content = resp.text
        if 'search-item' in content or '小草磁力' in content or 'xccl' in content.lower():
            print(f'  [✓] {domain} -> 可用')
            return True
        else:
            print(f'  [×] {domain} -> 页面内容不匹配')
            return False

    except requests.exceptions.Timeout:
        print(f'  [×] {domain} -> 请求超时')
        return False
    except requests.exceptions.RequestException as e:
        print(f'  [×] {domain} -> {type(e).__name__}')
        return False


def main():
    print(f'开始探测 {len(CANDIDATE_DOMAINS)} 个域名...')
    print(f'时间: {datetime.now(timezone.utc).isoformat()}')
    print()

    available = []
    for domain in CANDIDATE_DOMAINS:
        if check_domain(domain):
            available.append(domain.rstrip('/'))
        time.sleep(0.5)  # 避免请求过快

    result = {
        'updated_at': datetime.now(timezone.utc).isoformat(),
        'available': available,
        'total_checked': len(CANDIDATE_DOMAINS),
        'total_available': len(available),
    }

    OUTPUT_FILE.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )

    print()
    print(f'探测完成，可用域名 {len(available)} 个，已写入 {OUTPUT_FILE}')
    if available:
        print('可用域名:')
        for d in available:
            print(f'  - {d}')
    else:
        print('警告: 没有可用域名！需要手动查找新域名并加入候选列表。')


if __name__ == '__main__':
    main()
