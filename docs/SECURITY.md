# Security

MandiMate moves farmers' money and personal data between parties who do not yet trust each other.
Security here is not a checklist item; it is part of the product promise that every fee, every
deduction and every decision is visible, attributable and fair. This document describes the
controls in the code base and the operating rules a deployment must follow.

Related: [API contract conventions](API_CONTRACT.md#conventions) · [Domain rules §10](DOMAIN_RULES.md#10-auth--security) ·
[Deployment](DEPLOYMENT.md) · [AI prompt safety](AI.md#prompt-safety)

## Authentication

### Cookies

| Cookie | Content | Lifetime | Path | Flags |
|---|---|---|---|---|
| `mandimate_access` | access JWT | 30 minutes (`ACCESS_TOKEN_MINUTES`) | `/` | `HttpOnly`, `SameSite=Lax`, `Secure` when `COOKIE_SECURE=true` |
| `mandimate_refresh` | refresh JWT | 14 days (`REFRESH_TOKEN_DAYS`) | `/api/v1/auth` | `HttpOnly`, `SameSite=Lax`, `Secure` when `COOKIE_SECURE=true` |

- Tokens never touch JavaScript: they are `HttpOnly`, so an injected script cannot read them, and
  the client never stores tokens in `localStorage`.
- The refresh cookie is scoped to the auth endpoints, so it is not sent with ordinary API calls.
- `COOKIE_DOMAIN` is unset by default (host-only cookies). Set it only when the web and API
  hosts genuinely need to share cookies.
- **CSRF**: `SameSite=Lax` keeps cookies off cross-site `POST`/`PATCH`/`DELETE` requests, the
  API accepts JSON (cross-origin JSON requests require a CORS preflight), and CORS allows only
  the configured origins (`CORS_ORIGINS`) with credentials. In the container deployment the site
  and the API share one origin, so no cross-origin access is needed at all.
- An access token is also accepted as `Authorization: Bearer <token>` for non-browser API
  clients; the browser app relies on cookies only.

### JWT and refresh rotation

- HS256 (configurable among HS256/384/512) signed with `JWT_SECRET`. Claims: `sub` (user id),
  `role`, `type` (`access` or `refresh`), `jti`, `iat`, `exp`; all are required when verifying, and
  the token type must match its use, so a refresh token can never act as an access token.
- Every issued refresh token is recorded in `refresh_tokens` by its `jti` with expiry, IP and
  user agent. `POST /auth/refresh` accepts only a known, unrevoked, unexpired `jti`, revokes it
  and issues a new access/refresh pair (rotation). A stolen refresh token therefore works at most
  once, and its reuse is detectable. Logout revokes the current refresh token and clears both
  cookies.
- **Startup refuses to run with a weak secret in production**: with `APP_ENV=production`,
  `JWT_SECRET` must differ from the development default and be at least 32 characters.
  Generate one with:

  ```bash
  python3 -c "import secrets; print(secrets.token_urlsafe(48))"
  ```

  Rotating `JWT_SECRET` signs everyone out, which is the intended emergency response to a leak.

### Passwords

- Hashed with **Argon2id** (`argon2-cffi`, RFC 9106 profile): salted, memory-hard,
  self-describing PHC strings, verified in constant time. Hashes produced with weaker parameters
  are detected (`password_needs_rehash`) so they can be upgraded at the next login.
- Policy: 8 to 128 characters with at least one letter and one digit.
- Login identifiers: email (case-insensitive) or phone (normalised to E.164, Indian numbers to
  `+91XXXXXXXXXX`). Failed logins return one generic `401` message that does not reveal whether
  the account exists.
- Farmers registered by a coordinator receive a temporary password that is shown once to the
  coordinator to hand over in person; the farmer changes it from Settings.

### Login throttling

Five failed logins per (identifier, client IP) within five minutes return `429 Too Many
Requests` until the window passes; a successful login clears the counter. The limiter lives in
the API process (`app/core/ratelimit.py`), which is correct for the single-process deployment
described in [DEPLOYMENT.md](DEPLOYMENT.md#scaling). Running several API processes requires a
shared store for the counters.

The client IP must be trustworthy for this to work. In the container stack nginx is the edge and
**overwrites** `X-Forwarded-For` with the connecting address (never appends a client-supplied
value), and uvicorn trusts forwarding headers only from `FORWARDED_ALLOW_IPS` (set for the
private compose network; the API has no published port).

## Authorization

- **Role-based access control** on every route through `require_roles(...)`; `admin` passes
  every `coordinator` check. Self-signup can create farmers, buyers, transporters and
  coordinators, never admins.
- **Ownership and participation checks** in the services: farmers see their own harvests and the
  lots they belong to, buyers their own demands, offers and orders, transporters the requests
  they quoted or were booked on (full rules in [DOMAIN_RULES §1](DOMAIN_RULES.md#1-roles-scope-and-visibility)).
- **Not visible means 404**, not 403, so identifiers cannot be probed for existence. A wrong role
  for an action is `403`; an invalid state transition is `409`.
- **Field masking**: a farmer's full name is shown only to the farmer, coordinators, admins and
  the booked transporter of that lot; everyone else sees `Ravi K.`. A farmer's minimum acceptable
  price is visible only to that farmer, coordinators and admins. Masking is applied in the
  presenters, before data reaches a response or an AI prompt.
- **Counterparty trust**: unverified buyers can act but are flagged (`buyer_verified=false`) on
  every offer and listed as an unresolved condition in net-proceeds breakdowns until a
  coordinator verifies them.
- **Audit trail**: consequential actions (assisted consent, verification decisions, deal
  acceptance, delivery, payments and payouts, dispute decisions, contact requests) are written
  to the audit log with actor, entity and summary, visible to admins.

## Uploads

- Harvest photos only: JPEG, PNG or WebP up to `MAX_UPLOAD_MB` (8 MB), accepted from the owner
  farmer or a coordinator.
- The file type is established by **decoding the image with Pillow**, never from the file name
  or the client's `Content-Type`; Pillow's decompression-bomb guard applies.
- Every image is **re-encoded to WebP** (longest side at most 1,600 px). Re-encoding discards
  embedded metadata such as EXIF GPS coordinates and neutralises polyglot files.
- Stored under `MEDIA_DIR` with **random file names**; nothing user-supplied becomes a path.
- nginx caps request bodies on `/api` at 10 MB, so oversized uploads are rejected before they
  reach Python.

## HTTP security headers

| Header | API (middleware) | Web (nginx) |
|---|---|---|
| `X-Content-Type-Options: nosniff` | ✓ | ✓ |
| `X-Frame-Options: DENY` | ✓ | ✓ (and CSP `frame-ancestors 'none'`) |
| `Referrer-Policy: strict-origin-when-cross-origin` | ✓ | ✓ |
| `Permissions-Policy` | microphone and camera for self | microphone, camera and geolocation for self; payment, USB and topics off |
| `Content-Security-Policy` | n/a (JSON) | same-origin only: `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'` |
| `Cross-Origin-Opener-Policy: same-origin` | | ✓ |
| `Strict-Transport-Security` | when `APP_ENV=production` | set on the TLS terminator (see [DEPLOYMENT.md](DEPLOYMENT.md#tls-and-cookies)) |
| `X-Robots-Tag: noindex, nofollow` | | `/app/**` |
| `X-Request-ID` | ✓ (echoed or generated, used in logs) | passed through |

The site's CSP allows inline scripts and styles: the prerendered pages carry a one-line
pre-paint script (`no-js` → `js`), and React and motion write inline styles. Every other source
is restricted to the site's own origin, so injected markup cannot load or send anything to a
third-party host. The configuration lives in `infra/nginx/snippets/security-headers.conf`.

nginx also hides its version (`server_tokens off`).

## Secrets

- Configuration comes from the environment or `backend/.env`. Real `.env` files are git-ignored
  and excluded from Docker build contexts; only `.env.example` files with safe defaults are
  committed.
- `DEEPSEEK_API_KEY` stays on the server. The browser only learns the effective AI mode.
- Frontend build variables (`VITE_*`) are public by definition and must never hold secrets.
- In production, inject secrets through the platform's secret store or an `.env` file readable
  only by the deploying user (`chmod 600`), never through images or the repository.
- Rotate `JWT_SECRET` and the DeepSeek key on suspicion of exposure; rotating the JWT secret
  invalidates all sessions.

## Data privacy

MandiMate is designed around data minimisation and the principles of India's Digital Personal
Data Protection Act, 2023 (purpose limitation, minimisation, accuracy, security safeguards).
Formal compliance (notices, consent records, grievance officer, retention schedule) is an
operational obligation of whoever runs a pilot.

| Data | Why it is needed | Who sees it |
|---|---|---|
| Name, phone and/or email | Sign-in, contact for pickups and payments | The user, coordinators, admins; farmer names masked for other parties |
| Village, district, farm coordinates | Matching radius, route planning, pickup stops | Coordinators, admins, the booked transporter (as pickup stops) |
| Harvest details and photos | Listing, inspection evidence | Owner, coordinators, admins; buyers while listed or pooled |
| Minimum acceptable price | Advice against bad deals | Owner, coordinators, admins only |
| Offers, deliveries, settlements, payouts | The transaction record and dispute resolution | Participants of that lot, coordinators, admins |
| Voice transcripts | Drafting a listing | Processed for the request only; audio never leaves the device |

- No payment card or bank details are stored: settlements and payouts record amounts, dates and
  references, not instruments.
- Logs carry request ids and identifiers, not passwords, tokens or API keys.
- In live AI mode, prompts include only the data needed for that answer, already masked for the
  requesting user, and are sent to DeepSeek under its API terms. Deployments that cannot send
  data to an external processor run with `AI_MODE=mock`.
- Backups contain personal data: encrypt them and restrict access (see
  [DEPLOYMENT.md](DEPLOYMENT.md#backups)).

## Container and runtime hardening

- The API image runs as an unprivileged user (`mandimate`, uid 10001) on `python:3.12-slim` with
  only the locked runtime dependencies; dev tools and tests are not in the image.
- The API has no published host port in the container stack; it is reachable only through nginx.
- Both images ship health checks; the API waits for a healthy database and the web container for
  a healthy API.
- Database credentials in `docker-compose.yml` are development defaults. Override
  `POSTGRES_PASSWORD` (and `DATABASE_URL`) everywhere else, and do not publish port 5432 beyond
  localhost on a server.

## Threat model

| Threat | Vector | Mitigations | Residual risk |
|---|---|---|---|
| Account takeover by guessing | Credential stuffing, brute force on `/auth/login` | Argon2id, password policy, 5 failures / 5 min per identifier+IP, generic errors | Slow attacks spread across many IPs; counters are per process |
| Session theft | XSS reading tokens, network sniffing | `HttpOnly` cookies, React output escaping, same-origin CSP, `Secure` cookies + HSTS over TLS | Inline scripts are allowed by the CSP |
| Cross-site request forgery | Malicious site submitting to the API | `SameSite=Lax`, JSON API with CORS preflight, origin allowlist | Same-site subdomains under hostile control |
| Refresh token replay | Stolen refresh cookie | Single-use rotation tracked by `jti`, revocation on logout, short-lived access tokens | Window until the legitimate client refreshes |
| Token forgery | Weak or leaked signing key | Production startup check (≥ 32 chars, not the default), algorithm allowlist | Key leakage from the host |
| Horizontal privilege escalation (IDOR) | Guessing another user's harvest, offer or settlement id | Random UUIDs, ownership and participation checks, 404 for invisible records | Logic bugs in new endpoints; covered by API tests per role |
| Vertical privilege escalation | Farmer or buyer calling coordinator/admin actions | `require_roles` on every route, no admin self-signup, role loaded server-side | Coordinator accounts are powerful; audit log mitigates |
| Fraudulent buyer or non-payment | Fake buyer wins a lot | Verification workflow and visible flags, payment terms recorded, overdue tracking, disputes | Off-platform payment failures |
| Identity and price leakage | Competitors scraping farmer names or minimum prices | Masking in presenters, minimum price private, `/app` not indexed | Data shown to legitimate participants |
| Malicious upload | Polyglot or oversized image, path traversal | Pillow decoding, WebP re-encoding, random names, size caps in nginx and API | Pillow vulnerabilities; keep dependencies updated |
| Prompt injection | Instructions hidden in a transcript or note | User text treated as data, read-only tools, engine-owned numbers, schema validation, human confirmation | Misleading prose in an explanation; numbers and decisions unaffected |
| IP spoofing to evade throttling | Forged `X-Forwarded-For` | nginx overwrites forwarding headers; uvicorn trusts only the proxy network | Misconfigured extra proxies (use the realip module) |
| Clickjacking | Framing the app | `X-Frame-Options: DENY`, `frame-ancestors 'none'` | None known |
| Secret exposure | `.env` committed or baked into an image | `.gitignore`, `.dockerignore`, env injection at runtime | Operator error on the host |
| Insider misuse | Coordinator recording consent or payouts improperly | Audit log with actor and summary, farmer notifications on every consent and payout | Collusion; requires periodic audit review |
| Data loss | Disk failure, accidental `db-reset` on a server | Named volume, documented backups and restore drills | Backups not tested |
| Resource exhaustion | Huge lists, uploads, slow AI calls | List limits (max 500), body size caps, AI timeouts with rules fallback | Volumetric DDoS needs an upstream provider |

## Reporting a vulnerability

Report suspected vulnerabilities privately to the MandiMate maintainers rather than in a public
issue, with steps to reproduce and the affected version. Please do not access data that is not
yours while investigating.
