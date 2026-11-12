# OfferCheck — Senior Engineering Architecture Review

**Reviewer role:** Senior backend engineer + PostgreSQL architect  
**Scope:** Pre-implementation review of `backend-design.md` and the full frontend project  
**Status:** ALL CORRECTIONS APPLIED — design is READY FOR PHASE 2 APPROVAL

> **v2 — post-correction update.** This document was originally written as a review of the initial design, listing recommended changes. All 8 corrections have now been applied directly to `backend-design.md`. Scores, table counts and decision tables below reflect the **final corrected state**.

---

## Scores (v2 — post-correction)

| Dimension | Score | Rationale |
|---|---|---|
| Database design | **9 / 10** | Solid normalisation, correct FKs, well-justified indexes. Evidence merged, cluster_identifiers dropped, risk_assessments versioned, computed cluster risk — all 3NF-compliant decisions applied. One mark held: partial indexes and CHECK constraints require custom SQL migration outside Prisma. |
| Backend architecture | **8 / 10** | Layers clearly defined. Refresh token rotation with family-based reuse detection added. Keyset pagination and N+1-safe graph query documented. Rate limiting resolved with ip_hash (no Redis). |
| Security | **8 / 10** | bcrypt, role-from-JWT, identifier masking, immutable audit log, IDENTIFIER_REVEALED logging, ip_hash for anonymous rate limiting, refresh token family revocation on reuse. No significant gaps remain. |
| Performance | **8 / 10** | Strategic partial indexes, GIN FTS, composite index rationale present. N+1-safe recursive CTE pattern documented. EXPLAIN ANALYZE example included for DBMS demonstration. |
| Maintainability | **9 / 10** | Clear service/controller/middleware separation documented. seed.js (not seed.ts) specified. All Prisma limitations flagged with ⚠️ notes and custom migration SQL provided. |
| DBMS demonstration value | **9 / 10** | Recursive CTE, normalisation proof (1NF/2NF/3NF with mock data examples), transaction with rollback, GROUP BY/HAVING, partial indexes, keyset pagination — excellent DBMS exam coverage. |

**Overall: 15-table design, all corrections applied, ready for Phase 2.**

---

## 1. Overall Architecture Verdict

The design is production-aware for a student fraud-intelligence project. The separation of `identifiers` from `reports`, the recursive CTE for Trust Graph, `risk_factors` as rows (not JSONB), and the immutable `audit_logs` table are all correct decisions that demonstrate real understanding of relational modelling.

**Three correctness issues were found in the original design and have been fixed:**

1. ✅ **Critical bug in the recursive CTE** (§6.5) — `ri_b.identifier_id = tg.report_id` compared an identifier UUID to a report UUID (always unequal, returning zero rows). Fixed to `ri_b.identifier_id = ri_a.identifier_id`.
2. ✅ **`audit_logs` CHECK constraint gap** — `USER_BANNED` referenced no report/identifier/cluster. Fixed by adding `target_user_id UUID FK` and relaxing the CHECK to a 4-way OR.
3. ✅ **`evidence` table overlap with `report_identifiers`** — merged as `match_type` and `match_description` on `report_identifiers`. Eliminates one JOIN on every Trust Graph and report-detail query.

---

## 2. Final Table List (15 tables)

```
users                 — authentication, roles, is_banned
refresh_tokens        — JWT rotation, hashed token storage, family reuse detection
companies             — employer entities
recruiters            — individual contacts
recruiter_companies   — M:N junction
reports               — core fraud incident records
identifiers           — deduped contact points
report_identifiers    — M:N junction + confidence + match_type + match_description
risk_assessments      — versioned; is_current=TRUE is active version
risk_factors          — per-factor breakdown rows
clusters              — fraud actor groups (risk score computed, not stored)
cluster_reports       — M:N junction
saved_reports         — user bookmarks
offer_checks          — lookup history (JSONB snapshot + ip_hash)
audit_logs            — immutable admin log (+ target_user_id)
```

