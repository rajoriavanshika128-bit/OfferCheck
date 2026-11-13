# OfferCheck — Backend Development Progress

**Project:** OfferCheck — Internship & Job Fraud Intelligence Platform  
**Location:** `/Users/vanshikarajoria/Desktop/offercheck`  
**Status:** Phase 4B (Refresh Tokens, Rotation, Reuse Detection & Logout) — ✅ COMPLETE

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

## Phase 3 — Database Seeding ✅ COMPLETE

**Completed:** 2026-11-13

### Summary of Implementation

Phase 3 seed implementation is complete. The baseline mock dataset was transformed and inserted into the local PostgreSQL `offercheck_dev` database following the approved architecture design, 5 sequential dependency-ordered transactions, and non-destructive `upsert` semantics with `update: {}`.

### Implementation Files

| File | Action | Details |
|---|---|---|
| `backend/prisma/seed.js` | Created | Standalone idempotent seed script (~480 lines). Preflight safety checks, bcrypt password hashing, 5 transactions, documented CL005 `verified` → `resolved` mapping, non-evidenced pair handling without fabrication, and post-seed assertions. |
| `backend/package.json` | Modified | Added `"prisma:seed": "dotenv run -q -f ../.env -- prisma db seed"` and `"prisma": { "seed": "node prisma/seed.js" }`. |

### Execution & Idempotency Results

| Run | Command | Exit Code | Result |
|---|---|---|---|
| First Run | `cd backend && npm run prisma:seed` | 0 | All 5 transactions executed; seeded all 13 tables from 0 to expected counts. |
| Second Run | `cd backend && npm run prisma:seed` | 0 | Idempotency confirmed: 0 duplicate rows created, 0 existing values overwritten (`update: {}`). All counts identical. |

### Verified Database Row Counts (All 15 Tables)

Directly queried from `offercheck_dev` after completion:

| Table | Expected | First Run | Second Run | Verified Post-Seed | Status |
|---|---|---|---|---|---|
| `users` | 2 | 2 | 2 | 2 | ✅ Exact match |
| `companies` | 20 | 20 | 20 | 20 | ✅ Exact match |
| `recruiters` | 25 | 25 | 25 | 25 | ✅ Exact match |
| `recruiter_companies` | 25 | 25 | 25 | 25 | ✅ Exact match |
| `reports` | 35 | 35 | 35 | 35 | ✅ Exact match |
| `identifiers` | 70 | 70 | 70 | 70 | ✅ Exact match |
| `report_identifiers` | 107 | 107 | 107 | 107 | ✅ Exact match |
| `risk_assessments` | 35 | 35 | 35 | 35 | ✅ Exact match |
| `risk_factors` | 92 | 92 | 92 | 92 | ✅ Exact match |
| `clusters` | 7 | 7 | 7 | 7 | ✅ Exact match |
| `cluster_reports` | 22 | 22 | 22 | 22 | ✅ Exact match |
| `saved_reports` | 3 | 3 | 3 | 3 | ✅ Exact match |
| `audit_logs` | 30 | 30 | 30 | 30 | ✅ Exact match |
| `offer_checks` | 0 | 0 | 0 | 0 | ✅ Empty (as required) |
| `refresh_tokens` | 0 | 0 | 0 | 0 | ✅ Empty (as required) |

### Integrity & Constraint Verification (Zero Violations)

| Check | Expected | Actual Violations | Result |
|---|---|---|---|
| Duplicate `(type, normalized_value)` identifiers | 0 | 0 | ✅ PASS |
| Duplicate `is_current = TRUE` risk assessments per report | 0 | 0 | ✅ PASS (`idx_risk_assessments_current` intact) |
| Orphaned `cluster_reports` junction rows | 0 | 0 | ✅ PASS |
| Orphaned `report_identifiers` junction rows | 0 | 0 | ✅ PASS |
| Orphaned `risk_factors` rows | 0 | 0 | ✅ PASS |
| Orphaned `recruiter_companies` junction rows | 0 | 0 | ✅ PASS |
| Orphaned `saved_reports` junction rows | 0 | 0 | ✅ PASS |
| `audit_logs` missing target constraint (`audit_logs_has_target`) | 0 | 0 | ✅ PASS |
| `chk_reviewed` constraint on reports | 0 | 0 | ✅ PASS |

