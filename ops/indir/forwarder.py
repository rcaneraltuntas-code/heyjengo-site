#!/usr/bin/env python3
"""Forward minimized /indir records independently of requests, at most once."""
import fcntl
from http.client import HTTPException
import json
import os
from pathlib import Path
import signal
import threading
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from read_counts import exclusion_reason

ENDPOINT = 'https://vlfokdfnidxslvnhpkzh.supabase.co/rest/v1/rpc/log_link_click'
TIMEOUT_SECONDS = 3
MAX_LINE_BYTES = 16384


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def payload_for(row):
    if exclusion_reason(row):
        return None
    platform = row['platform']
    device = platform if platform in ('ios', 'android') else ('desktop' if row['device'] == 'desktop' else 'other')
    return {'p_campaign': row['campaign'], 'p_device': device, 'p_path': '/indir'}


def checkpoint(path, dev, inode, offset):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix('.tmp')
    with open(temporary, 'w', encoding='utf-8') as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump({'version': 1, 'dev': dev, 'inode': inode, 'offset': offset}, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def read_checkpoint(path):
    try:
        saved = json.loads(Path(path).read_text())
        if (saved.get('version') != 1 or
                any(type(saved.get(k)) is not int or saved[k] < 0 for k in ('dev', 'inode', 'offset'))):
            raise ValueError('Invalid checkpoint schema')
        return saved
    except FileNotFoundError:
        return None
    # Corrupt state is a hard failure; silently starting over could double count.


def emit(event, **fields):
    print(json.dumps({'time': datetime.now(timezone.utc).isoformat(), 'event': event, **fields}), flush=True)


def deliver(payload, key, opener=None):
    opener = opener or build_opener(NoRedirect())
    request = Request(ENDPOINT, data=json.dumps(payload).encode(), method='POST', headers={
        'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json',
    })
    try:
        with opener.open(request, timeout=TIMEOUT_SECONDS) as response:
            status = response.status
            response.read(1024)
        return {'ok': 200 <= status < 300, 'status': status}
    except HTTPError as error:
        return {'ok': False, 'status': error.code, 'reason': 'http_error'}
    except (URLError, TimeoutError, OSError, HTTPException):
        return {'ok': False, 'status': None, 'reason': 'network_error'}


def process_line(line, state_path, identity, offset, key, sender=deliver):
    # Durably consume before delivery: crashes/timeouts never replay an uncertain POST.
    checkpoint(state_path, identity[0], identity[1], offset)
    try:
        row = json.loads(line)
    except (ValueError, UnicodeDecodeError):
        return {'event': 'skipped', 'reason': 'invalid_record'}
    payload = payload_for(row)
    if payload is None:
        return {'event': 'skipped', 'reason': exclusion_reason(row)}
    result = sender(payload, key)
    return {'event': 'forwarded' if result['ok'] else 'delivery_failed',
            'campaign': payload['p_campaign'], 'device': payload['p_device'],
            'status': result['status'], **({'reason': result['reason']} if 'reason' in result else {})}


def tail(log_path, state_path, key, stop, sender=deliver):
    saved = read_checkpoint(state_path)
    stream = None
    identity = None
    oversize = False
    try:
        while not stop.is_set():
            if stream is None:
                try:
                    stream = open(log_path, 'rb')
                except FileNotFoundError:
                    stop.wait(0.5)
                    continue
                stat = os.fstat(stream.fileno())
                identity = (stat.st_dev, stat.st_ino)
                if saved and identity == (saved['dev'], saved['inode']) and saved['offset'] <= stat.st_size:
                    stream.seek(saved['offset'])
                saved = None
            start = stream.tell()
            line = stream.readline(MAX_LINE_BYTES + 1)
            if line:
                if len(line) > MAX_LINE_BYTES or oversize:
                    oversize = not line.endswith(b'\n')
                    if not oversize:
                        checkpoint(state_path, *identity, stream.tell())
                        emit('skipped', reason='oversize_record')
                    continue
                if not line.endswith(b'\n'):
                    stream.seek(start)
                    stop.wait(0.5)
                    continue
                result = process_line(line, state_path, identity, stream.tell(), key, sender=sender)
                event = result.pop('event')
                if event != 'skipped':
                    emit(event, **result)
                continue
            try:
                current = os.stat(log_path)
            except FileNotFoundError:
                current = None
            if current and ((current.st_dev, current.st_ino) != identity or current.st_size < stream.tell()):
                stream.close()
                stream = None
                oversize = False
                continue
            stop.wait(0.5)
    finally:
        if stream:
            stream.close()


def main():
    key = os.environ.get('HEYJENGO_SUPABASE_ANON_KEY', '')
    log_path = os.environ.get('HEYJENGO_INDIR_LOG_PATH', '')
    state_path = Path(os.environ.get('HEYJENGO_INDIR_STATE_PATH', '/var/lib/heyjengo-indir-forwarder/checkpoint.json'))
    if not key or not log_path:
        raise SystemExit('Required environment configuration is missing; no credential values printed')
    state_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())
    with open(state_path.parent / 'process.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        emit('started', delivery='at_most_once_best_effort')
        tail(log_path, state_path, key, stop)


if __name__ == '__main__':
    main()
