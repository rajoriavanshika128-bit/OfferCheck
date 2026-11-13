# OfferCheck — Backend Development Progress

**Project:** OfferCheck — Internship & Job Fraud Intelligence Platform  
**Location:** `/Users/vanshikarajoria/Desktop/offercheck`  
**Status:** Phase 2B Step 1 (PostgreSQL Database Setup) — ✅ COMPLETE

---

## Phase 1 — Database Architecture & Design ✅ COMPLETE

| Deliverable | Status |
|---|---|
| ER diagram (ASCII + cardinality table) | ✅ Done — `backend-design.md §2` |
| PostgreSQL schema (DDL, types, PKs, FKs, constraints, indexes) | ✅ Done — `backend-design.md §3` |
| Normalisation proof (1NF, 2NF, 3NF with mock data examples) | ✅ Done — `backend-design.md §4` |
| Prisma schema (v2, corrected, all 15 models) | ✅ Done — `backend-design.md §5` |
| SQL examples (INNER JOIN, LEFT JOIN, GROUP BY/HAVING, subquery, recursive CTE) | ✅ Done — `backend-design.md §6` |
| Transaction & rollback example (admin moderation) | ✅ Done — `backend-design.md §7` |
| Mock data → database mapping | ✅ Done — `backend-design.md §8` |
| Security & data integrity risk table | ✅ Done — `backend-design.md §9` |
| Recommended architecture, design decisions, implementation order | ✅ Done — `backend-design.md §10` |
| Architecture review | ✅ Done — `BACKEND_REVIEW.md` |
| All 8 design corrections applied | ✅ Done — both documents consistent |

---

## Final Schema — 15 Tables

```
users                 — authentication, roles, is_banned
refresh_tokens        — JWT rotation, hashed token, family reuse detection
companies             — employer entities
recruiters            — individual contacts
recruiter_companies   — M:N junction
reports               — core fraud incident records
identifiers           — deduped contact points
report_identifiers    — M:N + confidence + match_type + match_description
risk_assessments      — versioned; is_current=TRUE is active
risk_factors          — per-factor breakdown rows
clusters              — fraud actor groups (risk score computed, not stored)
cluster_reports       — M:N junction
saved_reports         — user bookmarks
offer_checks          — lookup history (JSONB snapshot + ip_hash)
audit_logs            — immutable admin log (+ target_user_id)
```

**Dropped from original:** `evidence` (merged into `report_identifiers`), `cluster_identifiers` (dropped — derived via SQL JOIN)  
**Added:** `refresh_tokens`

---

## Key Design Decisions

1. `evidence` merged as `match_type`/`match_description` on `report_identifiers` — eliminates one JOIN
2. `cluster_identifiers` dropped for v1 — cluster's identifiers derived via JOIN on `report_identifiers` + `cluster_reports`
3. `clusters.risk_score` removed — computed on demand via `AVG(ra.score)` JOIN (3NF compliance)
4. `risk_assessments` versioned (1:N) — `is_current = TRUE` marks active version; partial unique index via custom SQL migration
5. `offer_checks.result` = `JSONB NOT NULL` — snapshot at check time; nullify after 90 days
6. `offer_checks.ip_hash` = `CHAR(64)` SHA-256(client IP) — rate limiting without Redis, without storing PII
7. `refresh_tokens.token_hash` = `CHAR(64)` SHA-256 (not bcrypt — lookup performance); `family UUID` for rotation chain
8. `audit_logs.target_user_id` — for `USER_BANNED`/`IDENTIFIER_REVEALED` events; 4-way OR CHECK constraint
9. Recursive CTE for Trust Graph — no graph database needed; PostgreSQL sufficient at this scale
10. `tsvector` GIN indexes for FTS — sufficient to ~50k reports; Meilisearch at scale

---

## Prisma Migration Notes

The following cannot be expressed in `schema.prisma` and **must be added as raw SQL** in the migration file:

```sql
-- 1. Partial unique index (only one active risk assessment per report)
CREATE UNIQUE INDEX idx_risk_assessments_current
  ON risk_assessments (report_id) WHERE is_current = TRUE;

-- 2. Partial index (fast lookup of non-revoked refresh tokens)
CREATE INDEX idx_refresh_tokens_active
  ON refresh_tokens (token_hash) WHERE revoked_at IS NULL;

-- 3. CHECK on audit_logs (at least one target must be non-null)
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_has_target
  CHECK (
    report_id      IS NOT NULL OR
    identifier_id  IS NOT NULL OR
    cluster_id     IS NOT NULL OR
    target_user_id IS NOT NULL
  );

-- 4. CHECK on reports (reviewed_at requires reviewed_by)
ALTER TABLE reports ADD CONSTRAINT chk_reviewed
  CHECK (reviewed_at IS NULL OR reviewed_by IS NOT NULL);
```