### Preservation Confirmations

- ✅ All frontend files untouched (`git diff HEAD -- src/` → empty)
- ✅ All original mock data files (`src/data/*.js`) untouched
- ✅ No schema or migration files modified
- ✅ No destructive SQL executed (`DROP`, `TRUNCATE`, `DELETE`, `deleteMany`, `db push`, `migrate reset`)
- ✅ No environment secrets printed or staged
- ✅ Changes not committed or pushed (awaiting review)

---

## Phase 4B — Refresh Tokens, Rotation, Reuse Detection & Logout ✅ COMPLETE

**Completed:** 2026-11-13

### Endpoints Implemented

| Endpoint | Method | Middleware | Purpose |
|---|---|---|---|
| `/api/auth/refresh` | POST | `validate(refreshSchema)` | Rotates refresh token atomically, enforces reuse detection, revokes entire family on theft detection, issues new access + refresh token. |
| `/api/auth/logout` | POST | `validate(logoutSchema)` | Revokes submitted refresh token and its active family chain in PostgreSQL. |
| `/api/auth/signup` | POST | `validate(signupSchema)` | Updated to issue opaque refresh token with SHA-256 hash and UUID `family` alongside access token. |
| `/api/auth/login` | POST | `validate(loginSchema)` | Updated to issue opaque refresh token with SHA-256 hash and UUID `family` alongside access token. |

### Security & Concurrency Measures Implemented

1. **Opaque 256-Bit Refresh Tokens:** Generated using `crypto.randomBytes(32).toString('hex')` (64 hex characters). Only SHA-256 hashes (`CHAR(64)`) are stored in PostgreSQL; raw tokens are never persisted or logged.
2. **Atomic Token Rotation:** Inside `prisma.$transaction`, the current active token is conditionally revoked (`where: { id, revokedAt: null }`), and a new refresh token is issued under the same UUID `family`.
3. **Token Reuse Detection:** If an already-revoked refresh token is presented, the entire family is immediately revoked (`updateMany({ where: { family, revokedAt: null } })`), neutralizing compromised token chains and returning HTTP 401.
4. **Concurrency Conflict Protection:** When two requests attempt rotation with the same token concurrently, exactly one succeeds (`count === 1`). The losing request's conditional update matches 0 rows and returns HTTP 409 Conflict without destroying the winner's newly issued session.
5. **Account Suspension on Refresh:** If a user is banned (`isBanned: true`), refresh attempts are rejected with HTTP 403 and all active refresh tokens for that user are revoked.
6. **Transaction Atomicity & Rollback:** If any database failure occurs during rotation, all partial writes are rolled back, leaving zero orphaned or partially revoked tokens.
7. **Cascade Deletion:** `userId` foreign key constraint (`ON DELETE CASCADE`) ensures deleting a user cleanly deletes all associated `refresh_tokens`.
8. **Atomic Signup Transaction:** User creation and initial refresh token creation run inside a single `prisma.$transaction`, ensuring user creation rolls back completely if initial token issuance fails.
9. **PostgreSQL Row-Lock Serialization (`FOR UPDATE`):** `rotateRefreshToken` locks the `users` row using `SELECT id, email, role, is_banned AS "isBanned" FROM users WHERE id = $1 FOR UPDATE`. This strictly serializes rotation with admin suspension (`UPDATE users SET is_banned = TRUE`):
   - Any concurrent suspension attempt during rotation is blocked until rotation commits (at which point the admin immediately revokes the newly issued token).
   - Any rotation attempt arriving while an admin suspension is in flight is blocked until the admin commits, whereupon rotation immediately reads `isBanned = true`, aborts, and rejects with HTTP 403.

### Verification & Automated Test Results (35 / 35 Passed)

Executed against isolated test database `offercheck_test`:

| # | Test Case | Expected | Result |
|---|---|---|---|
| 1–22 | All Phase 4A Regression Tests | All 22 Phase 4A auth, bcrypt, Zod byte limit, and error tests pass | ✅ PASS |
| 23 | Successful refresh token rotation | HTTP 200, new access token + new refresh token in same family | ✅ PASS |
| 24 | Previous token reuse triggers family revocation | HTTP 401, all tokens in family revoked in DB | ✅ PASS |
| 25 | Subsequent rotation with compromised family token rejected | HTTP 401 on attempts to use any token from revoked family | ✅ PASS |
| 26 | Unknown and malformed refresh tokens rejected | HTTP 401 on nonexistent token, HTTP 400 on empty token | ✅ PASS |
| 27 | Expired refresh token rejected | HTTP 401 'Refresh token expired' | ✅ PASS |
| 28 | Logout and subsequent refresh rejection | HTTP 200 on logout, token revoked in DB, subsequent refresh fails | ✅ PASS |
| 29 | Banned user refresh rejection & session revocation | HTTP 403, all active refresh tokens for user revoked | ✅ PASS |
| 30 | Two concurrent requests using same token handled safely | Exactly one 200 winner, one 409 conflict, zero 500s | ✅ PASS |
| 31 | Transaction failure and rollback verified | Database state completely rolled back on transaction error | ✅ PASS |
| 32 | Cascade deletion of refresh tokens on user delete | All refresh tokens removed when user is deleted | ✅ PASS |
| 33 | Atomic signup rollback on refresh token creation failure | User creation completely rolled back if initial token insert fails | ✅ PASS |
| 34 | Concurrent suspension serialized via `FOR UPDATE` | Admin suspension blocked during rotation tx; completes after commit | ✅ PASS |
| 35 | Rotation blocked behind active suspension | Unblocks after admin commit, observes `isBanned = true`, aborts with 403 | ✅ PASS |

---

## Phase 4A — Signup, Login & Access Authentication ✅ COMPLETE

**Completed:** 2026-11-13

### Endpoints Implemented

| Endpoint | Method | Middleware | Purpose |
|---|---|---|---|
| `/api/auth/signup` | POST | `validate(signupSchema)` | Student registration, email duplicate check, bcrypt cost 12, server-enforced student role, sanitized profile + access token. |
| `/api/auth/login` | POST | `validate(loginSchema)` | Authenticates normalized email + password, generic error on invalid email/password, ban check, returns sanitized profile + access token. |
| `/api/auth/me` | GET | `auth` | Protected route: extracts Bearer token, verifies HS256 signature/claims, validates user existence/ban status in DB, returns current sanitized profile. |

### Security Measures Implemented

1. **Algorithm Restriction:** JWT signing and verification strictly locked to `HS256`. Malformed claims (`sub`, `role`, `iat`, `exp`) and unexpected payloads rejected with 401.
2. **Database Role Enforcement:** Protected requests query PostgreSQL to verify the user exists, is not banned, and attach the current live database role to `req.user.role` (never trusting client body/query params or stale JWT roles).
3. **Password Security:** Hashes passwords with `bcryptjs` cost factor 12. Generic error returned for both unknown email and incorrect password (prevents email enumeration).
4. **Role Tamper Protection:** `signup` strictly enforces server-assigned role `student`, ignoring any client-supplied role.
5. **Account Ban Enforcement:** Banned users (`isBanned: true`) are rejected on login (403) and blocked on protected routes (403).
6. **Strict Response Sanitization:** Password hashes and internal moderation fields (`isBanned`) are omitted from public user responses; outputs explicitly construct sanitized profiles (`id`, `name`, `email`, `role`, `college`, `createdAt`).
7. **Bcrypt UTF-8 Byte Limit Enforcement:** Passwords validated with `Buffer.byteLength(val, 'utf8') <= 72` before reaching bcrypt, mitigating silent multi-byte truncation.
8. **Constant-Time Login Flow:** Unconditionally executes `bcrypt.compare` against a verified pre-computed cost-12 dummy hash for non-existent users, neutralizing timing-attack email enumeration.
9. **Concurrent Unique Constraint Handling:** Handles Prisma `P2002` violations in `signup()` by mapping them safely to HTTP 409 Conflict without leaking HTTP 500 errors.
10. **JWT Role Enum Validation:** Strictly validates token `role` claim against `UserRole` enum values (`'student' | 'admin'`) with 401 on unrecognized claims, while maintaining live PostgreSQL user role lookup.

