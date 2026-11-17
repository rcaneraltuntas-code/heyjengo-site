#!/usr/bin/env python3
"""Prepare/review a root-owned systemd forwarder; install only with --execute."""
import argparse
import hashlib
import json
import re
from pathlib import Path
import subprocess
from datetime import datetime, timezone

HERE = Path(__file__).resolve().parent
HOST = 'root@2.31.93.149'
SSH = ['ssh', '-i', '/Users/caner/.ssh/jengo_ses', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', HOST]


def run(args, data=None):
    return subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout


def installation_script(staging, hashes, log_path):
    script = '''
from pathlib import Path
import hashlib, json, os, shutil, stat, subprocess
stage=Path(__STAGING_LITERAL__)
expected=__HASHES_LITERAL__
for name,digest in expected.items():
 assert hashlib.sha256((stage/name).read_bytes()).hexdigest()==digest
private=Path('/etc/heyjengo-indir-forwarder.env')
mode=private.stat()
assert mode.st_uid==0 and stat.S_IMODE(mode.st_mode)==0o600, 'Private environment must be root-owned mode0600'
values={}
for line in private.read_text().splitlines():
 if line.strip() and not line.startswith('#'):
  k,v=line.split('=',1); values[k]=v.strip().strip('"')
assert values.get('HEYJENGO_SUPABASE_ANON_KEY'), 'Required private key missing'
assert values.get('HEYJENGO_INDIR_LOG_PATH')==__LOG_PATH_LITERAL__, 'Log path does not match Docker /data volume'
subprocess.run(['systemd-analyze','verify',str(stage/'heyjengo-indir-forwarder.service')],check=True)
dest=Path('/opt/heyjengo-indir')
unit=Path('/etc/systemd/system/heyjengo-indir-forwarder.service')
backup=stage/'previous'
backup.mkdir()
if dest.exists(): shutil.copytree(dest,backup/'code')
if unit.exists(): shutil.copy2(unit,backup/unit.name)
was_active=subprocess.run(['systemctl','is-active','--quiet','heyjengo-indir-forwarder']).returncode==0
try:
 dest.mkdir(exist_ok=True,mode=0o700)
 for name in ('forwarder.py','read_counts.py'):
  shutil.copy2(stage/name,dest/name); (dest/name).chmod(0o644)
 shutil.copy2(stage/unit.name,unit); unit.chmod(0o644)
 subprocess.run(['systemctl','daemon-reload'],check=True)
 subprocess.run(['systemctl','enable','--now','heyjengo-indir-forwarder'],check=True)
 if was_active: subprocess.run(['systemctl','restart','heyjengo-indir-forwarder'],check=True)
 subprocess.run(['systemctl','is-active','--quiet','heyjengo-indir-forwarder'],check=True)
except Exception:
 subprocess.run(['systemctl','stop','heyjengo-indir-forwarder'],check=False)
 if (backup/'code').exists():
  shutil.rmtree(dest); shutil.copytree(backup/'code',dest)
 if (backup/unit.name).exists(): shutil.copy2(backup/unit.name,unit)
 elif unit.exists(): unit.unlink()
 subprocess.run(['systemctl','daemon-reload'],check=False)
 if was_active: subprocess.run(['systemctl','start','heyjengo-indir-forwarder'],check=False)
 raise
print(json.dumps({'status':'installed','service':'heyjengo-indir-forwarder','log_path':__LOG_PATH_LITERAL__,'backup':str(backup),'key_printed':False}))
'''.replace('__STAGING_LITERAL__', repr(staging)).replace('__HASHES_LITERAL__', repr(hashes)).replace('__LOG_PATH_LITERAL__', repr(log_path))
    compile(script, '<heyjengo-forwarder-install>', 'exec')
    return script


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    output = Path(args.output).resolve() / 'process'
    output.mkdir(parents=True, exist_ok=True)
    mounts = json.loads(run(SSH + ["docker inspect --format '{{json .Mounts}}' ses-gecidi-caddy-1"]))
    sources = [m['Source'] for m in mounts if m['Destination'] == '/data']
    assert len(sources) == 1 and sources[0].startswith('/'), 'Expected one absolute /data volume source'
    log_path = str(Path(sources[0]) / 'heyjengo-analytics/indir-v1.jsonl')
    names = ['forwarder.py', 'read_counts.py', 'heyjengo-indir-forwarder.service']
    hashes = {name: hashlib.sha256((HERE / name).read_bytes()).hexdigest() for name in names}
    record = {'status': 'prepared', 'log_path': log_path, 'files_sha256': hashes,
              'endpoint': 'https://vlfokdfnidxslvnhpkzh.supabase.co/rest/v1/rpc/log_link_click',
              'required_private_env': '/etc/heyjengo-indir-forwarder.env',
              'required_env_names': ['HEYJENGO_SUPABASE_ANON_KEY', 'HEYJENGO_INDIR_LOG_PATH'],
              'delivery': 'at_most_once_best_effort', 'timeout_seconds': 3, 'retries': 0}
    (output / 'forwarder-install.json').write_text(json.dumps(record, indent=2))
    if not args.execute:
        print(json.dumps(record, indent=2))
        return
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    staging = '/opt/heyjengo-indir-staging-' + stamp
    script = installation_script(staging, hashes, log_path)
    run(SSH + ['mkdir -m 700 ' + staging])
    for name in names:
        run(['scp', '-i', '/Users/caner/.ssh/jengo_ses', '-o', 'BatchMode=yes', str(HERE / name), HOST + ':' + staging + '/' + name])
    try:
        result = run(SSH + ['python3 -'], script.encode()).decode()
    except subprocess.CalledProcessError as error:
        diagnostic = (error.stderr or b'').decode(errors='replace')
        diagnostic = re.sub(r'eyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2}', '[REDACTED_JWT]', diagnostic)
        diagnostic = re.sub(r'(?i)((?:apikey|authorization|HEYJENGO_SUPABASE_ANON_KEY)\s*[:=]\s*)\S+', r'\1[REDACTED]', diagnostic)
        report = output / 'forwarder-install-error.txt'
        report.write_text('Remote installer exit code: ' + str(error.returncode) + '\n' + diagnostic)
        report.chmod(0o600)
        raise
    record.update(json.loads(result.strip()))
    (output / 'forwarder-install.json').write_text(json.dumps(record, indent=2))
    print(json.dumps(record, indent=2))


if __name__ == '__main__':
    main()