**NOT in v1:**  
- `evidence` — merged into `report_identifiers`  
- `cluster_identifiers` — dropped; derived via SQL JOIN  

**Added:**  
- `refresh_tokens` — required for real auth (short-lived JWT + server-stored rotation)

---

## 3. All Corrections Applied

### Fix 1 — Recursive CTE bug ✅ APPLIED

**Original (wrong):**
```sql
INNER JOIN report_identifiers ri_b
  ON  ri_b.identifier_id = tg.report_id    -- BUG: UUID type mismatch, always zero rows
```

**Corrected (in §6.5):**
```sql
INNER JOIN report_identifiers ri_b
  ON  ri_b.identifier_id = ri_a.identifier_id  -- same identifier shared by both reports
  AND ri_b.report_id    != tg.report_id         -- not the same report
```

---

### Fix 2 — Merge `evidence` into `report_identifiers` ✅ APPLIED

`evidence` stored `(report_id, identifier_id, type, description, confidence)`.  
`report_identifiers` already holds the same pair with `confidence`.

**Applied:** `match_type VARCHAR(50)` and `match_description TEXT` added to `report_identifiers`. `evidence` table removed from schema (§3), Prisma schema (§5), and all API endpoint rows (§8).

---

### Fix 3 — `audit_logs` CHECK constraint ✅ APPLIED

**Original constraint:**
```sql
CHECK (report_id IS NOT NULL OR identifier_id IS NOT NULL OR cluster_id IS NOT NULL)
```
Fails for `USER_BANNED` — no report/identifier/cluster reference.

**Applied:** `target_user_id UUID REFERENCES users(id) ON DELETE SET NULL` added. Constraint relaxed to 4-way OR. `IDENTIFIER_REVEALED` added to `AuditAction` enum.

---

### Fix 4 — Remove `clusters.risk_score` ✅ APPLIED

Storing a computed average in a column violates 3NF and creates update anomalies — the same design correctly avoids this on `companies`. Column removed from §3 schema and §5 Prisma model. Computed on demand:

```sql
SELECT cl.id, cl.name, COALESCE(AVG(ra.score), 0)::INT AS risk_score
FROM clusters cl
JOIN cluster_reports cr ON cr.cluster_id = cl.id
JOIN risk_assessments ra ON ra.report_id = cr.report_id AND ra.is_current = TRUE
GROUP BY cl.id, cl.name;
```

---

### Fix 5 — Add `refresh_tokens` table ✅ APPLIED

Required for real auth. Applied in §3 (PostgreSQL schema) and §5 (Prisma model `RefreshToken`):

```sql
CREATE TABLE refresh_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  CHAR(64)    NOT NULL,   -- SHA-256 of token (not bcrypt — lookup performance)
  family      UUID        NOT NULL,   -- rotation chain ID; reuse revokes entire family
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

SHA-256 chosen over bcrypt for `token_hash` because refresh token lookup is on the hot path; bcrypt's work factor makes it unsuitable for a database lookup.

---

### Fix 6 — `offer_checks.result` nullable JSONB snapshot + `ip_hash` HMAC-SHA256 ✅ APPLIED

`result Json?` (nullable in §5 Prisma; nullable JSONB in §3 DDL) stores the full risk engine output at check time. FK-only would require re-running the engine (which may produce a different result if new reports arrive). The column is **nullable** (not `NOT NULL`) so a scheduled job can run `UPDATE offer_checks SET result = NULL WHERE checked_at < NOW() - INTERVAL '90 days'` without contradicting the schema.

`ip_hash CHAR(64)` stores **HMAC-SHA256(client_ip, IP_HASH_SECRET)** — no PII stored, no Redis needed. Plain SHA-256 was replaced because the IPv4 space (~4 billion addresses) is small enough to reverse by dictionary attack; HMAC with a server-side secret prevents this:
```sql
-- $1 = HMAC-SHA256(client_ip, IP_HASH_SECRET) — computed in Express middleware
SELECT COUNT(*) FROM offer_checks
WHERE ip_hash = $1 AND checked_at > NOW() - INTERVAL '1 hour';
```
`IP_HASH_SECRET` stored in `.env`, never committed to git. Rotate by updating the env var and running `UPDATE offer_checks SET ip_hash = NULL`.

---

### Fix 7 — `risk_assessments` versioned ✅ APPLIED

`is_current BOOLEAN` and `version SMALLINT` added. `@unique` on `report_id` removed — multiple versions allowed.

The **partial unique index** guarantees *at most one* `is_current = TRUE` row per `report_id` (prevents duplicates from concurrent inserts):

```sql
-- Custom SQL migration required; Prisma cannot express partial indexes:
CREATE UNIQUE INDEX idx_risk_assessments_current
  ON risk_assessments (report_id) WHERE is_current = TRUE;
