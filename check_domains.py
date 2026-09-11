#!/usr/bin/env python3
"""
小草磁力域名列表生成脚本
不探测可用性，只把维护好的域名列表写入 domains.json
发现新域名时，手动加进 DOMAINS 列表即可
"""

import json
from datetime import datetime, timezone
from pathlib import Path

# 手动维护的域名列表，把最可能可用的排在前面
# 发现新域名时加到这里，Actions 会自动同步到 domains.json
DOMAINS = [
    'https://www.xccl264.xyz',
    'https://www.xccl263.xyz',
    'https://www.xccl261.xyz',
    'https://www.xccl260.xyz',
    'https://www.xccl268.xyz',
    'https://www.xccl267.xyz',
    'https://www.xccl266.xyz',
    'https://www.xccl265.xyz',
]

OUTPUT_FILE = Path(__file__).parent / 'domains.json'


def main():
    result = {
        'updated_at': datetime.now(timezone.utc).isoformat(),
        'domains': DOMAINS,
        'total': len(DOMAINS),
    }

    OUTPUT_FILE.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )

    print(f'已写入 {len(DOMAINS)} 个域名到 {OUTPUT_FILE}')
    for d in DOMAINS:
        print(f'  - {d}')


if __name__ == '__main__':
    main()
