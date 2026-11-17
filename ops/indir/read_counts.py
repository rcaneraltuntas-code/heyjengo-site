#!/usr/bin/env python3
"""Aggregate private /indir JSONL request counts; never identify visitors or installs."""
import argparse
from collections import Counter
from datetime import datetime
import gzip
import json
from pathlib import Path
import re
import sys

FIELDS = {'time', 'campaign', 'device', 'platform', 'traffic_class', 'method', 'status', 'destination'}
CAMPAIGN = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]{0,29}\Z', re.ASCII)
DEVICES = {'iphone', 'ipad', 'android', 'desktop', 'other'}
PLATFORMS = {'ios', 'android', 'other'}
TRAFFIC = {'browser', 'bot', 'head'}
DESTINATIONS = {'app_store', 'landing', 'rejected'}


def valid(row):
    if not isinstance(row, dict) or set(row) != FIELDS:
        return False
    if not isinstance(row['campaign'], str) or not CAMPAIGN.fullmatch(row['campaign']):
        return False
    if any(not isinstance(row[k], str) for k in ('device', 'platform', 'traffic_class', 'destination')):
        return False
    if row['device'] not in DEVICES or row['platform'] not in PLATFORMS or row['traffic_class'] not in TRAFFIC:
        return False
    if row['destination'] not in DESTINATIONS or not isinstance(row['method'], str):
        return False
    if type(row['status']) is not int or not 100 <= row['status'] <= 599:
        return False
    try:
        return datetime.fromisoformat(row['time'].replace('Z', '+00:00')).utcoffset() is not None
    except (ValueError, TypeError, AttributeError):
        return False


def exclusion_reason(row):
    if not valid(row):
        return 'invalid_record'
    if row['campaign'].lower().startswith('qa_'):
        return 'qa_campaign'
    if row['method'] == 'HEAD' or row['traffic_class'] == 'head':
        return 'head'
    if row['traffic_class'] == 'bot':
        return 'known_bot'
    if row['method'] != 'GET':
        return 'other_method'
    if row['status'] not in (200, 302):
        return 'unsuccessful_response'
    return None


def aggregate(lines):
    counts, excluded, classes = Counter(), Counter(), Counter()
    total = 0
    for line in lines:
        if not line.strip():
            continue
        total += 1
        try:
            row = json.loads(line)
        except (ValueError, TypeError):
            excluded['invalid_record'] += 1
            continue
        reason = exclusion_reason(row)
        if reason != 'invalid_record':
            classes[row['traffic_class']] += 1
        if reason:
            excluded[reason] += 1
        else:
            key = (row['time'][:10], row['campaign'], row['device'], row['platform'], row['destination'], row['status'])
            counts[key] += 1
    rows = [dict(zip(('date', 'campaign', 'device', 'platform', 'destination', 'status'), key), requests=count)
            for key, count in sorted(counts.items())]
    return {'metric': 'request_count', 'not_measured': ['unique_visitors', 'app_installs'],
            'input_records': total, 'eligible_requests': sum(counts.values()),
            'excluded': dict(sorted(excluded.items())), 'traffic_classes': dict(sorted(classes.items())), 'rows': rows}


def read_lines(paths):
    for name in paths:
        if name == '-':
            yield from sys.stdin
        else:
            path = Path(name)
            opener = gzip.open if path.suffix == '.gz' else open
            with opener(path, 'rt', encoding='utf-8') as stream:
                yield from stream


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('files', nargs='+', help='Private JSONL or gzipped rotated logs; - reads stdin')
    args = parser.parse_args()
    print(json.dumps(aggregate(read_lines(args.files)), indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
