-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('student', 'admin');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('pending', 'verified', 'rejected', 'investigating');

-- CreateEnum
CREATE TYPE "IdentifierType" AS ENUM ('phone', 'email', 'upi', 'domain', 'bank_account');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "RiskCategory" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "ClusterStatus" AS ENUM ('active', 'investigating', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('STATUS_CHANGED', 'IDENTIFIER_FLAGGED', 'IDENTIFIER_REVEALED', 'CLUSTER_CREATED', 'CLUSTER_UPDATED', 'REPORT_FLAGGED', 'REPORT_SUBMITTED', 'REPORT_DELETED', 'USER_BANNED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" VARCHAR(72) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'student',
    "college" VARCHAR(200),
    "is_banned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "family" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "domain" VARCHAR(253),
    "industry" VARCHAR(100),
    "registered_state" VARCHAR(80),
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiters" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(20),
    "email" VARCHAR(254),
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recruiters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiter_companies" (
    "recruiter_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,

    CONSTRAINT "recruiter_companies_pkey" PRIMARY KEY ("recruiter_id","company_id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "submitted_by" TEXT NOT NULL,
    "reviewed_by" TEXT,
    "company_id" TEXT,
    "recruiter_id" TEXT,
    "company_name_raw" VARCHAR(200) NOT NULL,
    "recruiter_name_raw" VARCHAR(120),
    "domain_raw" VARCHAR(253),
    "phone_raw" VARCHAR(20),
    "email_raw" VARCHAR(254),
    "upi_raw" VARCHAR(80),
    "offer_message" TEXT NOT NULL,
    "payment_request" VARCHAR(300),
    "additional_notes" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'pending',
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "is_inferred" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identifiers" (
    "id" TEXT NOT NULL,
    "type" "IdentifierType" NOT NULL,
    "value" VARCHAR(300) NOT NULL,
    "normalized_value" VARCHAR(300) NOT NULL,
    "risk_score" SMALLINT NOT NULL DEFAULT 0,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "confidence" "ConfidenceLevel" NOT NULL DEFAULT 'low',
    "notes" TEXT,
    "first_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_identifiers" (
    "report_id" TEXT NOT NULL,
    "identifier_id" TEXT NOT NULL,
    "confidence" "ConfidenceLevel" NOT NULL DEFAULT 'medium',
    "match_type" VARCHAR(50),
    "match_description" TEXT,
    "added_by" TEXT,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_identifiers_pkey" PRIMARY KEY ("report_id","identifier_id")
);

-- CreateTable
CREATE TABLE "risk_assessments" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "score" SMALLINT NOT NULL,
    "category" "RiskCategory" NOT NULL,
    "summary" TEXT,
    "disclaimer" TEXT,
    "assessed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assessed_by" TEXT NOT NULL DEFAULT 'system',
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "version" SMALLINT NOT NULL DEFAULT 1,

    CONSTRAINT "risk_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_factors" (
    "id" TEXT NOT NULL,
    "assessment_id" TEXT NOT NULL,
    "factor_key" VARCHAR(80) NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "weight" SMALLINT NOT NULL,
    "evidence_text" TEXT,
    "confidence" "ConfidenceLevel" NOT NULL DEFAULT 'medium',
    "explanation" TEXT NOT NULL,

    CONSTRAINT "risk_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clusters" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "confidence" "ConfidenceLevel" NOT NULL DEFAULT 'medium',
    "status" "ClusterStatus" NOT NULL DEFAULT 'active',
    "connection_basis" TEXT,
    "discovered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clusters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cluster_reports" (
    "cluster_id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,

    CONSTRAINT "cluster_reports_pkey" PRIMARY KEY ("cluster_id","report_id")
);

-- CreateTable
CREATE TABLE "saved_reports" (
    "user_id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "saved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_reports_pkey" PRIMARY KEY ("user_id","report_id")
);

-- CreateTable
CREATE TABLE "offer_checks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "company_name" VARCHAR(200),
    "phone_query" VARCHAR(20),
    "email_query" VARCHAR(254),
    "upi_query" VARCHAR(80),
    "domain_query" VARCHAR(253),
    "risk_score" SMALLINT,
    "risk_category" "RiskCategory",
    "result" JSONB,
    "ip_hash" CHAR(64),
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "report_id" TEXT,
    "identifier_id" TEXT,
    "cluster_id" TEXT,
    "target_user_id" TEXT,
    "old_value" VARCHAR(100),
    "new_value" VARCHAR(100),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "companies_domain_key" ON "companies"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "identifiers_type_normalized_value_key" ON "identifiers"("type", "normalized_value");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruiter_companies" ADD CONSTRAINT "recruiter_companies_recruiter_id_fkey" FOREIGN KEY ("recruiter_id") REFERENCES "recruiters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruiter_companies" ADD CONSTRAINT "recruiter_companies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_recruiter_id_fkey" FOREIGN KEY ("recruiter_id") REFERENCES "recruiters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_identifiers" ADD CONSTRAINT "report_identifiers_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_identifiers" ADD CONSTRAINT "report_identifiers_identifier_id_fkey" FOREIGN KEY ("identifier_id") REFERENCES "identifiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_identifiers" ADD CONSTRAINT "report_identifiers_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_factors" ADD CONSTRAINT "risk_factors_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "risk_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cluster_reports" ADD CONSTRAINT "cluster_reports_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "clusters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cluster_reports" ADD CONSTRAINT "cluster_reports_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_checks" ADD CONSTRAINT "offer_checks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_identifier_id_fkey" FOREIGN KEY ("identifier_id") REFERENCES "identifiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "clusters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Custom SQL: required constraints and partial indexes ─────────────────────
-- (These cannot be expressed in schema.prisma and must be added here manually)

-- 1. Partial unique index: at most one active risk assessment per report
--    Enforces that is_current=TRUE is unique per report_id.
--    When re-assessing, old row must be updated to is_current=FALSE first.
CREATE UNIQUE INDEX "idx_risk_assessments_current"
  ON "risk_assessments" ("report_id") WHERE "is_current" = TRUE;

-- 2. Partial index: fast lookup of non-revoked refresh tokens by token_hash.
--    token_hash already has a full unique index; this partial index serves
--    the common hot-path: WHERE revoked_at IS NULL.
CREATE INDEX "idx_refresh_tokens_active"
  ON "refresh_tokens" ("token_hash") WHERE "revoked_at" IS NULL;

-- 3. CHECK on audit_logs: at least one target reference must be non-null.
--    Prevents orphaned audit log entries with no context.
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_has_target"
  CHECK (
    "report_id"      IS NOT NULL OR
    "identifier_id"  IS NOT NULL OR
    "cluster_id"     IS NOT NULL OR
    "target_user_id" IS NOT NULL
  );

-- 4. CHECK on reports: reviewed_at timestamp requires a reviewer.
--    Prevents inconsistent review state (timestamp set but no reviewer).
ALTER TABLE "reports" ADD CONSTRAINT "chk_reviewed"
  CHECK ("reviewed_at" IS NULL OR "reviewed_by" IS NOT NULL);
