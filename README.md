# 纪念 · 永怀 — 网上纪念平台 (Memorial Website Replica)

A Chinese-language online memorial platform replicating the structure and style of
`https://memorial.website/demo`, with an admin backend, a moderated memory-wall,
and a public memorial page designed to be CDN-friendly.

## Stack
- Node.js 24 + Express
- SQLite via built-in `node:sqlite` (no native compile needed)
- Vanilla HTML/CSS/JS frontend (no build step) — loads content via JSON API so a
  CDN can cache the static shell.

## Run locally
```
cd memorial
node server.js            # serves on http://0.0.0.0:8080
# or: PORT=8090 node server.js
```

## Expose publicly (Cloudflare Quick Tunnel, no account needed)
```
./start-public.sh
```
An account-less tunnel on `*.trycloudflare.com` has no uptime guarantee. For
production, create a named tunnel:
```
cloudflared tunnel login
cloudflared tunnel create memorial
cloudflared tunnel route dns memorial YOUR.DOMAIN
cloudflared tunnel --config config.yml run memorial
```

## Routes
| Path      | Purpose                                                        |
|-----------|----------------------------------------------------------------|
| `/`       | Public memorial page (About → Timeline → Memory Wall → Gallery)|
| `/memo`   | 「留下思念」blog-style editor with photo upload                |
| `/admin`  | Admin panel (login required)                                   |

## Admin login (first account, hardcoded seed)
- Username: `Taquanx1`
- Password: `68554968`

Admin features:
1. Add more admin accounts (ID + password, min 6-char password)
2. Change design/layout of any section (title texts, hero, accent color,
   light/dark tone, serif/sans font, maintained-by, about body) — saved to DB,
   applied live on the public page
3. Site traffic & activity monitoring (totals, today, per-page distribution,
   recent requests, live view count)
4. Add content to any section, published immediately (bypasses review)
5. Review queue for all 「留下思念」submissions — publish or reject

## CDN readiness
- Static assets (`/assets/*`) served `immutable, max-age=30d`
- CSS/JS served `max-age=3600`
- Dynamic API responses left uncached
- Page content fetched client-side from `/api/*` so a CDN can cache the HTML
  shell; swapping in a CDN requires no code change.

## Data
SQLite DB lives at `data/memorial.db`. Admin passwords are SHA-256 hashed with a
static salt. Sessions are in-memory bearer tokens (12h) stored in localStorage.
Photos upload to `public/uploads/`.

Security note: this is a functional demo. For a production deployment behind a
public hostname, harden further (rate limiting, CSRF, HTTPS-only cookie
sessions, real password hashing with per-user salt, secret key management).
