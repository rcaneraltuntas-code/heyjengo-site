#!/usr/bin/env python3
"""Prepare an immutable release, then explicitly deploy its guarded Caddy change."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
from datetime import datetime, timezone

REPO = Path(__file__).resolve().parents[2]
OLD_ROOT = '/data/heyjengo-releases/20261117-c9176801d3d1-pixel-correction'
EXPECTED_CADDY_SHA = 'fb4884086ae94b492ce4ce871c2008151216834271921cbacab439fd16c50152'
HOST = 'root@2.31.93.149'
SSH = ['ssh', '-i', '/Users/caner/.ssh/jengo_ses', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', HOST]
RUNTIME_DIRS = {'assets', 'assets-v2', 'assets-v3', 'indir', 'gizlilik', 'destek'}
RUNTIME_EXT = {'.html', '.css', '.js', '.svg', '.png', '.webp', '.jpg', '.jpeg', '.ttf', '.woff', '.woff2', '.ico'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def run(args, *, data=None, cwd=None):
    return subprocess.run(args, input=data, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout


def git(*args):
    return run(['git', *args], cwd=REPO)


def site_span(config):
    marker = '\nheyjengo.com {\n'
    padded = '\n' + config
    assert padded.count(marker) == 1, 'Expected one exact heyjengo.com site block'
    start = padded.index(marker) + 1
    cursor = padded.index('{', start)
    depth = 0
    for end in range(cursor, len(padded)):
        if padded[end] == '{':
            depth += 1
        elif padded[end] == '}':
            depth -= 1
            if depth == 0:
                return start - 1, end
    raise AssertionError('Unclosed site block')


def make_candidate(original, snippet, release_root):
    config = original.decode()
    start, end = site_span(config)
    block = config[start:end]
    old_static = '\ttry_files {path} {path}/ {path}/index.html\n\tfile_server'
    assert block.count('root * ' + OLD_ROOT) == 1, 'Unexpected current document root'
    assert block.count(old_static) == 1, 'Unexpected static handler layout'
    assert 'heyjengo_indir' not in config and '@indir' not in block, 'Download route already installed'
    replacement = '\n'.join('\t' + line if line else '' for line in snippet.rstrip().splitlines())
    replacement += '\n\thandle {\n\t\ttry_files {path} {path}/ {path}/index.html\n\t\tfile_server\n\t}'
    new_block = block.replace('root * ' + OLD_ROOT, 'root * ' + release_root).replace(old_static, replacement)
    candidate = config[:start] + new_block + config[end:]
    assert candidate[:start] == config[:start] and candidate[start + len(new_block):] == config[end:]
    return candidate.encode()


def prepare(args):
    output = Path(args.output).resolve()
    process = output / 'process'
    process.mkdir(parents=True, exist_ok=True)
    commit = git('rev-parse', args.commit + '^{commit}').decode().strip()
    names = git('ls-tree', '-r', '--name-only', commit).decode().splitlines()
    runtime = [name for name in names if name in {'.nojekyll', 'indir/qrcode-generator.LICENSE'} or (
        (len(Path(name).parts) == 1 or Path(name).parts[0] in RUNTIME_DIRS)
        and Path(name).suffix.lower() in RUNTIME_EXT and '.DS_Store' not in name)]
    assert 'indir/index.html' in runtime, 'Commit must include the download landing page'
    assert all(not name.startswith('ops/') for name in runtime)
    release = datetime.now(timezone.utc).strftime('%Y%m%d') + '-' + commit[:12] + '-download-link'
    release_root = '/data/heyjengo-releases/' + release
    archive = output / 'heyjengo-download-link.tar.gz'
    site = output / 'site'
    manifest = {}
    with tarfile.open(archive, 'w:gz', format=tarfile.PAX_FORMAT) as bundle:
        for name in runtime:
            data = git('show', commit + ':' + name)
            target = site / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            manifest[name] = sha(data)
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o644
            bundle.addfile(info, io.BytesIO(data))
    with tarfile.open(archive) as bundle:
        assert {m.name: sha(bundle.extractfile(m).read()) for m in bundle.getmembers()} == manifest
    original = run(SSH + ['cat /opt/ses-gecidi/Caddyfile'])
    assert sha(original) == args.expected_caddy_sha256, 'Caddyfile changed; review current server config before preparing'
    snippet = git('show', commit + ':ops/indir/routes.caddy').decode()
    candidate = make_candidate(original, snippet, release_root)
    for name, data in [('Caddyfile.previous', original), ('Caddyfile.candidate', candidate)]:
        p = process / name
        p.write_bytes(data)
        p.chmod(0o600)
    record = {
        'commit': commit, 'release': release, 'release_root': release_root,
        'old_root': OLD_ROOT, 'archive': str(archive), 'archive_sha256': sha(archive.read_bytes()),
        'expected_caddy_sha256': sha(original), 'candidate_sha256': sha(candidate),
        'file_count': len(runtime), 'files_sha256': manifest,
        'analytics_log': '/data/heyjengo-analytics/indir-v1.jsonl',
    }
    (process / 'package.json').write_text(json.dumps(record, indent=2))
    print(json.dumps({k: v for k, v in record.items() if k != 'files_sha256'}, indent=2))


def execute(args):
    output = Path(args.output).resolve()
    process = output / 'process'
    package = json.loads((process / 'package.json').read_text())
    archive = Path(package['archive'])
    candidate = process / 'Caddyfile.candidate'
    assert sha(archive.read_bytes()) == package['archive_sha256']
    assert sha(candidate.read_bytes()) == package['candidate_sha256']
    remote_archive = '/opt/ses-gecidi/site-releases/' + package['release'] + '.tar.gz'
    remote_candidate = '/opt/ses-gecidi/site-releases/Caddyfile.' + package['release'] + '.candidate'
    run(SSH + ['mkdir -p /opt/ses-gecidi/site-releases /opt/ses-gecidi/site-backup'])
    for local, remote in [(archive, remote_archive), (candidate, remote_candidate)]:
        run(['scp', '-i', '/Users/caner/.ssh/jengo_ses', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', str(local), HOST + ':' + remote])
    remote_script = '''
import hashlib, json, subprocess
from pathlib import Path
p = PACKAGE
config=Path('/opt/ses-gecidi/Caddyfile')
original=config.read_bytes()
sha=lambda data: hashlib.sha256(data).hexdigest()
assert sha(original)==p['expected_caddy_sha256'], 'Caddyfile changed; live config untouched'
archive=Path(ARCHIVE)
candidate=Path(CANDIDATE)
assert sha(archive.read_bytes())==p['archive_sha256']
new=candidate.read_bytes()
assert sha(new)==p['candidate_sha256']
backup=Path('/opt/ses-gecidi/site-backup/Caddyfile.'+p['release']+'.bak')
assert not backup.exists(), 'Backup already exists; stopping'
container='ses-gecidi-caddy-1'
def call(*args):
 return subprocess.check_output(args,stderr=subprocess.STDOUT).decode()
call('docker','exec',container,'mkdir',p['release_root'])
container_tar='/tmp/'+p['release']+'.tar.gz'
container_candidate='/tmp/'+p['release']+'.Caddyfile'
call('docker','cp',str(archive),container+':'+container_tar)
call('docker','exec',container,'tar','-xzf',container_tar,'-C',p['release_root'])
actual=call('docker','exec',container,'sha256sum',*[p['release_root']+'/'+name for name in p['files_sha256']])
checks={line.split('  ',1)[1].removeprefix(p['release_root']+'/'):line.split('  ',1)[0] for line in actual.splitlines()}
assert checks==p['files_sha256'], 'Remote runtime file hash mismatch'
call('docker','exec',container,'mkdir','-p','/data/heyjengo-analytics')
call('docker','cp',str(candidate),container+':'+container_candidate)
validation=call('docker','exec',container,'caddy','validate','--config',container_candidate,'--adapter','caddyfile')
assert config.read_bytes()==original, 'Caddyfile changed during staging; stopping'
backup.write_bytes(original)
backup.chmod(0o600)
try:
 # Preserve the bind-mounted file inode while changing only its reviewed contents.
 config.write_bytes(new)
 call('docker','exec',container,'caddy','reload','--config','/etc/caddy/Caddyfile','--adapter','caddyfile')
except Exception:
 config.write_bytes(original)
 call('docker','exec',container,'caddy','reload','--config','/etc/caddy/Caddyfile','--adapter','caddyfile')
 raise
print(json.dumps({'status':'deployed','commit':p['commit'],'published_root':p['release_root'],'config_backup':str(backup),'old_root_preserved':p['old_root'],'runtime_files_verified':len(checks),'caddy_sha256':sha(config.read_bytes()),'analytics_log':p['analytics_log'],'validation':validation}))
'''.replace('PACKAGE', repr(package)).replace('ARCHIVE', repr(remote_archive)).replace('CANDIDATE', repr(remote_candidate))
    try:
        raw = run(SSH + ['python3 -'], data=remote_script.encode()).decode()
    except subprocess.CalledProcessError as error:
        (process / 'deploy-error.txt').write_bytes(error.stdout + error.stderr)
        raise
    record = json.loads(raw.strip())
    (process / 'deployment.json').write_text(json.dumps(record, indent=2))
    print(json.dumps(record, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    prep = sub.add_parser('prepare', help='Package committed runtime and reviewable Caddy candidate; no server changes')
    prep.add_argument('--output', required=True)
    prep.add_argument('--commit', default='HEAD')
    prep.add_argument('--expected-caddy-sha256', default=EXPECTED_CADDY_SHA)
    deploy = sub.add_parser('execute', help='Publish a previously prepared package with config guard and rollback')
    deploy.add_argument('--output', required=True)
    args = parser.parse_args()
    (prepare if args.command == 'prepare' else execute)(args)


if __name__ == '__main__':
    main()