---

## Phase 2B Step 1 — PostgreSQL Database Setup ✅ COMPLETE

**Completed:** 2026-11-13

### Pre-flight Checks

| Check | Result |
|---|---|
| Git branch | ✅ `main`, HEAD = `4cc0846` |
| Working tree | ✅ Clean (no uncommitted tracked changes) |
| `DATABASE_URL` target | ✅ `postgresql://[credentials]@localhost:5432/offercheck_dev` |
| Database before migration | ✅ Confirmed empty — 0 tables, 0 enums |
| Prisma binary present | ✅ `node_modules/.bin/prisma` |
| `prisma validate` | ✅ exit 0 — "schema is valid 🚀" |

### Schema Verification — All 15 Models ✅

| Table | PK | FK(s) | Unique | Nullable | On Delete |
|---|---|---|---|---|---|
| `users` | `id` UUID | — | `email` | `college` | — |
| `refresh_tokens` | `id` UUID | `user_id → users` | `token_hash` | `revoked_at` | CASCADE |
| `companies` | `id` UUID | — | `domain` | `domain`, `industry`, `registered_state` | — |
| `recruiters` | `id` UUID | — | — | `phone`, `email` | — |
| `recruiter_companies` | `(recruiter_id, company_id)` | both → parent tables | — | — | CASCADE both |
| `reports` | `id` UUID | `submitted_by → users` RESTRICT, `reviewed_by → users` SET NULL, `company_id` SET NULL, `recruiter_id` SET NULL | — | most raw fields, `reviewed_by/at` | RESTRICT / SET NULL |
| `identifiers` | `id` UUID | — | `(type, normalized_value)` | `notes` | — |
| `report_identifiers` | `(report_id, identifier_id)` | `report_id → reports` CASCADE, `identifier_id → identifiers` RESTRICT, `added_by → users` SET NULL | — | `match_type`, `match_description`, `added_by` | CASCADE / RESTRICT / SET NULL |
| `risk_assessments` | `id` UUID | `report_id → reports` CASCADE | partial unique WHERE `is_current=TRUE` | `summary`, `disclaimer` | CASCADE |
| `risk_factors` | `id` UUID | `assessment_id → risk_assessments` CASCADE | — | `evidence_text` | CASCADE |
| `clusters` | `id` UUID | — | — | `description`, `connection_basis` | — |
| `cluster_reports` | `(cluster_id, report_id)` | both → parent tables CASCADE | — | — | CASCADE both |
| `saved_reports` | `(user_id, report_id)` | both → parent tables CASCADE | — | — | CASCADE both |
| `offer_checks` | `id` UUID | `user_id → users` SET NULL | — | most fields | SET NULL |
| `audit_logs` | `id` UUID | `actor_id → users` RESTRICT, `target_user_id` SET NULL, `report_id` SET NULL, `identifier_id` SET NULL, `cluster_id` SET NULL | — | all target fields | RESTRICT / SET NULL |

### Migration

| Item | Result |
|---|---|
| Migration name | `20261113082200_init` |
| File | `backend/prisma/migrations/20261113082200_init/migration.sql` |
| Prisma-generated DDL | ✅ 15 tables, 7 enums, 4 unique indexes, 18 foreign keys |
| Custom SQL appended | ✅ 4 blocks (see below) |
| Applied with | `prisma migrate deploy` (no reset, no data loss) |
| `prisma migrate status` | ✅ "Database schema is up to date!" |

**Custom SQL added to migration (not expressible in schema.prisma):**

```sql
-- 1. Partial unique index: at most one is_current=TRUE assessment per report
CREATE UNIQUE INDEX "idx_risk_assessments_current"
  ON "risk_assessments" ("report_id") WHERE "is_current" = TRUE;

-- 2. Partial index: fast hot-path lookup of non-revoked refresh tokens
CREATE INDEX "idx_refresh_tokens_active"
  ON "refresh_tokens" ("token_hash") WHERE "revoked_at" IS NULL;

-- 3. CHECK: audit_logs must have at least one target reference
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_has_target"
  CHECK ("report_id" IS NOT NULL OR "identifier_id" IS NOT NULL
      OR "cluster_id" IS NOT NULL OR "target_user_id" IS NOT NULL);

-- 4. CHECK: reports.reviewed_at requires reviewed_by to be set
ALTER TABLE "reports" ADD CONSTRAINT "chk_reviewed"
  CHECK ("reviewed_at" IS NULL OR "reviewed_by" IS NOT NULL);
```

### Database Verification (Read-Only)

