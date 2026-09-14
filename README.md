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
3. Site traffic & activity monitoring (totals, today, mainland China city map,
   daily country/city rankings, visits outside mainland China, recent visits)
4. Add content to any section, published immediately (bypasses review)
5. Review queue for 「留下思念」submissions — publish or reject; optional Auto-approve

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

## Traffic geography and daily reports

The admin dashboard's calendar filters the city map, mainland/non-mainland tables,
origin rankings, and recent visits to a single day in **Asia/Shanghai (UTC+8)**.
Visit counts cover `/` and `/memo`; images, scripts, APIs, and admin requests do not
count as public visits. These are page visits, not deduplicated people.

Locations are estimated locally from visitor IPs with
[GeoIP-lite / MaxMind GeoLite](https://github.com/geoip-lite/node-geoip).
Visitor IPs are not sent to a third-party location API. Existing traffic rows are
migrated on startup and their stored IPs are looked up without changing dates.
Historical locations therefore reflect the installed database, not a verified
location at the time of the visit. Private/local/unknown addresses remain unknown;
country-only results appear in tables without inventing city coordinates. `CN`
is plotted on the mainland map; other known country/region codes, including
`HK`, `MO`, and `TW`, appear in the table outside mainland China.

The installed database supplies initial lookups. Keep it up to date using the
package's documented updater with your own MaxMind license key, then restart
the server. The locally bundled map is extracted from
[Natural Earth 1:110m countries](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_0_countries.geojson),
public-domain data. This product includes GeoLite data created by MaxMind,
available from [MaxMind](https://www.maxmind.com/).

### Filtering out bot traffic

Public hostnames attract constant datacenter scanning, so the dashboard classifies
every page visit and defaults to showing verified humans only. 访客类型 switches
between 仅真人（已验证）, 排除已知机器人, and 全部访问; the summary line always reports
all three counts for the day, so nothing is hidden — only filtered.

A visit is classified as:
- `bot` — the User-Agent is empty or matches a known crawler, HTTP client, or scanner.
  These requests also stop incrementing the public 主页浏览量 counter.
- `human` — the same IP and User-Agent went on to request what the page needs to
  render (`/api/*`, `/js/app.js`, `/js/memo.js`, `/css/style.css`) within 120 seconds.
  Drive-by scanners fetch the HTML and leave, so they never reach this state — which
  catches bots that disguise themselves with a browser User-Agent.
- `unverified` — everything else: no corroborating request, but nothing incriminating either.

Visits logged before this feature existed are classified on startup from the stored
User-Agent, and promoted to `human` where an asset request from the same client was
already logged alongside them. Historical days will therefore show fewer verified
humans than real ones; 排除已知机器人 is the more useful view for those dates.

Only loopback reverse proxies (such as a local Cloudflare Tunnel) are trusted by
default. If the reverse proxy runs on another host, set `TRUST_PROXY` to its IP or
CIDR so the application can use the forwarded visitor IP. The proxy should
overwrite incoming forwarding headers. Do not configure trust for arbitrary clients.

## Automatic moderation

In 留言审核, **Auto-approve** defaults to off. When enabled, new submissions are
published immediately. Turning it off restores manual review for future submissions.
The setting is saved in SQLite and survives restarts. Existing pending or rejected
messages are not changed by the switch. Only authenticated admins can change it.

Run `npm run test:admin` with Node 24 to test traffic migration, reporting, proxy
lookups, and moderation in an isolated temporary database. `DATA_DIR` can override
the database directory for testing; it defaults to `data/`.

Security note: this is a functional demo. For a production deployment behind a
public hostname, harden further (rate limiting, CSRF, HTTPS-only cookie
sessions, real password hashing with per-user salt, secret key management).

## Direct gallery links

Open `/#gallery` for the gallery or `/#gallery-4` for the fourth photo group (currently 伊拉克). Numbers start at 1 and follow the visible section-bar order. Named links such as `/#gallery/清华` also continue to work. Section-bar links update the URL and support copying, refresh, new tabs, and browser Back/Forward on desktop and mobile. Chinese group names may appear URL-encoded when copied.
