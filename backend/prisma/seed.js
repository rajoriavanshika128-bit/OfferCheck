'use strict';

/**
 * OfferCheck — Phase 3: Database Seeding
 *
 * Seeds baseline mock data from src/data/*.js into PostgreSQL (offercheck_dev).
 * Strictly idempotent, transaction-safe, non-destructive.
 */

const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

// ─── Step 1: Environment & Preflight Database Safety ─────────────────────────
if (!process.env.DATABASE_URL) {
  const rootEnv = path.resolve(__dirname, '../../.env');
  const backendEnv = path.resolve(__dirname, '../.env');
  const envPath = fs.existsSync(rootEnv) ? rootEnv : backendEnv;
  require('dotenv').config({ path: envPath });
}

if (!process.env.DATABASE_URL) {
  console.error('[FATAL] DATABASE_URL is not set.');
  process.exit(1);
}

let parsedDbUrl;
try {
  parsedDbUrl = new URL(process.env.DATABASE_URL);
} catch (err) {
  console.error('[FATAL] Invalid DATABASE_URL format.');
  process.exit(1);
}

const dbHost = parsedDbUrl.hostname;
const dbName = parsedDbUrl.pathname.replace(/^\//, '');

// Confirm host is strictly localhost / 127.0.0.1
if (dbHost !== 'localhost' && dbHost !== '127.0.0.1') {
  console.error(`[FATAL] Safety violation: DATABASE_URL points to non-local host "${dbHost}". Aborting.`);
  process.exit(1);
}

// Confirm target database is strictly offercheck_dev
if (dbName !== 'offercheck_dev') {
  console.error(`[FATAL] Safety violation: DATABASE_URL points to "${dbName}", expected "offercheck_dev". Aborting.`);
  process.exit(1);
}

console.log(`[SAFE] Target database verified: "${dbName}" on local host "${dbHost}".`);

const prisma = require('../src/utils/prisma');

async function main() {
  // ─── Step 2: Database Identity & Migration Verification ──────────────────────
  const dbIdentity = await prisma.$queryRaw`SELECT current_database() as db_name, current_user as db_user;`;
  if (!dbIdentity || dbIdentity.length === 0 || dbIdentity[0].db_name !== 'offercheck_dev') {
    console.error(`[FATAL] Connected database is "${dbIdentity?.[0]?.db_name}", expected "offercheck_dev". Aborting.`);
    process.exit(1);
  }
  console.log(`[SAFE] Connected database confirmed: ${dbIdentity[0].db_name} (user: ${dbIdentity[0].db_user})`);

  const appliedMigrations = await prisma.$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = '20261113082200_init';`;
  if (!appliedMigrations || appliedMigrations.length === 0) {
    console.error('[FATAL] Migration 20261113082200_init is not applied. Aborting.');
    process.exit(1);
  }
  console.log('[SAFE] Verified migration 20261113082200_init is applied.');

  // ─── Step 3: Load Mock Data (Source of Truth) ───────────────────────────────
  console.log('[INFO] Loading mock data files from src/data/...');
  const { DEMO_USERS } = await import('../../src/data/users.js');
  const { companies } = await import('../../src/data/companies.js');
  const { recruiters } = await import('../../src/data/recruiters.js');
  const { identifiers } = await import('../../src/data/identifiers.js');
  const { reports } = await import('../../src/data/reports.js');
  const { clusters } = await import('../../src/data/clusters.js');
  const { evidence } = await import('../../src/data/evidence.js');
  const { auditLogs } = await import('../../src/data/auditLogs.js');

  console.log(`[INFO] Mock counts: ${DEMO_USERS.length} users, ${companies.length} companies, ${recruiters.length} recruiters, ${identifiers.length} identifiers, ${reports.length} reports, ${clusters.length} clusters, ${evidence.length} evidence, ${auditLogs.length} audit logs.`);

  // Build evidence lookup map: key = `${reportId}|${identifierId}`
  const evidenceMap = new Map();
  for (const ev of evidence) {
    evidenceMap.set(`${ev.reportId}|${ev.identifierId}`, ev);
  }

  // Build identifier lookup map: key = id
  const identifierMap = new Map();
  for (const id of identifiers) {
    identifierMap.set(id.id, id);
  }

  // ─── Step 4: Transaction 1 — Root Entities ──────────────────────────────────
  console.log('[TX 1/5] Upserting root entities (users, companies, recruiters, identifiers, clusters)...');
  try {
    await prisma.$transaction(async (tx) => {
      // 1. Users
      for (const u of DEMO_USERS) {
        const passwordHash = bcrypt.hashSync(u.password, 12);
        await tx.user.upsert({
          where: { id: u.id },
          update: {},
          create: {
            id: u.id,
            name: u.name,
            email: u.email,
            passwordHash,
            role: u.role,
            college: u.college || null,
            isBanned: false,
            createdAt: new Date(u.joinedAt),
            updatedAt: new Date(u.joinedAt),
          },
        });
      }

      // 2. Companies
      for (const c of companies) {
        await tx.company.upsert({
          where: { id: c.id },
          update: {},
          create: {
            id: c.id,
            name: c.name,
            domain: c.domain || null,
            industry: c.industry || null,
            registeredState: c.registeredState || null,
            flagged: Boolean(c.flagged),
            createdAt: new Date(c.createdAt),
          },
        });
      }

      // 3. Recruiters
      for (const r of recruiters) {
        await tx.recruiter.upsert({
          where: { id: r.id },
          update: {},
          create: {
            id: r.id,
            name: r.name,
            phone: r.phone || null,
            email: r.email || null,
            flagged: Boolean(r.flagged),
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
          },
        });
      }

      // 4. Identifiers
      for (const id of identifiers) {
        await tx.identifier.upsert({
          where: {
            type_normalizedValue: {
              type: id.type,
              normalizedValue: id.normalizedValue,
            },
          },
          update: {},
          create: {
            id: id.id,
            type: id.type,
            value: id.value,
            normalizedValue: id.normalizedValue,
            riskScore: id.riskScore,
            flagged: Boolean(id.flagged),
            confidence: id.confidence,
            notes: id.notes || null,
            firstSeen: new Date(id.firstSeen),
            lastSeen: new Date(id.lastSeen),
          },
        });
      }

      // 5. Clusters
      for (const cl of clusters) {
        // Documented mapping: CL005 mock status is "verified", map to "resolved" (ClusterStatus enum)
        const clusterStatus = cl.status === 'verified' ? 'resolved' : cl.status;
        await tx.cluster.upsert({
          where: { id: cl.id },
          update: {},
          create: {
            id: cl.id,
            name: cl.name,
            description: cl.description || null,
            confidence: cl.confidence,
            status: clusterStatus,
            connectionBasis: cl.connectionBasis || null,
            discoveredAt: new Date(cl.discoveredAt),
            updatedAt: new Date(cl.discoveredAt),
          },
        });
      }
    });
    console.log('[TX 1/5] Completed successfully.');
  } catch (err) {
    console.error('[ERROR] Transaction 1 (Root entities) failed:', err.message);
    throw err;
  }

  // ─── Step 5: Transaction 2 — Recruiter-Company Links ────────────────────────
  console.log('[TX 2/5] Upserting recruiter_companies junction rows...');
  try {
    await prisma.$transaction(async (tx) => {
      for (const r of recruiters) {
        if (r.companyId) {
          await tx.recruiterCompany.upsert({
            where: {
              recruiterId_companyId: {
                recruiterId: r.id,
                companyId: r.companyId,
              },
            },
            update: {},
            create: {
              recruiterId: r.id,
              companyId: r.companyId,
            },
          });
        }
      }
    });
    console.log('[TX 2/5] Completed successfully.');
  } catch (err) {
    console.error('[ERROR] Transaction 2 (Recruiter-Companies) failed:', err.message);
    throw err;
  }

  // ─── Step 6: Transaction 3 — Reports ─────────────────────────────────────────
  console.log('[TX 3/5] Upserting reports...');
  try {
    await prisma.$transaction(async (tx) => {
      for (const r of reports) {
        await tx.report.upsert({
          where: { id: r.id },
          update: {},
          create: {
            id: r.id,
            submittedBy: r.submittedBy,
            reviewedBy: r.reviewedBy || null,
            companyId: r.companyId || null,
            recruiterId: r.recruiterId || null,
            companyNameRaw: r.companyName,
            recruiterNameRaw: r.recruiterName || null,
            domainRaw: r.domain || null,
            phoneRaw: r.phone || null,
            emailRaw: r.email || null,
            upiRaw: r.upiId || null,
            offerMessage: r.offerMessage,
            paymentRequest: r.paymentRequest || null,
            additionalNotes: r.additionalInfo || null,
            status: r.status,
            submittedAt: new Date(r.submittedAt),
            reviewedAt: r.reviewedAt ? new Date(r.reviewedAt) : null,
            isVerified: Boolean(r.informationStatus?.isVerified),
            isInferred: Boolean(r.informationStatus?.isInferred),
          },
        });
      }
    });
    console.log('[TX 3/5] Completed successfully.');
  } catch (err) {
    console.error('[ERROR] Transaction 3 (Reports) failed:', err.message);
    throw err;
  }

  // ─── Step 7: Transaction 4 — Report Sub-Entities & Junctions ─────────────────
  console.log('[TX 4/5] Upserting report sub-entities (report_identifiers, risk_assessments, risk_factors, cluster_reports, saved_reports)...');
  try {
    await prisma.$transaction(async (tx) => {
      // 1. Report Identifiers
      for (const r of reports) {
        for (const identifierId of r.identifierIds || []) {
          const ev = evidenceMap.get(`${r.id}|${identifierId}`);
          const idRecord = identifierMap.get(identifierId);

          let confidence = 'medium';
          let matchType = null;
          let matchDescription = null;
          let addedAt = new Date(r.submittedAt);

          if (ev) {
            confidence = ev.confidence;
            matchType = ev.type;
            matchDescription = ev.description;
            addedAt = new Date(ev.createdAt);
          } else if (idRecord) {
            // Non-evidenced pair: use identifier's actual confidence, never fabricate evidence
            confidence = idRecord.confidence;
          }

          await tx.reportIdentifier.upsert({
            where: {
              reportId_identifierId: {
                reportId: r.id,
                identifierId,
              },
            },
            update: {},
            create: {
              reportId: r.id,
              identifierId,
              confidence,
              matchType,
              matchDescription,
              addedBy: null,
              addedAt,
            },
          });
        }
      }

      // 2. Risk Assessments and Risk Factors
      for (const r of reports) {
        const assessmentId = `ra-${r.id.toLowerCase()}`;
        await tx.riskAssessment.upsert({
          where: { id: assessmentId },
          update: {},
          create: {
            id: assessmentId,
            reportId: r.id,
            score: r.riskScore,
            category: r.riskCategory,
            summary: r.title || null,
            disclaimer: null,
            assessedAt: new Date(r.submittedAt),
            assessedBy: 'system',
            isCurrent: true,
            version: 1,
          },
        });

        if (Array.isArray(r.riskFactors)) {
          for (let i = 0; i < r.riskFactors.length; i++) {
            const f = r.riskFactors[i];
            const factorId = `rf-${r.id.toLowerCase()}-${i + 1}`;
            await tx.riskFactor.upsert({
              where: { id: factorId },
              update: {},
              create: {
                id: factorId,
                assessmentId,
                factorKey: f.factor,
                description: f.description,
                weight: f.weight,
                evidenceText: f.evidence || null,
                confidence: f.confidence || 'medium',
                explanation: f.explanation,
              },
            });
          }
        }
      }

      // 3. Cluster Reports
      for (const cl of clusters) {
        for (const reportId of cl.reportIds || []) {
          await tx.clusterReport.upsert({
            where: {
              clusterId_reportId: {
                clusterId: cl.id,
                reportId,
              },
            },
            update: {},
            create: {
              clusterId: cl.id,
              reportId,
            },
          });
        }
      }

      // 4. Saved Reports
      for (const u of DEMO_USERS) {
        for (const reportId of u.savedReports || []) {
          await tx.savedReport.upsert({
            where: {
              userId_reportId: {
                userId: u.id,
                reportId,
              },
            },
            update: {},
            create: {
              userId: u.id,
              reportId,
              savedAt: new Date(u.joinedAt),
            },
          });
        }
      }
    });
    console.log('[TX 4/5] Completed successfully.');
  } catch (err) {
    console.error('[ERROR] Transaction 4 (Report sub-entities) failed:', err.message);
    throw err;
  }

  // ─── Step 8: Transaction 5 — Audit Logs ─────────────────────────────────────
  console.log('[TX 5/5] Upserting audit logs...');
  try {
    await prisma.$transaction(async (tx) => {
      for (const al of auditLogs) {
        await tx.auditLog.upsert({
          where: { id: al.id },
          update: {},
          create: {
            id: al.id,
            actorId: al.userId,
            action: al.action,
            reportId: al.reportId || null,
            identifierId: al.identifierId || null,
            clusterId: al.clusterId || null,
            targetUserId: al.targetUserId || null,
            oldValue: al.oldStatus || al.oldValue || null,
            newValue: al.newStatus || al.newValue || null,
            notes: al.notes || null,
            createdAt: new Date(al.timestamp),
          },
        });
      }
    });
    console.log('[TX 5/5] Completed successfully.');
  } catch (err) {
    console.error('[ERROR] Transaction 5 (Audit logs) failed:', err.message);
    throw err;
  }

  // ─── Step 9: Post-Seed Verification Assertions ───────────────────────────────
  console.log('\n[VERIFICATION] Verifying all table counts and integrity assertions...');

  const counts = {
    users: await prisma.user.count(),
    companies: await prisma.company.count(),
    recruiters: await prisma.recruiter.count(),
    recruiter_companies: await prisma.recruiterCompany.count(),
    reports: await prisma.report.count(),
    identifiers: await prisma.identifier.count(),
    report_identifiers: await prisma.reportIdentifier.count(),
    risk_assessments: await prisma.riskAssessment.count(),
    current_risk_assessments: await prisma.riskAssessment.count({ where: { isCurrent: true } }),
    risk_factors: await prisma.riskFactor.count(),
    clusters: await prisma.cluster.count(),
    cluster_reports: await prisma.clusterReport.count(),
    saved_reports: await prisma.savedReport.count(),
    audit_logs: await prisma.auditLog.count(),
    offer_checks: await prisma.offerCheck.count(),
    refresh_tokens: await prisma.refreshToken.count(),
  };

  const expected = {
    users: 2,
    companies: 20,
    recruiters: 25,
    recruiter_companies: 25,
    reports: 35,
    identifiers: 70,
    report_identifiers: 107,
    risk_assessments: 35,
    current_risk_assessments: 35,
    risk_factors: 92,
    clusters: 7,
    cluster_reports: 22,
    saved_reports: 3,
    audit_logs: 30,
    offer_checks: 0,
    refresh_tokens: 0,
  };

  console.table(
    Object.keys(expected).map((key) => ({
      Table: key,
      Expected: expected[key],
      Actual: counts[key],
      Match: counts[key] === expected[key] ? '✅ PASS' : '❌ FAIL',
    }))
  );

  let hasMismatch = false;
  for (const [key, expVal] of Object.entries(expected)) {
    if (counts[key] !== expVal) {
      console.error(`[VERIFICATION FAIL] Table "${key}": expected ${expVal}, found ${counts[key]}`);
      hasMismatch = true;
    }
  }

  if (hasMismatch) {
    throw new Error('Seed post-verification failed: table count mismatch.');
  }

  console.log('[SUCCESS] All 15 tables match exact expected counts. Phase 3 seeding complete.');
}

main()
  .catch((e) => {
    console.error('[FATAL SEED ERROR]', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