| Check | Result |
|---|---|
| Tables in `public` schema | ✅ 15 app tables + `_prisma_migrations` = 16 total |
| Enums created | ✅ 7: `UserRole`, `ReportStatus`, `IdentifierType`, `ConfidenceLevel`, `RiskCategory`, `ClusterStatus`, `AuditAction` |
| `users_email_key` unique index | ✅ Present |
| `refresh_tokens_token_hash_key` unique index | ✅ Present |
| `companies_domain_key` unique index | ✅ Present |
| `identifiers_type_normalized_value_key` unique index | ✅ Present |
| `idx_risk_assessments_current` partial unique index | ✅ Present — `WHERE is_current = TRUE` |
| `idx_refresh_tokens_active` partial index | ✅ Present — `WHERE revoked_at IS NULL` |
| `audit_logs_has_target` CHECK constraint | ✅ Present |
| `chk_reviewed` CHECK constraint | ✅ Present |
| `audit_logs_actor_id_fkey` ON DELETE RESTRICT | ✅ Present |
| `reports_submitted_by_fkey` ON DELETE RESTRICT | ✅ Present |
| All 15 tables empty | ✅ 0 rows each (no seed data) |

### Prisma Client Connection Test

| Test | Result |
|---|---|
| `PrismaClient` connects to `offercheck_dev` | ✅ exit 0 |
| `count()` on all 15 models | ✅ All return 0 (no errors) |

### Express Health Endpoint

| Test | Result |
|---|---|
| `GET /health` | ✅ HTTP 200 — `{"status":"ok","service":"offercheck-api","env":"development","timestamp":"..."}` |

### Files Created or Modified

| File | Action |
|---|---|
| `backend/prisma/migrations/20261113082200_init/migration.sql` | ✅ Created (Prisma DDL + 4 custom SQL blocks) |
| `backend/prisma/migrations/20261113082200_init/migration.lock` | ✅ Created by Prisma |
| `BACKEND_PROGRESS.md` | ✅ Updated |

### Preservation Confirmations

- ✅ No frontend files modified (`git diff HEAD -- src/` → empty)
- ✅ No mock data files modified
- ✅ No `prisma db push`, no `migrate reset`, no `DROP`
- ✅ No new npm packages installed
- ✅ No secrets printed or exposed
- ✅ Not committed or pushed (awaiting approval)

### Warnings

- ℹ️ Prisma CLI showed upgrade notice (v6.19.3 → v8.0.0-rc.33). **Ignored** — RC version; v6 is stable and correct for this project.

---

## Phase 2A — Backend Foundation ✅ COMPLETE

**Completed:** 2026-11-13

### Environment

| Check | Result |
|---|---|
| PostgreSQL 16 running | ✅ |
| `offercheck_dev` database exists | ✅ |
| Root `.env` configured (6 vars) | ✅ |
| `.env` git-ignored | ✅ (`.gitignore:25`) |
| `.env.example` created | ✅ |
| Node.js version | ✅ v24 |
| npm version | ✅ v10+ |

### Dependencies Installed

Located in `backend/node_modules/` — 261 packages total. **Do not reinstall.**

| Package | Version |
|---|---|
| `express` | 4.22.3 |
| `prisma` | 6.19.3 |
| `@prisma/client` | 6.19.3 |
| `bcryptjs` | 3.0.3 |
| `jsonwebtoken` | 9.0.3 |
| `zod` | 4.6.7 |
| `cors` | 2.8.6 |
| `dotenv` | 18.0.10 |
| `helmet` | 8.3.0 |

> **Note:** `npm install` reported 3 high-severity advisories at install time (Express/body-parser chain). Not force-fixed per user rules — no `npm audit fix --force`.

### Files Created

| Path | Purpose |
|---|---|
| `backend/package.json` | Project manifest, npm scripts, engine constraint `>=18.0.0` |
| `backend/.gitignore` | Ignores `node_modules/`, `.env`, `.env.*`, allows `.env.example` |
| `backend/prisma/schema.prisma` | 15-model Prisma v2 schema (validated ✅) |
| `backend/src/server.js` | Entry point: env loading, fail-fast var check, `app.listen()`, graceful shutdown |
| `backend/src/app.js` | Express setup: helmet, CORS, body parsing, routes, 404, error handler |
| `backend/src/routes/health.routes.js` | `GET /` → `{status, service, env, timestamp}` |
| `backend/src/utils/errors.js` | `AppError` class + `errorHandler` middleware (Zod, JWT, operational, unknown) |
| `backend/src/utils/prisma.js` | PrismaClient singleton with env fallback loading |
| `backend/src/middleware/auth.js` | JWT verify stub (Phase 2B) |
| `backend/src/middleware/requireAdmin.js` | Role guard stub (Phase 2B) |
| `backend/src/middleware/validate.js` | Zod schema wrapper middleware |
| `backend/src/controllers/` | Empty directory (Phase 2B) |
| `backend/src/services/` | Empty directory (Phase 2B) |