```

The **archive-then-insert transaction** guarantees *exactly one* `is_current = TRUE` row after every successful assessment creation or update (Step 1 sets old row to FALSE, Step 2 inserts new TRUE row; the index rolls back the transaction if a concurrent race produces a duplicate).

All SQL examples in §6 updated to include `AND ra.is_current = TRUE`.

---

### Fix 8 — `cluster_identifiers` dropped for v1 ✅ APPLIED

The junction is redundant if clusters are auto-computed. Derivation query documented in §3:

```sql
SELECT ri.identifier_id, COUNT(DISTINCT ri.report_id) AS report_count
FROM report_identifiers ri
JOIN cluster_reports cr ON cr.report_id = ri.report_id
WHERE cr.cluster_id = $cluster_id
GROUP BY ri.identifier_id
HAVING COUNT(DISTINCT ri.report_id) >= 2;
```

Re-add in a future version if admin-curated cluster membership is required.

---

## 4. Prisma Limitations — Custom SQL Migrations Required

The following cannot be expressed in `schema.prisma` and must be added as raw SQL blocks in the migration file:

| Limitation | Custom SQL required |
|---|---|
| Partial unique index on `risk_assessments (report_id) WHERE is_current = TRUE` | `CREATE UNIQUE INDEX idx_risk_assessments_current ON risk_assessments (report_id) WHERE is_current = TRUE;` |
| Partial index on `refresh_tokens (token_hash) WHERE revoked_at IS NULL` | `CREATE INDEX idx_refresh_tokens_active ON refresh_tokens (token_hash) WHERE revoked_at IS NULL;` |
| CHECK on `audit_logs` (4-way OR) | `ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_has_target CHECK (report_id IS NOT NULL OR identifier_id IS NOT NULL OR cluster_id IS NOT NULL OR target_user_id IS NOT NULL);` |
| CHECK on `reports.reviewed_at` | `ALTER TABLE reports ADD CONSTRAINT chk_reviewed CHECK (reviewed_at IS NULL OR reviewed_by IS NOT NULL);` |

These are all noted with `⚠️` in §5 of `backend-design.md`.

---

## 5. Remaining Minor Limitations (Intentional, Documented)

| Item | Decision |
|---|---|
| `offer_checks` rate limit threshold | 20 checks/hour/IP is a chosen constant; adjust in middleware config without schema change |
| FTS scale threshold | `tsvector` GIN sufficient to ~50k reports; at scale, Meilisearch or pg_search recommended |
| `offer_checks.result` retention | Nullable JSONB; nullified after 90 days by scheduled job (`UPDATE offer_checks SET result = NULL WHERE checked_at < NOW() - INTERVAL '90 days'`); schema allows NULL so no contradiction |
| Soft-delete | Not implemented; `rejected` status + FK RESTRICT is sufficient for this use case |

---

## 6. Features That Genuinely Differentiate OfferCheck

| Feature | Why it stands out |
|---|---|
| **Deduplication-first identifier storage** | Shared entities enable cross-report linking without a graph database |
| **Explainable risk scoring** | `risk_factors` rows — each factor has `factor_key`, `weight`, `explanation`, `confidence`. Not a black box. |
| **Recursive CTE Trust Graph** | Multi-hop traversal in PostgreSQL — no Neo4j, no external service |
| **Atomic admin moderation** | 3-step `prisma.$transaction` (archive old assessment → insert new → audit log) with rollback |
| **Normalisation proof** | 1NF/2NF/3NF section with real mock data examples — exactly what a DBMS viva examiner expects |
| **Privacy-by-design masking** | Full values stored once; role-based response serialiser decides what each user sees |
| **Versioned risk assessments** | History preserved; partial index enforces *at most one* active version; archive-then-insert transaction guarantees *exactly one* after each update |
| **Refresh token family rotation** | Reuse detection without Redis — stolen token revokes all sessions of that user |

---

## 7. Features Deliberately Excluded

| Feature | Why excluded |
|---|---|
| Redis / Memcached | Not needed at this scale; PostgreSQL indexed reads are fast enough |
| Neo4j / ArangoDB | Trust Graph is a relational problem; PostgreSQL recursive CTE handles depth-3 traversal in milliseconds |
| Machine learning risk scoring | Rule-based scoring is explainable and auditable — appropriate for a fraud *warning* system |
| Elasticsearch / Meilisearch | GIN `tsvector` indexes sufficient for FTS on 35–50k reports |
| Microservices | One Express app, one PostgreSQL database — correct for a 1-2 developer team |
| Soft-delete (`deleted_at`) | `rejected` status + FK RESTRICT is sufficient; physical deletion restricted by constraints |
| Anonymous report submission | `submitted_by NOT NULL` — authentication required, preventing spam and legal ambiguity |

---

## 8. Appendix — Corrections Applied to `backend-design.md`

| Section | Correction applied |
|---|---|
| Header (§1 intro) | Updated to v2, 15 tables finalised |
| §1 — What OfferCheck stores | Removed Evidence row; added Refresh Tokens; updated RiskAssessment and OfferCheck descriptions |
| §1 — Core design decisions | 8 decisions updated to reflect all v2 changes |
| §2 — ER diagram | Full rewrite: removed evidence/cluster_identifiers boxes, added refresh_tokens, updated risk_assessments |
| §2 — Cardinality table | Removed Evidence and cluster_identifiers rows; added RefreshTokens and TargetUser audit rows |
| §3 — `report_identifiers` | Added `match_type`, `match_description` columns |
| §3 — `evidence` section | Replaced with "~~Merged~~" note with rationale |
| §3 — `risk_assessments` | Added `is_current`, `version`; documented partial unique index with ⚠️ note |
| §3 — `clusters` | Removed `risk_score` column; added computed risk SQL |
| §3 — `cluster_identifiers` | Replaced with "~~Dropped for v1~~" note with derivation SQL |
| §3 — `offer_checks` | Added `ip_hash CHAR(64)`, `result JSONB NOT NULL`, partial index, rate-limit SQL |
| §3 — `audit_logs` | Added `target_user_id UUID FK`; fixed CHECK constraint; added `IDENTIFIER_REVEALED` to enum |
| §3 — `refresh_tokens` | Fully added: `token_hash CHAR(64)`, `family UUID`, SHA-256 rationale, rotation protocol |
| §5 — Prisma Schema | Full rewrite (v2): removed Evidence/ClusterIdentifier models; updated ReportIdentifier, RiskAssessment, Cluster, AuditLog, OfferCheck, User; added RefreshToken; removed stale duplicate schema |
| §6 — All SQL examples | Added `AND ra.is_current = TRUE` to all risk_assessments joins |
| §6.5 — Recursive CTE | Fixed `ri_b.identifier_id = tg.report_id` → `ri_b.identifier_id = ri_a.identifier_id` |
| §7 — Transaction Example | Updated to 4-step versioning pattern (archive old → insert new) |
| §8 — API endpoint table | Removed `evidence` and `cluster_identifiers` references; added auth/refresh_tokens row |
| §9 — Security | Added refresh token family revocation, risk assessment versioning integrity, ip_hash privacy, IDENTIFIER_REVEALED audit trail |
| §10 — Recommended Architecture | Complete rewrite: 15 tables, v2 design decisions, resolved decisions table, 20-step implementation order |
