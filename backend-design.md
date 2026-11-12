# OfferCheck — Backend Database Design

**Phase:** 1 — Architecture & Schema Design (v2 — post-review corrections applied)
**Stack:** Node.js · Express · PostgreSQL · Prisma ORM · JWT + bcrypt  
**Author:** Pre-backend design document  
**Status:** DESIGN ONLY — no code, no migrations, no live database  
**Last revised:** Corrections from `BACKEND_REVIEW.md` applied — 15 tables finalised

---

## Table of Contents

1. [Overview & Design Principles](#1-overview--design-principles)
2. [ER Diagram](#2-er-diagram)
3. [PostgreSQL Schema](#3-postgresql-schema)
4. [Normal Forms Explanation](#4-normal-forms-1nf-2nf-3nf)
5. [Prisma Schema](#5-prisma-schema)
6. [SQL Examples](#6-sql-examples)
7. [Transaction Example](#7-transaction-example--admin-moderation)
8. [Mock Data → Database Mapping](#8-mock-data--database-mapping)
9. [Security & Data Integrity Risks](#9-security--data-integrity-risks)
10. [Recommended Architecture](#10-recommended-architecture)

---

## 1. Overview & Design Principles

### What OfferCheck stores

| Domain | Real-world thing |
|---|---|
| Users | Students who submit reports; admins who moderate them |
| Refresh Tokens | Server-side session management for JWT rotation |
| Companies | The employer claimed in a fraud offer |
| Recruiters | The individual who sent the suspicious offer |
| Reports | The fraud incident itself — one candidate's experience |
| Identifiers | Reusable contact points: phone, email, UPI, domain, bank account |
| Risk Assessments | Versioned computed scores + per-factor breakdown for one report |
| Clusters | Groups of related reports sharing identifiers |
| Audit Logs | Immutable history of every admin action |
| Offer Checks | A lookup a user runs — stored with JSONB result snapshot |
| Saved Reports | A user's personal bookmarks of reports |

### Core design decisions

1. **Identifiers are shared entities, not report fields.** A phone number is stored once in `identifiers`; multiple reports link to it via a junction table. This is what enables the Trust Graph.
2. **Risk score lives in `risk_assessments`, not in `reports`.** A report's perceived risk can be recalculated as more data arrives; storing it separately avoids denormalisation. Assessments are versioned — only one row per report has `is_current = TRUE`.
3. **`report_identifiers` is the junction table** between `reports` and `identifiers`. Its `confidence`, `match_type` and `match_description` columns belong here — they describe the strength and plain-language reason for *this specific link*, not the identifier globally.
4. **Evidence metadata is part of `report_identifiers`, not a separate table.** A `(report_id, identifier_id)` pair already uniquely identifies the link; storing human-readable match metadata on the same row eliminates a redundant JOIN on every Trust Graph and report-detail query.
5. **`offer_checks` is separate from `reports`.** A user checking an offer does not automatically create a report. The `result` column stores a JSONB snapshot of the check at that moment — reconstructing it later would be inaccurate if new reports arrive.
6. **Normalised identifier values are stored separately from display values.** `+919876543210` (normalized) alongside `9876543210` (original). Matching is always done on the normalized column.
7. **Computed aggregate columns are not stored.** `report_count`, `avg_risk_score` on companies/recruiters and `risk_score` on clusters are always computed by SQL `COUNT`/`AVG` queries. Storing them would create update anomalies (3NF violation).
8. **`refresh_tokens` enables real session management.** Short-lived JWTs (15 min) paired with server-stored hashed refresh tokens allow logout, rotation and reuse detection without Redis.

---

## 2. ER Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                      ENTITY-RELATIONSHIP DIAGRAM (v2)                    │
│                                                                          │
│  users ──────────────────────────────────────────────────────────────┐  │
│    PK id                                                              │  │
│    name, email, password_hash, role, college, is_banned               │  │
│        │          │             │               │                     │  │
│        │ 1:N      │ 1:N         │ 1:N           │ M:N (saved_reports) │  │
│        ▼          ▼             ▼               ▼                     │  │
│  reports    offer_checks  refresh_tokens   saved_reports              │  │
│    PK id      PK id         PK id            FK user_id               │  │
│    FK submitted_by  FK user_id  FK user_id   FK report_id             │  │
│    FK reviewed_by   JSONB result  token_hash                          │  │
│    FK company_id              family, expires_at, revoked_at          │  │
│    FK recruiter_id                                                     │  │
│    status, offer_message  companies                                   │  │
│    payment_request          PK id                                     │  │
│          │               name, domain, industry, state                │  │
│          │               M:N via recruiter_companies ◄── recruiters   │  │
│          │ M:N (report_identifiers)         PK id                     │  │
│          │ confidence, match_type,          name, phone, email        │  │
│          │ match_description                                           │  │
│          ▼                                                             │  │
│  identifiers ◄─────────────────────────────────────────────────────  │  │
│    PK id                                                              │  │
│    type (phone/email/upi/domain/bank_account)                         │  │
│    value (original) + normalized_value                                │  │
│    risk_score, flagged, confidence                                    │  │
│                               clusters                                │  │
│                                 PK id                                 │  │
│                                 name, description                     │  │
│                                 confidence, status                    │  │
│                                   │ M:N (cluster_reports)             │  │
│                                   ▼                                   │  │
│                               cluster_reports                         │  │
│                                 FK cluster_id                         │  │
│  risk_assessments               FK report_id                          │  │
│    PK id                                                              │  │
│    FK report_id (1:N versioned)  risk_factors                         │  │
│    score, category, is_current   FK assessment_id                     │  │
│    version, summary              factor_key, weight                   │  │
│    assessed_at, assessed_by      explanation, confidence              │  │
│                                                                        │  │
│  audit_logs                                                            │  │
│    PK id                                                               │  │
│    FK actor_id (user)                                                  │  │
│    FK report_id (nullable)                                             │  │
│    FK identifier_id (nullable)                                         │  │
│    FK cluster_id (nullable)                                            │  │
│    FK target_user_id (nullable)                                        │  │
│    action, old_value, new_value, notes, created_at                    │  │
└──────────────────────────────────────────────────────────────────────┘
```

### Cardinality summary

| Relationship | Type | Via |
|---|---|---|
| User → Reports (submitted) | 1 : N | `reports.submitted_by` |
| User → Reports (reviewed) | 1 : N | `reports.reviewed_by` |
| User ↔ Reports (saved) | M : N | `saved_reports` junction |
| User → RefreshTokens | 1 : N | `refresh_tokens.user_id` |
| Company → Reports | 1 : N | `reports.company_id` |
| Recruiter → Reports | 1 : N | `reports.recruiter_id` |
| Company ↔ Recruiters | M : N | `recruiter_companies` junction |
| Report ↔ Identifiers | M : N | `report_identifiers` junction (+ match metadata) |
| Report → RiskAssessments | 1 : N (versioned) | `risk_assessments.report_id` + `is_current` |
| RiskAssessment → RiskFactors | 1 : N | `risk_factors.assessment_id` |
| Cluster ↔ Reports | M : N | `cluster_reports` junction |
| User → AuditLogs (actor) | 1 : N | `audit_logs.actor_id` |
| User → AuditLogs (target) | 1 : N | `audit_logs.target_user_id` |
| User → OfferChecks | 1 : N | `offer_checks.user_id` |

---

## 3. PostgreSQL Schema

### ENUMs

```sql
-- User role
CREATE TYPE user_role AS ENUM ('student', 'admin');

-- Report moderation status
CREATE TYPE report_status AS ENUM ('pending', 'verified', 'rejected', 'investigating');

-- Identifier contact type
CREATE TYPE identifier_type AS ENUM ('phone', 'email', 'upi', 'domain', 'bank_account');

-- Confidence level (used in identifiers, evidence, risk factors, clusters)
CREATE TYPE confidence_level AS ENUM ('low', 'medium', 'high');

-- Risk category (derived from score, but stored for fast filtering)
CREATE TYPE risk_category AS ENUM ('low', 'medium', 'high', 'critical');

-- Cluster status
CREATE TYPE cluster_status AS ENUM ('active', 'investigating', 'resolved', 'dismissed');

-- Audit action types
CREATE TYPE audit_action AS ENUM (
  'STATUS_CHANGED',
  'IDENTIFIER_FLAGGED',
  'CLUSTER_CREATED',
  'CLUSTER_UPDATED',
  'REPORT_FLAGGED',
  'REPORT_SUBMITTED',
  'REPORT_DELETED',
  'USER_BANNED'
);
```

---

### Table: `users`

Stores students and admins.

```sql
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(120)  NOT NULL,
  email           VARCHAR(254)  NOT NULL,
  password_hash   VARCHAR(72)   NOT NULL,          -- bcrypt output is always 60 chars; 72 is safe upper bound
  role            user_role     NOT NULL DEFAULT 'student',
  college         VARCHAR(200),                    -- NULL for admins
  is_banned       BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT users_email_unique UNIQUE (email),
  CONSTRAINT users_email_format CHECK (email ~* '^[^@]+@[^@]+\.[^@]+$')
);

-- Fast lookup on login (most frequent query)
CREATE UNIQUE INDEX idx_users_email ON users (LOWER(email));
```

**Design notes:**
- `email` is normalised to lowercase via the unique index (case-insensitive login).
- `password_hash` stores the full bcrypt output — never the raw password.
- `updated_at` is updated via a trigger (shown later) on every UPDATE.

---

### Table: `companies`

One row per claimed company name. Multiple recruiters may work for one company.

```sql
CREATE TABLE companies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                VARCHAR(200)  NOT NULL,
  domain              VARCHAR(253),                -- nullable: not all fraud offers include a domain
  industry            VARCHAR(100),
  registered_state    VARCHAR(80),
  flagged             BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT companies_domain_unique UNIQUE (domain)   -- one company per domain
);

-- Fuzzy name searches on the reports page
CREATE INDEX idx_companies_name ON companies USING gin (to_tsvector('english', name));
-- Domain lookups during identifier matching
CREATE INDEX idx_companies_domain ON companies (domain);
```

**What is NOT stored here:** `report_count` and `risk_score`. These are computed on demand:
```sql
SELECT c.id, COUNT(r.id) AS report_count, AVG(ra.score) AS avg_risk
FROM companies c
LEFT JOIN reports r ON r.company_id = c.id
LEFT JOIN risk_assessments ra ON ra.report_id = r.id
GROUP BY c.id;
```

---

### Table: `recruiters`

An individual recruiter may appear across multiple companies (the same person may fraudulently claim to represent different companies).

```sql
CREATE TABLE recruiters (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(120)  NOT NULL,
  phone         VARCHAR(20),
  email         VARCHAR(254),
  flagged       BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT recruiters_phone_or_email CHECK (phone IS NOT NULL OR email IS NOT NULL)
);

CREATE INDEX idx_recruiters_phone ON recruiters (phone);
CREATE INDEX idx_recruiters_email ON recruiters (LOWER(email));
```

---

### Junction: `recruiter_companies`

A recruiter can claim to work for multiple companies; a company can have multiple recruiters.

```sql
CREATE TABLE recruiter_companies (
  recruiter_id  UUID  NOT NULL REFERENCES recruiters(id) ON DELETE CASCADE,
  company_id    UUID  NOT NULL REFERENCES companies(id)  ON DELETE CASCADE,
  PRIMARY KEY (recruiter_id, company_id)
);
```

---

### Table: `reports`

The core entity — one row per fraud incident reported by a user.

```sql
CREATE TABLE reports (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Authorship
  submitted_by          UUID          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_by           UUID          REFERENCES users(id) ON DELETE SET NULL,

  -- Company / recruiter links (nullable — fraud may not be linked to known entity)
  company_id            UUID          REFERENCES companies(id) ON DELETE SET NULL,
  recruiter_id          UUID          REFERENCES recruiters(id) ON DELETE SET NULL,

  -- Raw submitted values (kept for record — normalized copies live in identifiers table)
  company_name_raw      VARCHAR(200)  NOT NULL,
  recruiter_name_raw    VARCHAR(120),
  domain_raw            VARCHAR(253),
  phone_raw             VARCHAR(20),
  email_raw             VARCHAR(254),
  upi_raw               VARCHAR(80),

  -- Offer content
  offer_message         TEXT          NOT NULL,
  payment_request       VARCHAR(300),
  additional_notes      TEXT,

  -- Moderation
  status                report_status NOT NULL DEFAULT 'pending',
  submitted_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  reviewed_at           TIMESTAMPTZ,

  -- Information quality flags (what we know vs. what was just reported)
  is_verified           BOOLEAN       NOT NULL DEFAULT FALSE,
  is_inferred           BOOLEAN       NOT NULL DEFAULT FALSE,

  CONSTRAINT reports_reviewed_requires_reviewer
    CHECK (reviewed_at IS NULL OR reviewed_by IS NOT NULL),

  CONSTRAINT reports_offer_message_min_length
    CHECK (LENGTH(TRIM(offer_message)) >= 20)
);

-- Most common filters: status, company, risk (via JOIN to risk_assessments)
CREATE INDEX idx_reports_status       ON reports (status);
CREATE INDEX idx_reports_company_id   ON reports (company_id);
CREATE INDEX idx_reports_recruiter_id ON reports (recruiter_id);
CREATE INDEX idx_reports_submitted_by ON reports (submitted_by);
CREATE INDEX idx_reports_submitted_at ON reports (submitted_at DESC);

-- Full-text search on offer content
CREATE INDEX idx_reports_offer_fts ON reports USING gin (
  to_tsvector('english', company_name_raw || ' ' || COALESCE(offer_message, ''))
);
```

**Why keep `*_raw` fields?** The raw values submitted by the user are preserved for audit and display. The normalized, deduped versions live in `identifiers` and are linked via `report_identifiers`. The raw fields are for reference — matching happens on `identifiers`.

---

### Table: `identifiers`

The central deduplication table. Every contact point (phone, email, UPI, domain, bank account) that has ever appeared in any report is stored once here.

```sql
CREATE TABLE identifiers (
  id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  type              identifier_type NOT NULL,
  value             VARCHAR(300)    NOT NULL,       -- original as submitted (display)
  normalized_value  VARCHAR(300)    NOT NULL,       -- lowercased, stripped, E.164 for phones
  risk_score        SMALLINT        NOT NULL DEFAULT 0
                    CHECK (risk_score BETWEEN 0 AND 100),
  flagged           BOOLEAN         NOT NULL DEFAULT FALSE,
  confidence        confidence_level NOT NULL DEFAULT 'low',
  notes             TEXT,
  first_seen        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  last_seen         TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  -- Each (type, normalized_value) pair is unique — deduplication key
  CONSTRAINT identifiers_type_normalized_unique UNIQUE (type, normalized_value)
);

-- Exact match on normalized value — used in every offer check
CREATE UNIQUE INDEX idx_identifiers_normalized ON identifiers (type, normalized_value);

-- Partial index: flagged identifiers are queried most often in admin
CREATE INDEX idx_identifiers_flagged ON identifiers (flagged) WHERE flagged = TRUE;

-- Range queries on risk score for dashboard/admin filtering
CREATE INDEX idx_identifiers_risk_score ON identifiers (risk_score DESC);
```

**Normalization rules (applied before INSERT/lookup):**
- `phone` → strip all non-digits, prepend `+91` for 10-digit Indian numbers → `+919876543210`
- `email` → `LOWER(TRIM(value))`
- `upi` → `LOWER(TRIM(value))`
- `domain` → strip `http://`, `https://`, trailing `/`, then `LOWER()`
- `bank_account` → `LOWER(TRIM(value))`

---

### Junction: `report_identifiers`

Links reports to identifiers. The `confidence` column describes how confident we are that *this specific identifier is genuinely linked to this specific report* (not the identifier's global risk). The `match_type` and `match_description` columns carry the plain-language explanation that was previously in a separate `evidence` table — merging them here eliminates one JOIN on every Trust Graph and report-detail query.

```sql
CREATE TABLE report_identifiers (
  report_id         UUID             NOT NULL REFERENCES reports(id)     ON DELETE CASCADE,
  identifier_id     UUID             NOT NULL REFERENCES identifiers(id) ON DELETE RESTRICT,
  confidence        confidence_level NOT NULL DEFAULT 'medium',
  match_type        VARCHAR(50),     -- e.g. 'upi_match', 'phone_match', 'domain_match'
  match_description TEXT,            -- plain-language explanation shown in Trust Graph UI
  added_by          UUID             REFERENCES users(id) ON DELETE SET NULL,
  added_at          TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

  PRIMARY KEY (report_id, identifier_id)
);

-- Lookup "all reports that share this identifier" — the core Trust Graph query
CREATE INDEX idx_ri_identifier_id ON report_identifiers (identifier_id);
CREATE INDEX idx_ri_report_id     ON report_identifiers (report_id);
```

> **Note:** `match_type` and `match_description` are nullable — they are populated automatically by the identifier-resolution service when a new report reuses a known identifier. For the first report ever submitted with a given identifier, there is no previous report to compare against, so these fields remain NULL until a second report links the same identifier.

---

### ~~Table: `evidence`~~ — Merged into `report_identifiers`

The `evidence` table from the original design stored `(report_id, identifier_id, type, description, confidence)`. These fields are now `match_type`, `match_description`, and `confidence` on `report_identifiers`. Removing the separate table eliminates:
- One `UNIQUE(report_id, identifier_id)` constraint duplicated across two tables
- One JOIN on every report-detail and Trust Graph query
- Two indexes (`idx_evidence_report_id`, `idx_evidence_identifier_id`) now covered by `idx_ri_report_id` and `idx_ri_identifier_id`

No functionality is lost. The `report_identifiers` row already uniquely identifies the link; match metadata belongs on that same row.

---

### Table: `risk_assessments`

One active assessment per report, but old assessments are retained for history. Separated from `reports` to allow recalculation as new evidence arrives — `is_current = TRUE` marks the active version. Only one row per report may have `is_current = TRUE`; this is enforced by a **partial unique index** (not a column-level UNIQUE constraint, because Prisma cannot express partial indexes — the index must be created with a custom SQL migration).

```sql
CREATE TABLE risk_assessments (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     UUID          NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  score         SMALLINT      NOT NULL CHECK (score BETWEEN 0 AND 100),
  category      risk_category NOT NULL,
  summary       TEXT,         -- plain-language summary for the UI
  disclaimer    TEXT,         -- legal/evidentiary disclaimer
  assessed_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  assessed_by   VARCHAR(50)   NOT NULL DEFAULT 'system',  -- 'system' or admin user id
  is_current    BOOLEAN       NOT NULL DEFAULT TRUE,       -- TRUE = active assessment
  version       SMALLINT      NOT NULL DEFAULT 1           -- increments on each recalculation
);

-- ⚠️ PARTIAL UNIQUE INDEX — Prisma cannot express this. Must be in a custom SQL migration.
-- Guarantees: AT MOST ONE is_current = TRUE row per report_id (prevents duplicates).
-- The transaction below guarantees EXACTLY ONE after every successful insert or update.
CREATE UNIQUE INDEX idx_risk_assessments_current
  ON risk_assessments (report_id)
  WHERE is_current = TRUE;

-- Fast join from reports to current risk score
CREATE INDEX idx_risk_assessments_report_id ON risk_assessments (report_id);
CREATE INDEX idx_risk_assessments_score     ON risk_assessments (score DESC) WHERE is_current = TRUE;
CREATE INDEX idx_risk_assessments_category  ON risk_assessments (category)   WHERE is_current = TRUE;
```

**Safe concurrent update pattern** — the transaction guarantees *exactly one* `is_current = TRUE` row per report after every successful run. The partial unique index independently prevents duplicates if a concurrent transaction bypasses this pattern:

```sql
BEGIN;
  -- Step 1: Archive the old current assessment (sets is_current = FALSE)
  UPDATE risk_assessments
    SET is_current = FALSE
  WHERE report_id = $1 AND is_current = TRUE;

  -- Step 2: Insert the new current assessment.
  --   If Step 1 found no existing row (first assessment for this report),
  --   this insert still succeeds and produces exactly one is_current=TRUE row.
  INSERT INTO risk_assessments (report_id, score, category, summary, assessed_by, is_current, version)
  SELECT $1, $2, $3, $4, $5, TRUE,
         COALESCE((SELECT MAX(version) FROM risk_assessments WHERE report_id = $1), 0) + 1;
COMMIT;
-- If the INSERT violates the partial unique index (concurrent race), the transaction rolls back.
-- The calling code must retry on serialization failure.
```

This pattern is used in `prisma.$transaction` during `POST /api/reports` and `PATCH /api/admin/reports/:id`.

---

### Table: `risk_factors`

Individual contributing factors to a risk score. Stored as a separate table (not JSONB) so they can be queried, aggregated, and updated independently.

```sql
CREATE TABLE risk_factors (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id   UUID          NOT NULL REFERENCES risk_assessments(id) ON DELETE CASCADE,
  factor_key      VARCHAR(80)   NOT NULL,   -- e.g. 'shared_upi_critical', 'payment_requested'
  description     VARCHAR(300)  NOT NULL,
  weight          SMALLINT      NOT NULL CHECK (weight BETWEEN 0 AND 100),
  evidence_text   TEXT,
  confidence      confidence_level NOT NULL DEFAULT 'medium',
  explanation     TEXT          NOT NULL   -- plain-language reason shown to user
);

CREATE INDEX idx_risk_factors_assessment_id ON risk_factors (assessment_id);
CREATE INDEX idx_risk_factors_factor_key    ON risk_factors (factor_key);
```

**Why not JSONB?** Separate rows allow:
- `GROUP BY factor_key` to find which signals are most common across all reports
- Updating a single factor without rewriting the whole document
- Prisma relations (no raw SQL needed to fetch factors)

---

### Table: `clusters`

Groups of reports that share identifiers and likely originate from the same fraud actor. The cluster's risk score is **not stored** — it is computed on demand from the risk assessments of its member reports, for the same reason `report_count` is not stored on `companies` (3NF — it would create a transitive dependency and an update anomaly).

```sql
CREATE TABLE clusters (
  id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(200)    NOT NULL,
  description       TEXT,
  confidence        confidence_level NOT NULL DEFAULT 'medium',
  status            cluster_status  NOT NULL DEFAULT 'active',
  connection_basis  TEXT,           -- plain-language reason reports are grouped
  discovered_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clusters_status ON clusters (status);
```

**Computing cluster risk score on demand:**
```sql
SELECT
  cl.id,
  cl.name,
  cl.status,
  COUNT(DISTINCT cr.report_id)              AS total_reports,
  COALESCE(AVG(ra.score), 0)::INT           AS avg_risk_score,
  MAX(ra.score)                             AS max_risk_score
FROM clusters cl
JOIN cluster_reports cr     ON cr.cluster_id = cl.id
JOIN risk_assessments ra    ON ra.report_id  = cr.report_id AND ra.is_current = TRUE
GROUP BY cl.id, cl.name, cl.status;
```

---

### Junction: `cluster_reports`

```sql
CREATE TABLE cluster_reports (
  cluster_id  UUID  NOT NULL REFERENCES clusters(id)  ON DELETE CASCADE,
  report_id   UUID  NOT NULL REFERENCES reports(id)   ON DELETE CASCADE,
  PRIMARY KEY (cluster_id, report_id)
);

CREATE INDEX idx_cr_report_id ON cluster_reports (report_id);
```

---

### ~~Junction: `cluster_identifiers`~~ — Dropped for v1

**Rationale:** `cluster_identifiers` stored which identifiers define a cluster. This information is fully derivable from existing tables — the defining identifiers are those that appear in `report_identifiers` for two or more reports in `cluster_reports`:

```sql
-- Derive a cluster's defining identifiers without cluster_identifiers:
SELECT
  i.id,
  i.type,
  i.normalized_value,
  i.flagged,
  COUNT(DISTINCT ri.report_id)  AS shared_report_count
FROM clusters cl
JOIN cluster_reports cr  ON cr.cluster_id  = cl.id
JOIN report_identifiers ri ON ri.report_id = cr.report_id
JOIN identifiers i         ON i.id         = ri.identifier_id
WHERE cl.id = $1
GROUP BY i.id, i.type, i.normalized_value, i.flagged
HAVING COUNT(DISTINCT ri.report_id) >= 2   -- shared by at least 2 cluster members
ORDER BY shared_report_count DESC;
```

If a future version requires admins to manually curate which identifiers define a cluster (overriding the computed result), `cluster_identifiers` can be re-added as a junction with an `is_manual BOOLEAN` column.

---

### Table: `saved_reports`

A user's personal bookmark list.

```sql
CREATE TABLE saved_reports (
  user_id    UUID  NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  report_id  UUID  NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  saved_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, report_id)
);

CREATE INDEX idx_saved_reports_user_id ON saved_reports (user_id);
```

---

### Table: `offer_checks`

Records every lookup a user performs (whether or not they submit a report). `result` stores a **JSONB snapshot** of the check outcome at the moment it ran — this is correct because the risk engine result depends on what was in the database at that instant; re-running it later would return a different answer if new reports arrived.

`ip_hash` stores an **HMAC-SHA256** of the client IP, keyed with a server-side secret (`IP_HASH_SECRET` environment variable). Plain SHA-256 is reversible by dictionary attack on the small IPv4 space (~4 billion addresses). HMAC-SHA256 makes the hash non-reversible without the secret. The secret must be rotated if compromised; rotating it invalidates all existing ip_hash values, resetting rate-limit windows (acceptable). This enables `COUNT(*) WHERE ip_hash = $1 AND checked_at > NOW() - INTERVAL '1 hour'` without storing identifiable data.

```sql
CREATE TABLE offer_checks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        REFERENCES users(id) ON DELETE SET NULL,  -- null = anonymous
  company_name    VARCHAR(200),
  phone_query     VARCHAR(20),
  email_query     VARCHAR(254),
  upi_query       VARCHAR(80),
  domain_query    VARCHAR(253),
  risk_score      SMALLINT    CHECK (risk_score BETWEEN 0 AND 100),
  risk_category   risk_category,
  result          JSONB,              -- result snapshot at check time; nullified after 90 days by scheduled job
  ip_hash         CHAR(64),             -- HMAC-SHA256(client_ip, IP_HASH_SECRET) — non-reversible without secret
  checked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_offer_checks_user_id    ON offer_checks (user_id);
CREATE INDEX idx_offer_checks_checked_at ON offer_checks (checked_at DESC);
-- Rate-limit anonymous checks by hashed IP
CREATE INDEX idx_offer_checks_ip_hash    ON offer_checks (ip_hash, checked_at DESC)
  WHERE ip_hash IS NOT NULL;
```

**Rate-limiting query (no Redis required):**
```sql
-- $1 = HMAC-SHA256(client_ip, IP_HASH_SECRET) computed in Express middleware
SELECT COUNT(*)
FROM offer_checks
WHERE ip_hash = $1 AND checked_at > NOW() - INTERVAL '1 hour';
-- If count >= 20: return HTTP 429 Too Many Requests
```

> **Secret handling:** `IP_HASH_SECRET` must be a random 32-byte hex string stored in the `.env` file, never committed to git. Rotate by updating the env var and running a one-off `UPDATE offer_checks SET ip_hash = NULL` to clear stale hashes (rate-limit windows reset; no data loss).

---

### Table: `audit_logs`

Immutable log of every admin action. Never updated or deleted. `actor_id` is `ON DELETE RESTRICT` — an admin user cannot be deleted while audit history exists (preserves accountability). `target_user_id` covers user-targeted actions such as `USER_BANNED` where no report, identifier or cluster is the subject.

```sql
CREATE TABLE audit_logs (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id         UUID          NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action           audit_action  NOT NULL,
  report_id        UUID          REFERENCES reports(id)     ON DELETE SET NULL,
  identifier_id    UUID          REFERENCES identifiers(id) ON DELETE SET NULL,
  cluster_id       UUID          REFERENCES clusters(id)    ON DELETE SET NULL,
  target_user_id   UUID          REFERENCES users(id)       ON DELETE SET NULL,  -- for USER_BANNED etc.
  old_value        VARCHAR(100),   -- previous status/value
  new_value        VARCHAR(100),   -- new status/value
  notes            TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- At least one target must be specified (report, identifier, cluster OR a target user)
  CONSTRAINT audit_logs_has_target
    CHECK (
      report_id      IS NOT NULL OR
      identifier_id  IS NOT NULL OR
      cluster_id     IS NOT NULL OR
      target_user_id IS NOT NULL
    )
);

CREATE INDEX idx_audit_logs_actor_id      ON audit_logs (actor_id);
CREATE INDEX idx_audit_logs_target_user   ON audit_logs (target_user_id) WHERE target_user_id IS NOT NULL;
CREATE INDEX idx_audit_logs_report_id     ON audit_logs (report_id);
CREATE INDEX idx_audit_logs_created_at   ON audit_logs (created_at DESC);
```

**FK deletion behaviour:**
- `actor_id ON DELETE RESTRICT` — admin history is preserved; the admin account cannot be deleted while log entries exist
- `report_id ON DELETE SET NULL` — if a report is deleted, the log entry survives with `report_id = NULL` (audit trail is not destroyed by report deletion)
- `target_user_id ON DELETE SET NULL` — same reasoning: banning record survives even if the user account is later removed

---

### Table: `refresh_tokens`

Enables real session management. Short-lived JWTs (15 min access tokens) are paired with long-lived refresh tokens stored here as SHA-256 hashes. The `family` UUID groups all tokens issued in a rotation chain — if an already-rotated (and thus deleted/invalidated) token from the same family is presented, the entire family is revoked, detecting token theft.

```sql
CREATE TABLE refresh_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  CHAR(64)    NOT NULL,   -- SHA-256(raw_token) — 64 hex chars; fast lookup, not bcrypt
  family      UUID        NOT NULL DEFAULT gen_random_uuid(),  -- rotation chain id
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,            -- set on logout or on reuse detection
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT refresh_tokens_hash_unique UNIQUE (token_hash)
);

CREATE INDEX idx_refresh_tokens_user_id  ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_family   ON refresh_tokens (family);
-- Partial index for active (non-revoked) tokens only
CREATE INDEX idx_refresh_tokens_active   ON refresh_tokens (token_hash)
  WHERE revoked_at IS NULL;
```

**Why SHA-256, not bcrypt?** Refresh token lookup is a hot path — it happens on every API call that uses a refresh token. bcrypt verification takes ~100 ms by design; SHA-256 is constant-time and microseconds. The token value itself is a 256-bit cryptographically random string (not a password), so SHA-256 is a sufficient and correct choice.

**Token rotation protocol:**
```
1. Client presents refresh_token RT_old
2. Server: SELECT * FROM refresh_tokens WHERE token_hash = SHA256(RT_old) AND revoked_at IS NULL
3. If not found → token stolen or already used → revoke entire family:
     UPDATE refresh_tokens SET revoked_at = NOW() WHERE family = $family_id
     Return 401 Unauthorized
4. If found and not expired:
     DELETE old row (or SET revoked_at = NOW())
     INSERT new row with same family, new token_hash, new expires_at
     Return new access_token + RT_new to client
5. If found but expired → return 401, prompt re-login
```

**`ON DELETE CASCADE`:** If a user is deleted or banned, all their refresh tokens are automatically deleted — no orphaned sessions.

---
```

---

### Trigger: `updated_at` auto-update

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to every table that has updated_at
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_clusters_updated_at
  BEFORE UPDATE ON clusters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## 4. Normal Forms (1NF, 2NF, 3NF)

### Using our actual tables

---

#### 1NF — First Normal Form

**Rule:** Every column holds a single atomic value. No repeating groups or arrays inside a column.

**Problem in mock data (before design):**

```js
// reports.js — VIOLATES 1NF
{
  id: 'R001',
  identifierIds: ['ID001', 'ID013', 'ID051'],   // array inside a single field
  clusterIds: ['CL001'],                         // another array
  riskFactors: [ { factor: '...', weight: 35 }, ... ]  // nested objects
}
```

**How we fixed it:**

| Violation | Solution |
|---|---|
| `identifierIds: ['ID001', 'ID013']` | Replaced by `report_identifiers` junction table — one row per link |
| `clusterIds: ['CL001']` | Replaced by `cluster_reports` junction table |
| `riskFactors: [...]` | Replaced by `risk_factors` table — one row per factor |

**After fix — 1NF satisfied:** Every column in every row holds exactly one value.

---

#### 2NF — Second Normal Form

**Rule:** Must be in 1NF, AND every non-key column must depend on the **entire** primary key (not just part of it). This only applies to composite primary keys.

**Example — `report_identifiers` junction table:**

```
report_identifiers (report_id, identifier_id, confidence, added_by, added_at)
                    ───────────────────────────────────────────────────────
                    PRIMARY KEY = (report_id, identifier_id)
```

- `confidence` → depends on BOTH keys ✅ (how confident this link is for *this* report-identifier pair)
- `added_by` → depends on BOTH keys ✅ (who added this specific link)
- `added_at` → depends on BOTH keys ✅

**What would violate 2NF:**

```
-- BAD: identifier_type and identifier_value depend only on identifier_id,
--      not on the full (report_id, identifier_id) key
report_identifiers (report_id, identifier_id, identifier_type, identifier_value, confidence)
                                              ───────────────  ────────────────  ← partial dependency!
```

This is exactly why `type` and `value` live in the `identifiers` table, not repeated in the junction.

---

#### 3NF — Third Normal Form

**Rule:** Must be in 2NF, AND no non-key column should depend on another non-key column (no transitive dependencies).

**Example — Companies:**

If we had stored `risk_score` and `report_count` in `companies`:

```
companies (id, name, domain, report_count, avg_risk_score)
                              ────────────  ───────────────
                              these depend on the reports table, not on company.id!
```

`avg_risk_score` transitively depends on `reports.company_id → risk_assessments.score`, not directly on `company.id`. Storing it in `companies` creates a transitive dependency and an update anomaly (every new report would need to also update the company row).

**How we fixed it:** `report_count` and `avg_risk_score` are computed by SQL `COUNT`/`AVG` queries using JOINs. They are not columns in `companies`.

**Another 3NF example — `reports`:**

If we stored `company_domain` directly in `reports`:

```
reports (id, company_id, company_domain, ...)
                         ──────────────
                         depends on company_id, not on report.id!
```

`company_domain` transitively depends on `company_id → companies.domain`. We removed it — `domain` lives in `companies`, accessed via JOIN.

---

## 5. Prisma Schema

> **⚠️ Requires custom SQL migration blocks for:**
> 1. Partial unique index on `risk_assessments (report_id) WHERE is_current = TRUE`
> 2. Partial index on `refresh_tokens (token_hash) WHERE revoked_at IS NULL`
> 3. `CHECK` constraints on `audit_logs` and `reports` — Prisma ignores these; add via raw SQL in the migration file
> 4. `ON DELETE RESTRICT` on `reports.submitted_by` and `audit_logs.actor_id` — supported via `onDelete: Restrict` in Prisma 4.x+

```prisma
// prisma/schema.prisma
// v2 — post-review corrections applied

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── ENUMS ───────────────────────────────────────────────────────────────────

enum UserRole {
  student
  admin
}

enum ReportStatus {
  pending
  verified
  rejected
  investigating
}

enum IdentifierType {
  phone
  email
  upi
  domain
  bank_account
}

enum ConfidenceLevel {
  low
  medium
  high
}

enum RiskCategory {
  low
  medium
  high
  critical
}

enum ClusterStatus {
  active
  investigating
  resolved
  dismissed
}

enum AuditAction {
  STATUS_CHANGED
  IDENTIFIER_FLAGGED
  IDENTIFIER_REVEALED
  CLUSTER_CREATED
  CLUSTER_UPDATED
  REPORT_FLAGGED
  REPORT_SUBMITTED
  REPORT_DELETED
  USER_BANNED
}

// ─── MODELS ──────────────────────────────────────────────────────────────────

model User {
  id            String   @id @default(uuid())
  name          String   @db.VarChar(120)
  email         String   @unique @db.VarChar(254)
  passwordHash  String   @map("password_hash") @db.VarChar(72)
  role          UserRole @default(student)
  college       String?  @db.VarChar(200)
  isBanned      Boolean  @default(false) @map("is_banned")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  submittedReports   Report[]          @relation("SubmittedBy")
  reviewedReports    Report[]          @relation("ReviewedBy")
  savedReports       SavedReport[]
  offerChecks        OfferCheck[]
  auditLogsAsActor   AuditLog[]        @relation("ActorLogs")
  auditLogsAsTarget  AuditLog[]        @relation("TargetUserLogs")
  reportIdentifiers  ReportIdentifier[]
  refreshTokens      RefreshToken[]

  @@map("users")
}

model RefreshToken {
  id         String    @id @default(uuid())
  userId     String    @map("user_id")
  tokenHash  String    @unique @map("token_hash") @db.Char(64)
  family     String    @map("family") @db.Uuid
  expiresAt  DateTime  @map("expires_at")
  revokedAt  DateTime? @map("revoked_at")
  createdAt  DateTime  @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("refresh_tokens")
}

model Company {
  id               String    @id @default(uuid())
  name             String    @db.VarChar(200)
  domain           String?   @unique @db.VarChar(253)
  industry         String?   @db.VarChar(100)
  registeredState  String?   @map("registered_state") @db.VarChar(80)
  flagged          Boolean   @default(false)
  createdAt        DateTime  @default(now()) @map("created_at")

  reports    Report[]
  recruiters RecruiterCompany[]

  @@map("companies")
}

model Recruiter {
  id        String   @id @default(uuid())
  name      String   @db.VarChar(120)
  phone     String?  @db.VarChar(20)
  email     String?  @db.VarChar(254)
  flagged   Boolean  @default(false)
  createdAt DateTime @default(now()) @map("created_at")

  reports   Report[]
  companies RecruiterCompany[]

  @@map("recruiters")
}

model RecruiterCompany {
  recruiterId String    @map("recruiter_id")
  companyId   String    @map("company_id")

  recruiter Recruiter @relation(fields: [recruiterId], references: [id], onDelete: Cascade)
  company   Company   @relation(fields: [companyId],   references: [id], onDelete: Cascade)

  @@id([recruiterId, companyId])
  @@map("recruiter_companies")
}

model Report {
  id               String       @id @default(uuid())
  submittedBy      String       @map("submitted_by")
  reviewedBy       String?      @map("reviewed_by")
  companyId        String?      @map("company_id")
  recruiterId      String?      @map("recruiter_id")
  companyNameRaw   String       @map("company_name_raw")   @db.VarChar(200)
  recruiterNameRaw String?      @map("recruiter_name_raw") @db.VarChar(120)
  domainRaw        String?      @map("domain_raw")  @db.VarChar(253)
  phoneRaw         String?      @map("phone_raw")   @db.VarChar(20)
  emailRaw         String?      @map("email_raw")   @db.VarChar(254)
  upiRaw           String?      @map("upi_raw")     @db.VarChar(80)
  offerMessage     String       @map("offer_message")
  paymentRequest   String?      @map("payment_request") @db.VarChar(300)
  additionalNotes  String?      @map("additional_notes")
  status           ReportStatus @default(pending)
  submittedAt      DateTime     @default(now()) @map("submitted_at")
  reviewedAt       DateTime?    @map("reviewed_at")
  isVerified       Boolean      @default(false) @map("is_verified")
  isInferred       Boolean      @default(false) @map("is_inferred")

  submitter       User               @relation("SubmittedBy", fields: [submittedBy], references: [id])
  reviewer        User?              @relation("ReviewedBy",  fields: [reviewedBy],  references: [id])
  company         Company?           @relation(fields: [companyId],   references: [id])
  recruiter       Recruiter?         @relation(fields: [recruiterId], references: [id])
  identifiers     ReportIdentifier[]
  riskAssessments RiskAssessment[]   // 1:N versioned; query WHERE isCurrent = true for active
  clusters        ClusterReport[]
  savedBy         SavedReport[]
  auditLogs       AuditLog[]

  @@map("reports")
}

model Identifier {
  id              String          @id @default(uuid())
  type            IdentifierType
  value           String          @db.VarChar(300)
  normalizedValue String          @map("normalized_value") @db.VarChar(300)
  riskScore       Int             @default(0) @map("risk_score") @db.SmallInt
  flagged         Boolean         @default(false)
  confidence      ConfidenceLevel @default(low)
  notes           String?
  firstSeen       DateTime        @default(now()) @map("first_seen")
  lastSeen        DateTime        @default(now()) @map("last_seen")

  reports   ReportIdentifier[]
  auditLogs AuditLog[]

  @@unique([type, normalizedValue])
  @@map("identifiers")
}

model ReportIdentifier {
  reportId         String          @map("report_id")
  identifierId     String          @map("identifier_id")
  confidence       ConfidenceLevel @default(medium)
  matchType        String?         @map("match_type") @db.VarChar(50)
  matchDescription String?         @map("match_description")
  addedBy          String?         @map("added_by")
  addedAt          DateTime        @default(now()) @map("added_at")

  report      Report     @relation(fields: [reportId],     references: [id], onDelete: Cascade)
  identifier  Identifier @relation(fields: [identifierId], references: [id])
  addedByUser User?      @relation(fields: [addedBy],      references: [id])

  @@id([reportId, identifierId])
  @@map("report_identifiers")
}

// evidence model removed — match metadata merged into ReportIdentifier (matchType, matchDescription)

model RiskAssessment {
  id          String       @id @default(uuid())
  reportId    String       @map("report_id")   // No @unique — multiple versions allowed
  score       Int          @db.SmallInt
  category    RiskCategory
  summary     String?
  disclaimer  String?
  assessedAt  DateTime     @default(now()) @map("assessed_at")
  assessedBy  String       @default("system") @map("assessed_by")
  isCurrent   Boolean      @default(true)  @map("is_current")
  version     Int          @default(1) @db.SmallInt

  // ⚠️ Uniqueness of is_current=TRUE per report_id is enforced by partial unique index
  //    in a custom SQL migration (Prisma does not support partial indexes in schema.prisma):
  //    CREATE UNIQUE INDEX idx_risk_assessments_current
  //      ON risk_assessments (report_id) WHERE is_current = TRUE;

  report  Report       @relation(fields: [reportId], references: [id], onDelete: Cascade)
  factors RiskFactor[]

  @@map("risk_assessments")
}

model RiskFactor {
  id            String          @id @default(uuid())
  assessmentId  String          @map("assessment_id")
  factorKey     String          @map("factor_key") @db.VarChar(80)
  description   String          @db.VarChar(300)
  weight        Int             @db.SmallInt
  evidenceText  String?         @map("evidence_text")
  confidence    ConfidenceLevel @default(medium)
  explanation   String

  assessment RiskAssessment @relation(fields: [assessmentId], references: [id], onDelete: Cascade)

  @@map("risk_factors")
}

model Cluster {
  id              String          @id @default(uuid())
  name            String          @db.VarChar(200)
  description     String?
  // riskScore removed — computed on demand via JOIN to cluster_reports → risk_assessments
  confidence      ConfidenceLevel @default(medium)
  status          ClusterStatus   @default(active)
  connectionBasis String?         @map("connection_basis")
  discoveredAt    DateTime        @default(now()) @map("discovered_at")
  updatedAt       DateTime        @updatedAt @map("updated_at")

  reports   ClusterReport[]
  auditLogs AuditLog[]

  @@map("clusters")
}

model ClusterReport {
  clusterId String @map("cluster_id")
  reportId  String @map("report_id")

  cluster Cluster @relation(fields: [clusterId], references: [id], onDelete: Cascade)
  report  Report  @relation(fields: [reportId],  references: [id], onDelete: Cascade)

  @@id([clusterId, reportId])
  @@map("cluster_reports")
}

// ClusterIdentifier model removed for v1 — cluster identifiers are derived via SQL JOIN
// See §3 "~~Junction: cluster_identifiers~~" for the derivation query.

model SavedReport {
  userId   String   @map("user_id")
  reportId String   @map("report_id")
  savedAt  DateTime @default(now()) @map("saved_at")

  user   User   @relation(fields: [userId],   references: [id], onDelete: Cascade)
  report Report @relation(fields: [reportId], references: [id], onDelete: Cascade)

  @@id([userId, reportId])
  @@map("saved_reports")
}

model OfferCheck {
  id           String        @id @default(uuid())
  userId       String?       @map("user_id")
  companyName  String?       @map("company_name")  @db.VarChar(200)
  phoneQuery   String?       @map("phone_query")   @db.VarChar(20)
  emailQuery   String?       @map("email_query")   @db.VarChar(254)
  upiQuery     String?       @map("upi_query")     @db.VarChar(80)
  domainQuery  String?       @map("domain_query")  @db.VarChar(253)
  riskScore    Int?          @map("risk_score") @db.SmallInt
  riskCategory RiskCategory? @map("risk_category")
  result       Json?         // nullable — always populated on insert; nullified after 90 days by scheduled job
  ipHash       String?       @map("ip_hash") @db.Char(64)  // HMAC-SHA256(client_ip, IP_HASH_SECRET) for rate limiting
  checkedAt    DateTime      @default(now()) @map("checked_at")

  user User? @relation(fields: [userId], references: [id])

  @@map("offer_checks")
}

model AuditLog {
  id             String      @id @default(uuid())
  actorId        String      @map("actor_id")
  action         AuditAction
  reportId       String?     @map("report_id")
  identifierId   String?     @map("identifier_id")
  clusterId      String?     @map("cluster_id")
  targetUserId   String?     @map("target_user_id")  // for USER_BANNED, IDENTIFIER_REVEALED
  oldValue       String?     @map("old_value") @db.VarChar(100)
  newValue       String?     @map("new_value") @db.VarChar(100)
  notes          String?
  createdAt      DateTime    @default(now()) @map("created_at")

  // ⚠️ CHECK constraint (at least one target non-null) must be in custom SQL migration

  actor      User        @relation("ActorLogs",      fields: [actorId],      references: [id])
  targetUser User?       @relation("TargetUserLogs", fields: [targetUserId], references: [id])
  report     Report?     @relation(fields: [reportId],     references: [id])
  identifier Identifier? @relation(fields: [identifierId], references: [id])
  cluster    Cluster?    @relation(fields: [clusterId],    references: [id])

  @@map("audit_logs")
}
```

---

## 6. SQL Examples

### 6.1 INNER JOIN — Get all reports with their risk scores and company names

**Use case:** Populating the Reports page list (only show reports that have been risk-assessed).

```sql
SELECT
  r.id,
  r.company_name_raw     AS company_name,
  r.status,
  r.submitted_at,
  ra.score               AS risk_score,
  ra.category            AS risk_category
FROM reports r
INNER JOIN risk_assessments ra ON ra.report_id = r.id AND ra.is_current = TRUE
WHERE r.status != 'rejected'
ORDER BY ra.score DESC, r.submitted_at DESC
LIMIT 20 OFFSET 0;
```

**Why INNER JOIN:** Only returns reports that have a current assessment. `AND ra.is_current = TRUE` ensures we join to the active version only, never to a superseded historical assessment.

---

### 6.2 LEFT JOIN — Get all companies with their report count (including companies with 0 reports)

**Use case:** Admin company overview — show all companies even if no reports yet.

```sql
SELECT
  c.id,
  c.name,
  c.domain,
  c.flagged,
  COUNT(r.id)              AS report_count,
  COALESCE(AVG(ra.score), 0)::INT  AS avg_risk_score
FROM companies c
LEFT JOIN reports r     ON r.company_id = c.id
LEFT JOIN risk_assessments ra ON ra.report_id = r.id AND ra.is_current = TRUE
GROUP BY c.id, c.name, c.domain, c.flagged
ORDER BY report_count DESC;
```

**Why LEFT JOIN:** A company may have been created but not yet have any reports. `INNER JOIN` would exclude it. `LEFT JOIN` returns `NULL` for `report_count` which `COUNT()` treats as 0.

---

### 6.3 GROUP BY + HAVING — Find identifiers shared across 2 or more reports

**Use case:** Detecting shared identifiers for the Trust Graph — the core deduplication query.

```sql
SELECT
  i.id,
  i.type,
  i.value,
  i.normalized_value,
  i.flagged,
  COUNT(ri.report_id)       AS shared_count,
  ARRAY_AGG(ri.report_id)  AS connected_report_ids
FROM identifiers i
INNER JOIN report_identifiers ri ON ri.identifier_id = i.id
GROUP BY i.id, i.type, i.value, i.normalized_value, i.flagged
HAVING COUNT(ri.report_id) >= 2
ORDER BY shared_count DESC, i.flagged DESC;
```

**Why HAVING:** `WHERE` filters rows before grouping. We need to filter *after* counting, so `HAVING COUNT(...) >= 2` is required. This cannot be expressed with `WHERE`.

---

### 6.4 Subquery — Get the top 5 riskiest unreviewed reports

**Use case:** Admin dashboard risk alerts — show the highest-risk pending reports.

```sql
SELECT *
FROM (
  SELECT
    r.id,
    r.company_name_raw,
    r.submitted_at,
    ra.score,
    ra.category
  FROM reports r
  INNER JOIN risk_assessments ra ON ra.report_id = r.id AND ra.is_current = TRUE
  WHERE r.status = 'pending'
) AS pending_scored
WHERE score >= 70
ORDER BY score DESC
LIMIT 5;
```

**Why subquery:** The inner query first filters and joins, then the outer query applies the score threshold. This can also be written as a CTE — same performance, clearer syntax:

```sql
WITH pending_scored AS (
  SELECT r.id, r.company_name_raw, r.submitted_at, ra.score, ra.category
  FROM reports r
  INNER JOIN risk_assessments ra ON ra.report_id = r.id AND ra.is_current = TRUE
  WHERE r.status = 'pending'
)
SELECT * FROM pending_scored
WHERE score >= 70
ORDER BY score DESC
LIMIT 5;
```

---

### 6.5 Recursive CTE — Multi-hop Trust Graph traversal

**Use case:** From a starting report (or identifier), find all connected reports up to N hops away. This is what powers the "Explore connections" feature in the Trust Graph.

```sql
-- Find all reports connected to report R001, up to 3 hops deep.
-- A "hop" is: Report → Identifier → Report (each identifier shared between reports).

WITH RECURSIVE trust_graph AS (

  -- Seed: start from the given report
  SELECT
    r.id          AS report_id,
    r.company_name_raw,
    0             AS depth,
    ARRAY[r.id]   AS visited_reports   -- track path to prevent cycles
  FROM reports r
  WHERE r.id = 'R001'           -- <-- starting point, parameterised in real API

  UNION ALL

  -- Recursive step: from each report in the frontier,
  --   find identifiers linked to it,
  --   then find other reports sharing those identifiers.
  SELECT
    next_report.id,
    next_report.company_name_raw,
    tg.depth + 1,
    tg.visited_reports || next_report.id
  FROM trust_graph tg

  -- Step 1: get all identifiers linked to current report
  INNER JOIN report_identifiers ri_a
    ON ri_a.report_id = tg.report_id

  -- Step 2: get all OTHER reports sharing that identifier
  INNER JOIN report_identifiers ri_b
    ON  ri_b.identifier_id = ri_a.identifier_id  -- same identifier (corrected from tg.report_id)
    AND ri_b.report_id    != tg.report_id    -- not the same report

  INNER JOIN reports next_report
    ON next_report.id = ri_b.report_id

  WHERE
    tg.depth < 3                                    -- max 3 hops
    AND NOT (next_report.id = ANY(tg.visited_reports))  -- no cycles
)

SELECT DISTINCT
  report_id,
  company_name_raw,
  depth
FROM trust_graph
WHERE depth > 0      -- exclude the seed report itself
ORDER BY depth, company_name_raw;
```

**How to read this:**
1. The base case selects the starting report at depth 0.
2. Each recursive step finds all identifiers on the current-depth reports, then finds all other reports that share those identifiers.
3. `visited_reports` is an array acting as a "visited" set to prevent infinite loops.
4. `depth < 3` limits traversal — prevents full-table scans on large graphs.
5. The final `SELECT DISTINCT` deduplicates paths that reach the same report via different routes.

**In Prisma:** This is one of the cases where raw SQL is justified (`prisma.$queryRaw`). Prisma's relational API cannot express recursive CTEs.

---

## 7. Transaction Example — Admin Moderation with Rollback

**Use case:** An admin changes a report's status from `pending` to `verified`. This must atomically:
1. Update the report's status and reviewer
2. Archive the current risk assessment and insert a new current version (versioned pattern)
3. Insert an immutable audit log entry

If any step fails, the entire operation rolls back — no partial state.

```sql
BEGIN;

  -- Step 1: Update report status (optimistic lock — only update if still pending)
  UPDATE reports
  SET
    status      = 'verified',
    reviewed_by = 'U002',
    reviewed_at = NOW(),
    is_verified = TRUE
  WHERE id = 'R001' AND status = 'pending';

  -- (In Express/Node: check result.rowCount === 1; if 0, ROLLBACK)

  -- Step 2a: Archive the current risk assessment
  UPDATE risk_assessments
    SET is_current = FALSE
  WHERE report_id = 'R001' AND is_current = TRUE;

  -- Step 2b: Insert new current assessment version
  INSERT INTO risk_assessments
    (report_id, score, category, summary, assessed_by, is_current, version)
  SELECT
    'R001',
    COALESCE(score, 75),   -- re-scored with verified weight applied
    'high',
    'Report verified by admin. Risk signals confirmed.',
    'U002',
    TRUE,
    COALESCE((SELECT MAX(version) FROM risk_assessments WHERE report_id = 'R001'), 0) + 1
  FROM risk_assessments
  WHERE report_id = 'R001' AND is_current = FALSE
  ORDER BY version DESC
  LIMIT 1;

  -- Step 3: Insert immutable audit log entry
  INSERT INTO audit_logs (
    actor_id, action, report_id, old_value, new_value, notes
  ) VALUES (
    'U002', 'STATUS_CHANGED', 'R001', 'pending', 'verified',
    'UPI confirmed in multiple reports, verification complete'
  );

COMMIT;

-- ROLLBACK; -- issued explicitly if rowCount check fails at step 1
```

**In Node.js with Prisma (`prisma.$transaction`):**

```js
await prisma.$transaction(async (tx) => {
  // Step 1: Status update with optimistic lock
  const updated = await tx.report.updateMany({
    where: { id: reportId, status: 'pending' },
    data: { status: 'verified', reviewedBy: adminId, reviewedAt: new Date(), isVerified: true }
  });
  if (updated.count === 0) throw new Error('Report not found or already reviewed');

  // Step 2: Version the risk assessment — archive old, insert new
  // ⚠️ Prisma cannot do this in one Prisma call because it involves a correlated subquery
  //    for the version increment. Use $queryRaw inside the transaction:
  await tx.$executeRaw`
    UPDATE risk_assessments SET is_current = FALSE
    WHERE report_id = ${reportId} AND is_current = TRUE
  `;
  const prevVersion = await tx.riskAssessment.findFirst({
    where: { reportId },
    orderBy: { version: 'desc' },
    select: { version: true, score: true, category: true }
  });
  await tx.riskAssessment.create({
    data: {
      reportId,
      score: prevVersion?.score ?? 75,
      category: prevVersion?.category ?? 'high',
      summary: 'Report verified by admin. Risk signals confirmed.',
      assessedBy: adminId,
      isCurrent: true,
      version: (prevVersion?.version ?? 0) + 1,
    }
  });

  // Step 3: Immutable audit log
  await tx.auditLog.create({
    data: { actorId: adminId, action: 'STATUS_CHANGED', reportId, oldValue: 'pending', newValue: 'verified', notes }
  });
});
// If any step throws, Prisma automatically issues ROLLBACK
```

---

## 8. Mock Data → Database Mapping

### How each mock file maps to tables

| Mock file | Maps to table(s) | Key notes |
|---|---|---|
| `users.js` → `DEMO_USERS` | `users` | `password` → bcrypt hash in `password_hash`; `submittedReports` / `savedReports` arrays → `reports.submitted_by` and `saved_reports` junction |
| `companies.js` | `companies` | `reportCount` and `riskScore` removed — computed by SQL; `createdAt` → `created_at` |
| `recruiters.js` | `recruiters` + `recruiter_companies` | `companyId` / `companyName` → entry in `recruiter_companies`; `reportCount` / `riskScore` → computed |
| `identifiers.js` | `identifiers` | `reportIds: [...]` array → rows in `report_identifiers`; `normalizedValue` → `normalized_value`; `confidence` → used in `report_identifiers.confidence` |
| `reports.js` | `reports` + `risk_assessments` + `risk_factors` | `identifierIds` → `report_identifiers`; `clusterIds` → `cluster_reports`; `riskFactors` array → `risk_factors` table; `informationStatus` object → `is_verified` + `is_inferred` columns; seed creates one `risk_assessment` row per report with `is_current = TRUE, version = 1` |
| `clusters.js` | `clusters` + `cluster_reports` | `reportIds` → `cluster_reports`; `identifierIds` → **not seeded** (cluster_identifiers dropped for v1; identifiers are derived via JOIN); `riskScore` and `totalReports` → computed with SQL |
| `evidence.js` | **merged into `report_identifiers`** | `type` → `match_type`, `description` → `match_description` on the `report_identifiers` row for the matching `(report_id, identifier_id)` pair |
| `auditLogs.js` | `audit_logs` | `userId` → `actor_id`; nullable `reportId`/`identifierId`/`clusterId` mapped directly; `USER_BANNED` entries must set `target_user_id` |

### How frontend services map to API endpoints

| Frontend service (`mockApi.js`) | Backend API endpoint | Tables involved |
|---|---|---|
| `checkOffer(formData, role)` | `POST /api/checks` | `offer_checks`, `identifiers`, `report_identifiers`, `reports`, `risk_assessments` |
| `getReports(filters, role)` | `GET /api/reports` | `reports`, `risk_assessments`, `companies` |
| `getReport(id, role)` | `GET /api/reports/:id` | `reports`, `identifiers`, `report_identifiers`, `risk_assessments`, `risk_factors`, `clusters` |
| `searchIdentifiers(query, role)` | `GET /api/identifiers?q=` | `identifiers`, `report_identifiers` |
| `getDashboardStats(userId)` | `GET /api/dashboard/stats` | `offer_checks`, `reports`, `risk_assessments`, `identifiers`, `clusters` |
| `updateReportStatus(id, status)` | `PATCH /api/admin/reports/:id` | `reports`, `risk_assessments`, `audit_logs` (transaction) |
| `getAuditLogs(filters)` | `GET /api/admin/audit-logs` | `audit_logs`, `users` |
| `getClusters()` | `GET /api/clusters` | `clusters`, `cluster_reports`, `report_identifiers`, `risk_assessments` (computed risk) |
| `getAdminStats()` | `GET /api/admin/stats` | `reports`, `identifiers`, `clusters` (aggregation) |
| `submitReport(data)` | `POST /api/reports` | `reports`, `identifiers`, `report_identifiers`, `risk_assessments`, `risk_factors` |
| `getIdentifierById(id, role)` | `GET /api/identifiers/:id` | `identifiers`, `report_identifiers`, `reports` |
| *(auth — no mockApi equivalent)* | `POST /api/auth/signup`, `/login`, `/refresh`, `/logout` | `users`, `refresh_tokens` |

### Trust Graph → SQL

The frontend `graphService.js` currently runs in the browser. The backend replaces it:

| Frontend function | Backend equivalent |
|---|---|
| `buildGraphData(reports, identifiers)` | SQL: `GROUP BY identifier_id HAVING COUNT(*) >= 2` joins |
| `getConnectedSubgraph(nodeId, depth)` | SQL: Recursive CTE (see §6.5) |
| `explainConnection(reportIdA, reportIdB)` | SQL: `SELECT` on `report_identifiers` where both report IDs share an `identifier_id` |
| `calculateNodePositions()` | Stays in frontend (pure UI concern, not a DB operation) |

---

## 9. Security & Data Integrity Risks

### Authentication & Authorization

| Risk | Mitigation |
|---|---|
| Passwords stored in plaintext (current mock) | bcrypt hash with cost factor 12 — never store raw passwords |
| JWT secret exposed | Store in env variable, never commit to git; rotate on breach |
| Students accessing admin endpoints | Middleware checks `user.role === 'admin'` on every admin route |
| A user changing another user's report | `WHERE submitted_by = req.user.id` on all report mutations for students |
| `_role` passed in request body (current bug) | Fixed in frontend; backend derives role exclusively from JWT payload |
| Token replay after logout | Use short-lived access tokens (15 min) + refresh token rotation; store SHA-256 hash of token in `refresh_tokens.token_hash`; revoke entire `family` on reuse detection |
| Stolen refresh token reuse | `refresh_tokens.family` UUID — if a revoked token in a family is presented, revoke all tokens in that family immediately (all sessions of that user invalidated) |

### Data Integrity

| Risk | Mitigation |
|---|---|
| Duplicate identifier on INSERT | `UNIQUE(type, normalized_value)` constraint — use `INSERT ... ON CONFLICT DO UPDATE` (upsert) |
| Orphaned `report_identifiers` after report delete | `ON DELETE CASCADE` on `report_id` FK |
| Two active risk assessments for same report | Partial unique index (`ON risk_assessments (report_id) WHERE is_current = TRUE`) prevents duplicates; archive-then-insert transaction guarantees exactly one `is_current=TRUE` row after each update |
| Risk score outside 0–100 | `CHECK (score BETWEEN 0 AND 100)` on `risk_assessments` and `identifiers` |
| `offer_message` submitted empty | `CHECK (LENGTH(TRIM(offer_message)) >= 20)` |
| Admin deleting a user who authored reports | `ON DELETE RESTRICT` on `reports.submitted_by` — prevents silent data loss |
| Audit log tampered with | No `UPDATE`/`DELETE` grants on `audit_logs` for the application DB user; inserts only |

### Input Validation

| Risk | Mitigation |
|---|---|
| SQL injection | Prisma parameterises all queries; raw SQL uses `prisma.$queryRaw` with tagged template literals |
| XSS in offer_message stored and reflected | Sanitise on write (strip `<script>` etc.) AND escape on render (React does this by default) |
| Oversized offer_message | `TEXT` column is unlimited — add Express `body-parser` size limit (e.g. 10 KB per field) |
| Email format bypass | `CHECK` constraint + Zod validation in Express route |
| Normalisation inconsistency (phone with/without +91) | Normalisation applied in a single shared utility before every INSERT and lookup |

### Privacy

| Risk | Mitigation |
|---|---|
| Students seeing unmasked phones/emails | Masking applied in API response layer, not in DB; `SELECT` returns full value, middleware masks before serialisation |
| Admin identifier exposure | Only `role === 'admin'` receives unmasked values — checked in response serialiser; every reveal logged in `audit_logs` as `IDENTIFIER_REVEALED` |
| Raw client IP stored | HMAC-SHA256 keyed with `IP_HASH_SECRET` stored as `offer_checks.ip_hash CHAR(64)` — non-reversible without the secret; used for rate limiting without storing a PII-bearing INET value |
| Offer check results persist indefinitely | `offer_checks.result` is nullable JSONB — always populated on insert; a scheduled job runs `UPDATE offer_checks SET result = NULL WHERE checked_at < NOW() - INTERVAL '90 days'` to reclaim storage |

---

## 10. Recommended Architecture

### Final table list (15 tables)

```
users                 — authentication, roles, is_banned
refresh_tokens        — JWT rotation (hashed), family-based reuse detection
companies             — employer entities
recruiters            — individual recruiter contacts
recruiter_companies   — M:N junction
reports               — core fraud incident records
identifiers           — deduped contact points (phone, email, UPI, domain, bank)
report_identifiers    — M:N junction + confidence + match_type + match_description
risk_assessments      — versioned score per report (is_current = TRUE is active)
risk_factors          — per-factor breakdown rows (enables GROUP BY analytics)
clusters              — fraud actor groups (risk score computed, not stored)
cluster_reports       — M:N junction
saved_reports         — user bookmarks
offer_checks          — lookup history (JSONB snapshot + ip_hash for rate limiting)
audit_logs            — immutable admin action log (+ target_user_id)
```

**Total: 15 tables.**  
Dropped from original design: `evidence` (merged into `report_identifiers`), `cluster_identifiers` (dropped for v1 — derived via SQL JOIN).  
Added: `refresh_tokens` (session management).

---

### Important Design Decisions (v2)

1. **UUIDs, not serial integers.** `gen_random_uuid()` avoids enumerable IDs in URLs and is safe for distributed inserts.
2. **ENUMs over VARCHAR for status/type columns.** The database enforces valid values at the constraint level.
3. **`evidence` merged into `report_identifiers`** as `match_type VARCHAR(50)` and `match_description TEXT`. Eliminates one JOIN on every Trust Graph and report-detail query without losing any information.
4. **`risk_assessments` is versioned (1:N).** `is_current = TRUE` marks the active version. Only one row per `report_id` may have `is_current = TRUE` — enforced by a **partial unique index** in a custom SQL migration (Prisma cannot express this in schema.prisma).
5. **`cluster_identifiers` dropped for v1.** The defining identifiers of a cluster are fully derivable via SQL JOIN on `report_identifiers` and `cluster_reports`. Re-add only if admin-curated cluster membership is needed in a future version.
6. **`clusters.risk_score` removed.** Storing a computed average violates 3NF. Compute with `AVG(ra.score)` JOIN on demand — same reasoning the design correctly applies to `companies`.
7. **`offer_checks.result` is nullable JSONB.** Always populated on insert; a scheduled job nullifies it after 90 days to reclaim storage. FK-only would require re-running the engine (which may produce a different result if new reports arrive). Null after expiry is preferred over `NOT NULL` because enforcing non-null while simultaneously nullifying via a job is a schema contradiction.
8. **`refresh_tokens` with SHA-256 hash + family.** Token hash uses SHA-256 (not bcrypt) for fast lookup. `family UUID` enables rotation-chain tracking — if a revoked token is reused, revoke the entire family (all sessions of that user).
9. **`audit_logs` has `target_user_id`.** Needed for `USER_BANNED` and `IDENTIFIER_REVEALED` actions that target a user but do not reference a report/identifier/cluster. CHECK constraint requires at least one of four target columns to be non-null.
10. **Recursive CTE for Trust Graph.** No graph database needed. PostgreSQL handles multi-hop traversal with a depth cap efficiently for datasets of this size. `tsvector` GIN indexes are sufficient for FTS up to ~50k reports; Meilisearch at scale.

---

### Design Decisions Resolved (previously unresolved)

| Question | Decision |
|---|---|
| `offer_checks.result` — JSONB snapshot or FK-only? | **Nullable JSONB snapshot.** Always populated on insert; nullified after 90 days by scheduled job. Nullable column avoids the NOT NULL contradiction with the retention job. |
| Anonymous report submission? | **No.** `submitted_by NOT NULL`. Authentication required. |
| `risk_assessments` versioned? | **Yes.** `is_current` pattern with partial unique index. |
| Rate limiting for `offer_checks`? | **`ip_hash CHAR(64)`.** HMAC-SHA256(client IP, `IP_HASH_SECRET`) stored; SQL count by ip_hash per hour. No Redis needed. |
| Full-text search engine? | **`tsvector` GIN sufficient to ~50k reports.** Meilisearch at scale. |

---

### Implementation Order (Phase 2)

**Do not start until this document is approved.**

```
1.  Set up Node.js + Express project structure (backend/ subfolder)
2.  Install: express, prisma, @prisma/client, bcryptjs, jsonwebtoken, zod, cors, dotenv, helmet
3.  Write prisma/schema.prisma from §5 (v2 corrected schema)
4.  Write custom SQL migration blocks for:
      - Partial unique index: ON risk_assessments (report_id) WHERE is_current = TRUE
      - Partial index: ON refresh_tokens (token_hash) WHERE revoked_at IS NULL
      - CHECK constraints on audit_logs and reports
5.  Run: npx prisma migrate dev --name init
6.  Write seed.js — convert all 7 mock data files to DB inserts with normalisation applied
7.  Run: npx prisma db seed — verify 15 tables seeded
8.  POST /api/auth/signup, /login, /refresh, /logout (refresh_tokens rotation)
9.  JWT middleware + requireAdmin middleware
10. Zod validation schemas for all request bodies
11. Global error handler (AppError → JSON response)
12. GET /api/reports (list, filter by status/risk/search, keyset pagination)
13. GET /api/reports/:id (report + identifiers + risk factors, role-based masking)
14. POST /api/reports (submit: normalise → upsert identifiers → compute risk → version assessment)
15. POST /api/checks (offer check: match → score → store JSONB snapshot + ip_hash)
16. GET /api/identifiers, GET /api/identifiers/:id
17. GET /api/clusters (with computed risk score via JOIN)
18. GET /api/graph?start=:id&depth=:n (recursive CTE Trust Graph)
19. Admin routes: PATCH /api/admin/reports/:id, /identifiers/:id, GET /api/admin/stats, /audit-logs, /users
20. Replace frontend mockApi.js with real fetch() calls and test every route end-to-end
21. Remove mock data files ONLY after all routes pass against the live API (mock data serves as the reference fixture for seeding and testing until this point)
```