### npm Scripts

| Script | Command | Purpose |
|---|---|---|
| `start` | `node src/server.js` | Production start |
| `dev` | `node --watch src/server.js` | Dev with file watching |
| `prisma:generate` | `dotenv run -q -f ../.env -- prisma generate` | Generate Prisma Client |
| `prisma:validate` | `dotenv run -q -f ../.env -- prisma validate` | Validate schema |
| `prisma:migrate` | `dotenv run -q -f ../.env -- prisma migrate dev` | Run migrations |
| `prisma:studio` | `dotenv run -q -f ../.env -- prisma studio` | Open Prisma Studio |
| `lint` | `node --check <files>` | Syntax-check all source files |

### Test Results

| Test | Result |
|---|---|
| `npm run lint` | ✅ exit 0 — all files syntax-clean |
| `npm run prisma:validate` | ✅ exit 0 — "schema is valid 🚀" |
| `npm run prisma:generate` | ✅ exit 0 — Prisma Client v6.19.3 generated |
| `GET /health` → HTTP 200 | ✅ `{"status":"ok","service":"offercheck-api","env":"development","timestamp":"..."}` |
| Helmet headers present | ✅ `x-dns-prefetch-control`, `x-frame-options`, `strict-transport-security` confirmed |
| 404 for unknown route | ✅ HTTP 404 `{"success":false,"error":"Route not found"}` |
| 6 required env vars present | ✅ All non-empty, correct lengths, no values exposed |
| Frontend `npm run build` | ✅ exit 0 — 2496 modules, frontend untouched |
| `.env` git-ignored | ✅ confirmed |
| No tracked file modifications | ✅ `git diff` empty |

### Security Confirmations

- ✅ No secrets printed or logged at any point
- ✅ Root `.env` read by path resolution (`../../.env` from `src/`); never duplicated or hardcoded
- ✅ Fail-fast check: server exits with `[FATAL]` if any required var is missing (never logs values)
- ✅ Helmet applied globally before routes
- ✅ CORS origin locked to `http://localhost:5173` (Vite dev server) by default
- ✅ Body size limit: `50kb`
- ✅ No database migrations run — `offercheck_dev` schema is empty

### Preservation Confirmations

- ✅ All frontend files untouched
- ✅ All mock data files (`src/data/*.js`) untouched
- ✅ No tracked Git files modified

---

## Phase 2 — Implementation Order (Pending Approval)

**⛔ Do not start Phase 2 without explicit user approval.**

```
1.  Set up Node.js + Express project (backend/ subfolder)
2.  Install: express, prisma, @prisma/client, bcryptjs, jsonwebtoken, zod, cors, dotenv, helmet
3.  Write prisma/schema.prisma from backend-design.md §5 (v2)
4.  Write custom SQL migration blocks (see above)
5.  Run: npx prisma migrate dev --name init
6.  Write seed.js — convert 7 mock data files to DB inserts with normalisation
7.  Run: npx prisma db seed — verify 15 tables seeded
8.  Auth routes: POST /api/auth/signup, /login, /refresh, /logout
9.  JWT middleware + requireAdmin middleware
10. Zod validation schemas for all request bodies
11. Global error handler
12. GET /api/reports (list, filter, keyset pagination)
13. GET /api/reports/:id (with identifiers, risk factors, role masking)
14. POST /api/reports (normalise → upsert identifiers → compute risk → version assessment)
15. POST /api/checks (offer check, ip_hash, JSONB snapshot)
16. GET /api/identifiers, GET /api/identifiers/:id
17. GET /api/clusters (computed risk score via JOIN)
18. GET /api/graph?start=:id&depth=:n (recursive CTE)
19. Admin routes: PATCH /api/admin/reports/:id, /identifiers/:id, GET /api/admin/stats, /audit-logs, /users
20. Replace mockApi.js with real fetch() calls and test every route end-to-end
21. Remove mock data files ONLY after all routes pass against the live API
```

---

## Documents

| File | Purpose | Status |
|---|---|---|
| `backend-design.md` | Full database architecture (1600+ lines) | ✅ v2 finalized |
| `BACKEND_REVIEW.md` | Architecture review — scores, corrections, decisions | ✅ v2 finalized |
| `BACKEND_PROGRESS.md` | This file — progress tracking | ✅ Created |

---

*Last updated: Phase 2B Step 1 complete. Awaiting approval for Phase 2B Step 2 (seed data / API).*

