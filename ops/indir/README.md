# heyJengo /indir deployment and private request counts

`routes.caddy` is inserted only into the existing `heyjengo.com` site block. The default static handler stays in a fallback `handle`; the API and `www` blocks are preserved byte for byte. The static landing page is owned by `indir/`.

## Request contract

- Exact `/indir` and `/indir/` paths accept GET and HEAD. Non-bot iPhone/iPad User-Agent values receive HTTP 302; known bots and all other devices receive the themed landing page via an internal `/indir/index.html` rewrite. Other methods receive 405 with `Allow: GET, HEAD`.
- Every route response has `Cache-Control: no-store` and `Vary: User-Agent`.
- Apple destination is `https://apps.apple.com/app/apple-store/id6833951608?pt=118863704&ct={campaign}&mt=8`. Provider `118863704` was verified using App Store Connect's campaign-link generator.
- `ct` accepts `[A-Za-z0-9][A-Za-z0-9_-]{0,29}` only; missing/invalid values use `instagram_bio`. No request parameter can control the redirect host or path. Duplicate `ct` values use the server's first query value; frontend must use the same first-value rule.
- Desktop-style iPad detection is handled by the landing page using browser touch capability. Server logs describe the original server-observed UA classification, not that subsequent browser decision.
- Bot identification is a conservative known-UA pattern, not proof a visitor is human. HEAD and known bots are counted separately. In-app iPhone browsers still receive the Apple redirect.

## Private JSONL handoff

Container path: `/data/heyjengo-analytics/indir-v1.jsonl`. This path is outside the static document root, mode `0600`, with 5 MiB / 24-hour rotation, at most 14 rotated files and 14-day rotated-file retention. Active-file cleanup follows the next rotation; this is not a background deletion service.

Only the `/indir` handler selects the named logger. Its JSON encoder removes request/response objects and unnecessary defaults, so IP addresses, cookies, Referer, raw User-Agent and full query strings are absent. The route itself makes no external calls. The separate forwarder described below can send only the minimized RPC payload after installation.

Each JSONL object has exactly:

| Field | Meaning |
| --- | --- |
| `time` | UTC RFC3339 request-log time |
| `campaign` | Validated `ct`, or `instagram_bio` |
| `device` | `iphone`, `ipad`, `android`, `desktop`, `other` |
| `platform` | `ios`, `android`, `other` |
| `traffic_class` | `head`, `bot`, `browser` (HEAD takes precedence) |
| `method` | HTTP method |
| `status` | Final HTTP status |
| `destination` | `app_store`, `landing`, `rejected` |

Example:

```json
{"time":"2026-11-17T15:00:00Z","campaign":"instagram_bio","device":"iphone","platform":"ios","traffic_class":"browser","method":"GET","status":302,"destination":"app_store"}
```

`read_counts.py` consumes local JSONL, `.gz` rotations or stdin and prints aggregate JSON. It excludes `qa_` campaigns, HEAD requests, known bots, other methods and responses outside 200/302 from `eligible_requests`; excluded categories remain separate. Unexpected fields/schema are rejected without echoing their contents. It counts requests, **not unique visitors, clicks proved to be human, or app installations**. Repeated requests remain repeated counts. Avoid reading the same file twice.

```sh
python3 ops/indir/read_counts.py /private/path/indir-v1.jsonl
# Read-only server fetch; no public metrics route is exposed:
ssh -i /Users/caner/.ssh/jengo_ses root@2.31.93.149 \
  'docker exec ses-gecidi-caddy-1 cat /data/heyjengo-analytics/indir-v1.jsonl' \
  | python3 ops/indir/read_counts.py -
```

## Supabase forwarding

The supplied RPC endpoint is `https://vlfokdfnidxslvnhpkzh.supabase.co/rest/v1/rpc/log_link_click`. `forwarder.py` runs independently of Caddy and reads the private JSONL. Eligible GET requests send only `p_campaign`, `p_device` (`ios`, `android`, `desktop`, `other`) and fixed `p_path: /indir`. Country and referrer are omitted because they are not known. There are no forwarding requests in the redirect path.

The forwarder durably checkpoints each complete log record **before** sending, uses a three-second timeout for each blocking HTTP socket operation, refuses redirects and never retries. This is not a hard end-to-end deadline (for example DNS resolution may take longer). A timeout, network failure or crash can lose an analytics record; it cannot replay an uncertain POST on restart. This is **at-most-once, best-effort delivery**, not exactly-once delivery. The service follows active-file rotation while running. If it is stopped across rotation, unread older rotated-file records are not replayed. A process lock prevents concurrent consumers. Corrupt checkpoint state stops the service rather than recounting from the beginning.

The systemd service reads `/etc/heyjengo-indir-forwarder.env`, owned by root with mode `0600`. Required fields are `HEYJENGO_SUPABASE_ANON_KEY` and `HEYJENGO_INDIR_LOG_PATH`; the latter is the host path of the Docker `/data` volume plus `/heyjengo-analytics/indir-v1.jsonl`. Never commit that environment file or key. Delivery logs contain success/failure and HTTP status, never credentials, HTTP error bodies or optional personal fields.

```sh
# Read-only discovery and review; prints required names/path, never key values:
python3 ops/indir/install_forwarder.py --output '/Users/caner/Documents/ChatGPT/KIDS LEARN/outputs/heyjengo-download-link-20261117'
# Once the root-owned private environment is populated and installation is authorized:
python3 ops/indir/install_forwarder.py --output '/Users/caner/Documents/ChatGPT/KIDS LEARN/outputs/heyjengo-download-link-20261117' --execute
```

`install_forwarder.py` verifies source hashes, secret-file permissions and the Docker log path; validates the systemd unit; backs up existing code/unit; then installs and activates the service. It does not change Caddy or the static site. `journalctl -u heyjengo-indir-forwarder` shows delivery outcomes; the checkpoint lives in `/var/lib/heyjengo-indir-forwarder/checkpoint.json`.


## Release procedure

Root coordinator owns commit/push and the decision to execute publication. Preparation packages **committed** runtime files only; `ops/`, documentation, tests and `.DS_Store` never enter the public artifact.

```sh
python3 ops/indir/deploy.py prepare --commit HEAD \
  --output '/Users/caner/Documents/ChatGPT/KIDS LEARN/outputs/heyjengo-download-link-20261117'
# Review process/Caddyfile.candidate and package.json before executing:
python3 ops/indir/deploy.py execute \
  --output '/Users/caner/Documents/ChatGPT/KIDS LEARN/outputs/heyjengo-download-link-20261117'
```

Preparation verifies the current Caddyfile byte hash and expected previous static root. The candidate changes only the `heyjengo.com` site block. Deployment rechecks the byte hash, uploads a new immutable release, verifies every remote runtime file hash, validates the candidate before replacing live configuration, preserves a private backup and reloads Caddy. Validation failure leaves the live configuration intact; reload failure restores and reloads the original bytes. The previous static release remains available for rollback.

Current expected previous root is `/data/heyjengo-releases/20261117-c9176801d3d1-pixel-correction`. A changed server hash stops preparation/deployment for review. Do not bypass the guard without reviewing the new config. `prepare` does not publish. A deployment can be followed by the coordinator's HTTP/browser matrix using `qa_` campaigns and HEAD for non-test campaigns.

## Caddy references

- [Map](https://caddyserver.com/docs/caddyfile/directives/map)
- [Named access logs](https://caddyserver.com/docs/caddyfile/directives/log_name)
- [Log append](https://caddyserver.com/docs/caddyfile/directives/log_append)
- [Log encoding and rotation](https://caddyserver.com/docs/caddyfile/directives/log)
