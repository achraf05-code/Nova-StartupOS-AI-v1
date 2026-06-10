# MaStartup AI

> AI co-founder for early-stage founders. Static SPA + Supabase (Auth, Postgres/RLS, Storage) + Vercel serverless functions for AI streaming, Stripe checkout, and webhooks.

[![Production-ready](https://img.shields.io/badge/status-production--ready-success)](./HARDENING_REPORT.md)
[![No build step](https://img.shields.io/badge/build-none-blue)]()
[![License: private](https://img.shields.io/badge/license-private-lightgrey)]()

> **Arabic technical reference:** [`TECHNICAL_SPECIFICATION.md`](./TECHNICAL_SPECIFICATION.md) — وثيقة المواصفات التقنية بالعربية.
> **Hardening details:** [`HARDENING_REPORT.md`](./HARDENING_REPORT.md) — full v1 → v2 audit and fix log.

---

## What it does

MaStartup AI helps founders go from idea to investor-ready in one place:

- **AI Copilot** — streaming conversations grounded in your active startup context
- **Business plan generator** — full investor-ready plan from a few inputs
- **Pitch deck generator** — 10-slide deck, exportable to PPTX/PDF/DOCX
- **Readiness assessment** — deterministic scoring across innovation, scalability, market, and investment signals
- **Funding & visa databases** — admin-curated catalog of accelerators, VCs, grants, and startup-visa programs
- **Admin & Super Admin** dashboards — users, subscriptions, blog, support tickets, AI providers, payment gateways, security, system health

---

## Architecture

```
                    ┌────────────────────────────────────────────────┐
                    │              index.html (SPA)                  │
                    │   js/main.js  js/admin.js  js/wizard.js …      │
                    └──────────────┬───────────────┬─────────────────┘
                          js/api.js │               │ js/ai.js
                                    │               │
            ┌───────────────────────▼─┐  ┌──────────▼─────────────────────┐
            │      Supabase JS SDK    │  │    Vercel Serverless Functions │
            │ (Auth + DB + Storage)   │  │  /api/ai-stream  /api/health   │
            │ RLS-enforced everywhere │  │  /api/stripe-checkout          │
            └──┬──────────────────────┘  │  /api/stripe-webhook           │
               │                         └──┬─────────────────────────┬───┘
               ▼                  service-role only                   ▼
   ┌──────────────────────────┐    ▼                          ┌──────────────┐
   │   Postgres (Supabase)    │ ┌─────────────────────────┐   │   Stripe     │
   │ profiles, startups,      │ │  AI Providers           │   │ Checkout +   │
   │ generated_documents,     │ │ OpenRouter / OpenAI /   │   │ Subscriptions│
   │ assessments,             │ │ Anthropic / Gemini /    │   └──────────────┘
   │ subscriptions, payments, │ │ DeepSeek                │
   │ ai_requests, audit_logs, │ └─────────────────────────┘
   │ notifications, …         │
   └──────────────────────────┘
```

**Key principles**

- **No build step.** The site ships as static HTML/CSS/JS — Vercel serves it directly.
- **No browser-stored secrets.** AI provider keys live only in Vercel env. The browser only holds the Supabase anon key, which is RLS-protected.
- **Server-side enforcement.** RLS on every table, JWT verification on every API route, Stripe webhook signatures verified on every event.
- **No demo / mock paths.** Login fails when Supabase fails. AI fails when no provider key is configured. Payments only update plans through verified webhook events.

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Vanilla JS, Bootstrap 5.3, Chart.js (no bundler) |
| Auth | Supabase Auth (email/password + OAuth Google/GitHub) |
| Database | Supabase Postgres with Row-Level Security |
| Storage | Supabase Storage (`startup-logos` bucket) |
| Serverless | Vercel Node.js functions (Node ≥ 18) |
| Payments | Stripe Checkout + webhooks |
| AI | OpenRouter / OpenAI / Anthropic / Gemini / DeepSeek (server proxy) |

---

## Repository layout

```
.
├── index.html                  # SPA shell (landing + dashboard)
├── css/                        # Design system + Bootstrap + plugins
├── img/  webfonts/             # Static assets
├── js/
│   ├── api.js                  # NovaApi — Supabase + serverless client
│   ├── ai.js                   # NovaAI — secure streaming wrapper
│   ├── main.js                 # App coordinator (DOM, auth listener, features)
│   ├── admin.js                # Admin / Super Admin engines
│   ├── store.js  wizard.js     # Local state + onboarding wizard
│   └── export.js               # PDF / DOCX / PPTX exporters
├── api/
│   ├── _lib/auth.js            # Shared CORS / JWT / rate-limit / audit helpers
│   ├── ai-stream.js            # Secure AI streaming proxy with provider fallback
│   ├── stripe-checkout.js      # Authenticated Stripe Checkout creator
│   ├── stripe-webhook.js       # Signature-verified Stripe webhook
│   └── health.js               # Admin-only system health probe
├── tests/run.js                # Smoke / unit tests (npm test)
├── supabase_schema.sql         # v1 baseline schema
├── supabase_schema_v2.sql      # v2 hardening migration (additive)
├── vercel.json                 # Rewrites + security headers + per-route limits
├── package.json                # 2 prod deps (stripe, supabase-js)
├── .env.example                # All required env vars
├── README.md                   # This file
├── HARDENING_REPORT.md         # v1 → v2 audit + fix log
└── TECHNICAL_SPECIFICATION.md  # Arabic technical spec
```

---

## Setup

### Prerequisites

- A **Supabase** project (free tier works)
- A **Stripe** account (test or live)
- AI provider key(s) for at least one of: OpenRouter, OpenAI, Anthropic, Gemini, DeepSeek
- Node.js ≥ 18 if you want to run `npm test` locally
- A **Vercel** account for deployment

### 1. Database migration

Open the Supabase SQL Editor and run, in order:

1. [`supabase_schema.sql`](./supabase_schema.sql) — base tables, RLS, helper functions
2. [`supabase_schema_v2.sql`](./supabase_schema_v2.sql) — adds `subscriptions`, `payments`, `ai_requests`, `usage_tracking`, `audit_logs`, `notifications`, `assessments`, `system_events`, `saved_funding`; column compatibility shims; storage bucket `startup-logos`

Both scripts are idempotent — safe to re-run.

### 2. Promote your first Super Admin

After signing up once, run in the SQL Editor:

```sql
update public.profiles set role = 'Super Admin' where email = 'you@example.com';
```

### 3. Wire the public Supabase keys into the SPA

Pick one of three methods. **Recommended for production:** inline `<script>` in `index.html`, just before `js/api.js`:

```html
<script>
  window.SUPABASE_URL = 'https://your-project-id.supabase.co';
  window.SUPABASE_ANON_KEY = 'your-anon-public-key';
</script>
```

For local-only testing you can use `localStorage`:

```js
localStorage.setItem('nova.supabase_url', 'https://your-project-id.supabase.co');
localStorage.setItem('nova.supabase_anon_key', 'your-anon-public-key');
location.reload();
```

> The anon key is RLS-protected and safe in the browser. **Never** put `service_role` here.

### 4. Configure server-side env vars (Vercel)

Set these in **Vercel → Project Settings → Environment Variables**:

| Variable | Required? | Purpose |
|---|---|---|
| `SUPABASE_URL` | ✅ | Same as the browser value |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Bypasses RLS for server-side reads/writes (webhook, AI proxy) |
| `OPENROUTER_API_KEY` | one of these | OpenRouter access |
| `OPENAI_API_KEY` | one of these | Native OpenAI |
| `ANTHROPIC_API_KEY` | optional | Native Claude (falls back via OpenRouter) |
| `GEMINI_API_KEY` | optional | Native Gemini (falls back via OpenRouter) |
| `DEEPSEEK_API_KEY` | optional | Native DeepSeek |
| `STRIPE_SECRET_KEY` | ✅ for billing | Stripe API |
| `STRIPE_WEBHOOK_SECRET` | ✅ for billing | Verifies webhook signatures |
| `STRIPE_PRICE_PRO_MONTHLY` `…_PRO_YEARLY` `…_STARTUP_MONTHLY` `…_STARTUP_YEARLY` | ✅ for billing | Server-controlled price mapping |
| `SITE_URL` | ✅ | Public URL for Stripe success/cancel redirects |
| `ALLOWED_ORIGINS` | ✅ | Comma-separated CORS allowlist for `/api/*` |
| `AI_DAILY_LIMIT` | optional | Per-user daily AI quota (default 200) |
| `AI_MAX_TOKENS` | optional | Hard cap on completion tokens (default 2048) |

A complete template lives in [`.env.example`](./.env.example).

### 5. Configure Supabase Auth redirects

In **Supabase Dashboard → Authentication → URL Configuration**:

- **Site URL:** `https://your-domain.com`
- **Redirect URLs:** add `https://your-domain.com` and `https://your-domain.com/**`

OAuth (Google / GitHub) won't redirect back correctly without this.

### 6. Configure Stripe

In the **Stripe Dashboard**:

1. Create the four prices (Pro monthly / yearly, Startup monthly / yearly) and copy their IDs into the matching `STRIPE_PRICE_*` env vars.
2. Add a webhook endpoint pointing at `https://your-domain.com/api/stripe-webhook`. Subscribe to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
3. Copy the webhook signing secret into `STRIPE_WEBHOOK_SECRET`.

### 7. Deploy to Vercel

```bash
git init
git add .
git commit -m "MaStartup AI v2 — production hardening"
gh repo create mastartup --private --source=. --remote=origin --push
```

In Vercel: **Add New → Project → Import** with these settings:

| Setting | Value |
|---|---|
| Framework Preset | Other |
| Root Directory | `./` |
| Build Command | (leave blank) |
| Output Directory | (leave blank) |
| Install Command | (leave blank) |

Click **Deploy**. Vercel reads `vercel.json` for the rewrites, security headers, and function configuration.

Every subsequent `git push` to `main` triggers an automatic deploy.

---

## API surface

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/ai-stream` | POST | Bearer JWT | Streaming AI completion. Verifies JWT, enforces rate limit, walks provider chain, persists to `ai_requests` |
| `/api/stripe-checkout` | POST | Bearer JWT | Creates a hosted Stripe Checkout session for `{plan, cycle}` |
| `/api/stripe-webhook` | POST | Stripe signature | Upserts `subscriptions` and `payments`, syncs `profiles.plan_tier`, writes notifications |
| `/api/health` | GET | Bearer JWT (Admin only) | Probes DB, AI config, storage, Stripe; persists to `system_events` |

All `/api/*` routes honor the `ALLOWED_ORIGINS` allowlist for CORS.

---

## Roles

Defined in `profiles.role`, enum-checked: `'User' | 'Admin' | 'Super Admin'`.

| Role | Access |
|---|---|
| User | Founder dashboard (My Startups, Documents, Plans, Decks, Readiness, Funding, Visa, Copilot, Billing, Settings). Reads / writes only their own data |
| Admin | Everything in User + Admin Dashboard, Users, Subscriptions, Funding DB, Visa DB, Blog, Support Tickets, Audit Logs |
| Super Admin | Everything in Admin + AI Providers, Payment Gateways, Email, Security (blocked IPs), System Health |

Privilege escalation attempts are logged automatically by a Postgres trigger (`log_profile_role_changes`) into `audit_logs`.

---

## Security

| Control | Status |
|---|---|
| RLS on every public table | ✅ |
| Service-role key never reaches the browser | ✅ |
| JWT verified on every authenticated API call | ✅ |
| Stripe webhook signatures verified | ✅ |
| Strict CSP, HSTS, Permissions-Policy via `vercel.json` | ✅ |
| Per-user daily AI rate limit (`AI_DAILY_LIMIT`) | ✅ |
| IP blocklist consulted on AI calls (`blocked_ips`) | ✅ |
| Audit log of role and status changes (DB trigger) | ✅ |
| Audit log of AI calls and checkout starts (server) | ✅ |
| CORS allowlist (`ALLOWED_ORIGINS`) | ✅ |
| XSS-safe admin tables (no inline JSON in `onclick=`) | ✅ |
| No browser-stored provider secrets | ✅ |

For the full list of items addressed in v2, see [`HARDENING_REPORT.md`](./HARDENING_REPORT.md).

---

## Testing

```bash
npm test
```

Runs `tests/run.js` — pure-logic tests for the assessment engine, deck JSON parser, Stripe price mapping, and AI provider fallback chain. No Supabase or network access required.

```
Assessment scoring          ✓ 4/4
Deck JSON parsing           ✓ 3/3
Stripe price mapping        ✓ 2/2
AI provider fallback chain  ✓ 1/1

10 passed, 0 failed
```

For end-to-end checks against live Stripe / Supabase, use sandbox credentials.

---

## Post-deployment verification

After deploying, walk through this in order. Any failure points at a misconfiguration.

1. **Auth** — sign up with a real email, then log in.
2. **Session persistence** — refresh the page, the dashboard should rehydrate without re-login.
3. **Storage** — create a startup with a logo. The image must render after page reload.
4. **AI** — open the Copilot, send a prompt. The reply must stream from the secure proxy. Check Supabase → `ai_requests` for a new row.
5. **Assessment** — click Re-run Assessment. Verify a row in `assessments` and that `startups.startup_score` updated.
6. **Stripe (test mode)** — click "Select Plan" on Pro. Complete the test card flow (`4242 4242 4242 4242`). Verify:
   - Webhook event in the Stripe dashboard shows `checkout.session.completed` ✓ delivered
   - `subscriptions` row is created with status `active`
   - `payments` row is created with status `succeeded`
   - `profiles.plan_tier` flipped to `Pro`
   - A `notifications` row exists for the user

If anything fails, check the Vercel function logs first, then the Supabase Postgres logs.

---

## Roadmap

These items are deliberately out of scope for v2 — see [`HARDENING_REPORT.md` § 10](./HARDENING_REPORT.md) for the full list with reasons.

- Stripe customer portal endpoint (`/api/stripe-portal`)
- Native Anthropic / Gemini streaming (currently fall back through OpenRouter)
- PayPal integration
- CMS editor for landing-page content
- Email-template editor
- Per-IP rate limiting on anonymous routes

---

## License

Private. All rights reserved.

---

<div align="center">

Made for startup founders by startup founders.
**MaStartup AI** — صُنع لمؤسّسي الشركات الناشئة 🚀

</div>