### Verification & Automated Test Results (22 / 22 Passed)

Executed against isolated test database `offercheck_test`:

| # | Test Case | Expected | Result |
|---|---|---|---|
| 1 | Signup succeeds & profile sanitized | HTTP 201, sanitized user (no `isBanned`), valid access token | ✅ PASS |
| 2 | Duplicate signup rejected | HTTP 409 Conflict | ✅ PASS |
| 3 | Password stored as bcrypt hash (cost 12) | Prefix `$2a$12$` / `$2b$12$`, length 60 | ✅ PASS |
| 4 | Signup cannot create admin account | Role strictly `student` in DB and response | ✅ PASS |
| 5 | Login succeeds with correct credentials | HTTP 200, sanitized user (no `isBanned`), valid access token | ✅ PASS |
| 6 | Incorrect password rejected | HTTP 401, generic invalid credentials message | ✅ PASS |
| 7 | Nonexistent email receives identical generic error | HTTP 401, identical error message | ✅ PASS |
| 8 | Student demo account login | HTTP 200 with `student123` credentials (`U001`) | ✅ PASS |
| 9 | Admin demo account login | HTTP 200 with `admin123` credentials (`U002`) | ✅ PASS |
| 10 | Valid access token accepted on `/api/auth/me` | HTTP 200, matching profile (no `isBanned`) | ✅ PASS |
| 11 | Invalid, malformed and expired tokens rejected | HTTP 401 across all malformed variants | ✅ PASS |
| 12 | Missing or non-Bearer authorization header rejected | HTTP 401 Unauthorized | ✅ PASS |
| 13 | Banned users rejected | HTTP 403 on login and on protected `/me` | ✅ PASS |
| 14 | `/api/auth/me` returns strictly sanitized profile | No `passwordHash`, `isBanned` or sensitive fields exposed | ✅ PASS |
| 15 | Existing admin guard (`requireAdmin`) works | Student blocked (403), Admin allowed (200) | ✅ PASS |
| 16 | ASCII password at 72-byte limit succeeds | HTTP 201, full 72 ASCII bytes accepted | ✅ PASS |
| 17 | Multi-byte password within 72 bytes succeeds | HTTP 201, accented characters ('é') accepted | ✅ PASS |
| 18 | Multi-byte password exceeding 72 bytes rejected | HTTP 400 Validation failed before bcrypt | ✅ PASS |
| 19 | Valid dummy bcrypt hash verified | Cost-12 dummy hash verified with `bcrypt.compare` | ✅ PASS |
| 20 | Login paths both execute bcrypt comparison | Both existing (~200ms) and nonexistent (~200ms) execute bcrypt | ✅ PASS |
| 21 | Concurrent duplicate signup returns HTTP 409 | HTTP 409 on race condition, zero HTTP 500 | ✅ PASS |
| 22 | Invalid JWT role claims rejected | HTTP 401 on non-enum role claims ('superadmin', 1, '') | ✅ PASS |

### Preservation Confirmations

- ✅ Production development database `offercheck_dev` untouched (all 15 table counts preserved)
- ✅ All frontend files untouched (`git diff HEAD -- src/` → empty)
- ✅ All original mock data files (`src/data/*.js`) untouched
- ✅ All 15 Prisma models and migrations remain unchanged
- ✅ No new npm packages installed
- ✅ Frontend production build (`npm run build`) succeeded (0 errors)
- ✅ Backend lint (`npm run lint`) succeeded (0 errors)

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

*Last updated: Phase 3 (Database Seeding) complete. Awaiting approval for Phase 4 (Authentication & Security).*

