'use strict';

/**
 * backend/src/services/risk.service.js
 * Pure, deterministic, explainable fraud-risk scoring engine for OfferCheck.
 *
 * Implements the approved Phase 5A.2 scoring policy:
 * - Intrinsic Offer Signals (maximum 40 points)
 * - Historical Identifier Evidence (maximum 60 points)
 * - Strict Provenance: Only VERIFIED reports contribute historical points
 * - Deterministic Risk Categories (low, medium, high, critical)
 * - Strict Critical Eligibility Gate:
 *     Numerical score >= 80 AND explicit fee demand detected AND
 *     at least one verified payment identifier (UPI or bank_account) linked to >= 2 verified reports
 * - PII Protection: Explanations never include raw sensitive identifier values
 *
 * Database-independent and pure (no network, no database calls, no randomness).
 */

const { AppError } = require('../utils/errors');

const RISK_POLICY_VERSION = '1.0.0';

// Permitted payment identifier types for the critical eligibility gate
const PAYMENT_IDENTIFIER_TYPES = Object.freeze(['upi', 'bank_account']);

// ─── Regex Patterns for Intrinsic Signals ─────────────────────────────────────
// Uses boundary-aware (\b) and case-insensitive matching to avoid false substrings (e.g. "coffee", "payroll").

// Signal 1: Explicit demand for money, fees, or deposits (+20)
const FEE_DEMAND_REGEX = new RegExp(
  '\\b(?:registration|processing|application|training|orientation|exam|examination|verification|security|laptop|uniform|kit)\\s+(?:fee|fees|deposit|charge|charges|amount|cost)\\b|' +
  '\\b(?:pay|transfer|deposit|send)\\s+(?:an?\\s+)?(?:amount|advance|sum|fee|deposit|money|charge)\\b|' +
  '\\b(?:security|refundable|mandatory|upfront|initial)\\s+(?:deposit|payment|amount|fee|charge)\\b|' +
  '\\bpay\\s+(?:rs\\.?|inr|\\u20B9)\\s*\\d+\\b|' +
  '\\b(?:deposit|transfer|pay)\\s+of\\s+(?:rs\\.?|inr|\\u20B9)?\\s*\\d+\\b|' +
  '\\bcharges?\\s+(?:[a-z0-9]+\\s+){0,3}(?:fee|fees|deposit|charge|charges)\\b',
  'i'
);

// Clause boundary splitter: breaks on punctuation, newlines, and coordinating/contrastive conjunctions
// Ensures negations in one statement (e.g. "We do not charge X") do not suppress genuine demands in another ("but candidates must pay Y")
const CLAUSE_SPLIT_REGEX = /[;:.!?\n]+|\b(?:but|however|yet|although|whereas)\b/i;

// Scoped negation, waiver, and inquiry patterns that invalidate a fee demand in the same clause
const NEGATION_AND_WAIVER_PATTERNS = Object.freeze([
  // Direct negation: "no registration fee", "not any fee", "without fee", "zero fees", "free of charge", "no advance payment"
  /\b(?:no|not|never|neither|without|zero|free\s+of)\s+(?:[a-z0-9]+\s+){0,3}(?:fee|fees|deposit|charge|charges|payment|amount|advance)\b/i,
  // Verb negation: "do not charge", "does not require", "never ask", "won't charge", "we do not charge"
  /\b(?:do\s+not|does\s+not|don't|doesn't|never|did\s+not|didn't|won't|will\s+not)\s+(?:[a-z0-9]+\s+){0,2}(?:charge|ask|demand|require|take|collect|pay)\b/i,
  // Post-predicate waivers: "fee is waived", "deposit has been waived", "payment not required", "fee is optional", "fees are free"
  /\b(?:fee|fees|deposit|charge|charges|payment)\s+(?:has\s+been|is|was|are)?\s*(?:waived|free|not\s+required|optional|refunded)\b/i,
  // Dialogue inquiry patterns: "asked whether a fee was required, and we said no", "inquired if ... said no"
  /\b(?:asked\s+whether|inquired\s+if|asking\s+if)\b.*?\b(?:said\s+no|answered\s+no|replied\s+no|no\s+fee|not\s+required)\b/i,
  /\b(?:asked\s+whether|inquired\s+if|asking\s+if)\b/i,
]);

/**
 * Check if the text contains an un-negated, affirmative demand for payment.
 * Evaluates text clause-by-clause so negations in one clause do not suppress
 * legitimate affirmative demands in another clause.
 *
 * @param {string} text - Offer message or payment request text
 * @returns {boolean} True if at least one clause contains an affirmative demand
 */
function hasAffirmativeFeeDemand(text) {
  if (!text || typeof text !== 'string') return false;

  const clauses = text
    .split(CLAUSE_SPLIT_REGEX)
    .map((c) => c.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    if (FEE_DEMAND_REGEX.test(clause)) {
      const isNegated = NEGATION_AND_WAIVER_PATTERNS.some((pattern) => pattern.test(clause));
      if (!isNegated) {
        return true;
      }
    }
  }

  return false;
}

// Signal 2: Payment instructions or destination details (+10, only if fee demand is present)
const PAYMENT_INSTRUCTIONS_REGEX = new RegExp(
  '\\b(?:bank\\s+transfer|neft|rtgs|imps|account\\s+number|account\\s+no\\.?|a\\/c\\s+no\\.?|ifsc(?:\\s+code)?)\\b|' +
  '\\b(?:google\\s*pay|gpay|phonepe|paytm|bhim\\s*(?:upi)?|upi\\s*(?:id|handle)?|qr\\s*code|payment\\s*link)\\b|' +
  '\\b[a-zA-Z0-9.\\-_]{2,100}@[a-zA-Z]{2,64}\\b',
  'i'
);

// Signal 3: Coercive urgency or pressure tactics (+5)
const URGENCY_PRESSURE_REGEX = new RegExp(
  '\\b(?:seats?\\s+filling\\s+(?:fast|soon)|limited\\s+(?:seats?|openings?|slots?|vacanc(?:y|ies)))\\b|' +
  '\\b(?:confirm|pay|register|reserve)\\s+(?:within|in)\\s+(?:\\d+\\s*(?:hours?|hrs?|mins?|minutes?)|today|immediately)\\b|' +
  '\\b(?:urgent|immediate)\\s+(?:requirement|joining|hiring|selection|payment)\\b|' +
  '\\b(?:last\\s+date|offer\\s+expires|valid\\s+only)\\s+(?:today|in\\s+\\d+\\s*hours?)\\b|' +
  '\\b(?:act\\s+fast|hurry\\s+up|before\\s+seats?\\s+(?:are\\s+)?full)\\b',
  'i'
);

// Signal 4: Unrealistic employment or salary guarantees (+5)
const UNREALISTIC_GUARANTEE_REGEX = new RegExp(
  '\\b(?:100%\\s*(?:job|placement|selection|guarantee|guaranteed))\\b|' +
  '\\b(?:guaranteed\\s+(?:job|placement|selection|internship|hiring|income))\\b|' +
  '\\b(?:direct\\s+(?:selection|joining|hiring))\\s+(?:without\\s+(?:any\\s+)?interview|no\\s+interview)\\b|' +
  '\\b(?:no\\s+interview\\s*(?:required|needed))\\b|' +
  '\\b(?:earn\\s+(?:daily|weekly)\\s+(?:rs\\.?|inr|\\u20B9|\\$)?\\s*\\d+)\\b|' +
  '\\b(?:without\\s+any\\s+(?:interview|test|exam|screening))\\b',
  'i'
);

/**
 * Evaluate intrinsic offer signals based on message text and payment request details.
 * Accepts either separate arguments `(text, explicitPaymentRequest)` or an options object `{ offerMessage, paymentRequest }`.
 * Maximum score: 40 points.
 *
 * @param {string|object} textOrInput - Combined offer message text or options object
 * @param {string} [explicitPaymentRequest] - Optional dedicated payment request field
 * @returns {{ score: number, factors: Array<object>, hasFeeDemand: boolean }}
 */
function evaluateIntrinsicSignals(textOrInput = '', explicitPaymentRequest = '') {
  let text = '';
  let paymentReq = '';
  if (textOrInput && typeof textOrInput === 'object' && !Array.isArray(textOrInput)) {
    text = typeof textOrInput.offerMessage === 'string' ? textOrInput.offerMessage : '';
    paymentReq = typeof textOrInput.paymentRequest === 'string' ? textOrInput.paymentRequest : '';
  } else {
    text = typeof textOrInput === 'string' ? textOrInput : '';
    paymentReq = typeof explicitPaymentRequest === 'string' ? explicitPaymentRequest : '';
  }

  let score = 0;
  const factors = [];

  const combinedText = [text, paymentReq].filter(Boolean).join(' ');

  // Signal 1: Explicit Fee / Payment Demand (+20)
  // Conservative affirmative detection: verifies that either explicitPaymentRequest (un-negated) or offer text contains an un-negated fee demand
  const hasExplicitDemandInField = Boolean(
    paymentReq &&
      paymentReq.trim().length > 0 &&
      !/^\s*(?:none|no|zero|nil|n\/?a|not\s+applicable|no\s+fee|free)\s*$/i.test(paymentReq) &&
      (hasAffirmativeFeeDemand(paymentReq) || /\d+/.test(paymentReq))
  );
  const hasFeeDemandInText = hasAffirmativeFeeDemand(text);
  const hasFeeDemand = hasExplicitDemandInField || hasFeeDemandInText;

  if (hasFeeDemand) {
    score += 20;
    factors.push({
      factorKey: 'INTRINSIC_FEE_DEMAND',
      description: 'Explicit payment or fee demanded',
      weight: 20,
      evidenceCategory: 'intrinsic',
      confidence: 'high',
      provenance: 'offer_text_analysis',
      explanation:
        'The offer demands an upfront fee, registration charge, training cost, or security deposit. Legitimate employers never charge candidates for job or internship placement.',
    });
  }

  // Signal 2: Payment Instructions Accompanying Demand (+10)
  // Per specification: Payment instructions ALONE do not imply fraud and only contribute points when accompanying an explicit demand.
  if (hasFeeDemand && PAYMENT_INSTRUCTIONS_REGEX.test(combinedText)) {
    score += 10;
    factors.push({
      factorKey: 'INTRINSIC_PAYMENT_INSTRUCTIONS',
      description: 'Payment instructions accompany fee demand',
      weight: 10,
      evidenceCategory: 'intrinsic',
      confidence: 'high',
      provenance: 'offer_text_analysis',
      explanation:
        'The offer specifies concrete payment instructions (such as UPI handle, bank account, or payment app details) to fulfill the demanded payment.',
    });
  }

  // Signal 3: Coercive Urgency or Pressure Tactics (+5)
  if (URGENCY_PRESSURE_REGEX.test(combinedText)) {
    score += 5;
    factors.push({
      factorKey: 'INTRINSIC_COERCIVE_URGENCY',
      description: 'Artificial urgency or pressure tactics detected',
      weight: 5,
      evidenceCategory: 'intrinsic',
      confidence: 'medium',
      provenance: 'offer_text_analysis',
      explanation:
        'The offer uses high-pressure language (such as seats filling fast, immediate payment deadline) to urge candidates to act before verifying authenticity.',
    });
  }

  // Signal 4: Unrealistic Employment or Salary Guarantees (+5)
  if (UNREALISTIC_GUARANTEE_REGEX.test(combinedText)) {
    score += 5;
    factors.push({
      factorKey: 'INTRINSIC_UNREALISTIC_GUARANTEE',
      description: 'Unrealistic employment or salary guarantee detected',
      weight: 5,
      evidenceCategory: 'intrinsic',
      confidence: 'medium',
      provenance: 'offer_text_analysis',
      explanation:
        'The offer claims guaranteed placement, 100% selection, or direct hiring without standard interviews. Legitimate employers evaluate candidates prior to job offers.',
    });
  }

  return {
    score: Math.min(40, score),
    factors,
    hasFeeDemand,
  };
}

/**
 * Evaluate historical identifier evidence from cross-referenced database intelligence.
 * Maximum score: 60 points.
 *
 * Rules:
 * - Only VERIFIED reports contribute points. Pending, investigating, and rejected contribute 0.
 * - Deduplicate report IDs per identifier.
 * - Deduplicate identifiers by composite key (type, normalizedValue).
 * - Strongest single verified identifier:
 *     1 verified report: +15
 *     2 verified reports: +25
 *     3+ verified reports: +35
 * - Additional corroboration across distinct verified identifiers:
 *     2 distinct verified identifiers: +10
 *     3+ distinct verified identifiers: +25
 * - Max historical contribution capped at 60.
 *
 * @param {Array<object>} historicalMatches - Matched identifier groups or flat match items
 * @returns {{
 *   score: number,
 *   factors: Array<object>,
 *   verifiedIdentifiersCount: number,
 *   maxVerifiedReportsPerIdentifier: number,
 *   hasVerifiedPaymentIdentifierWithMin2Reports: boolean
 * }}
 */
function evaluateHistoricalEvidence(historicalMatches) {
  if (!historicalMatches || !Array.isArray(historicalMatches) || historicalMatches.length === 0) {
    return {
      score: 0,
      factors: [],
      verifiedIdentifiersCount: 0,
      maxVerifiedReportsPerIdentifier: 0,
      hasVerifiedPaymentIdentifierWithMin2Reports: false,
    };
  }

  // Map: identifierKey (type:normalizedValue) -> Set of distinct verified report IDs
  const identifierMap = new Map();
  // Map: identifierKey -> identifierType
  const typeMap = new Map();

  for (const item of historicalMatches) {
    if (!item || typeof item !== 'object') {
      throw new AppError('Malformed item in historicalMatches: each entry must be an object', 400);
    }

    const type = (item.type || item.identifierType || '').trim().toLowerCase();
    const val = (item.normalizedValue || item.value || item.identifierValue || '').trim().toLowerCase();

    if (!type || !val) {
      throw new AppError('Malformed item in historicalMatches: type and normalizedValue are required', 400);
    }

    const idKey = `${type}:${val}`;
    if (!identifierMap.has(idKey)) {
      identifierMap.set(idKey, new Set());
      typeMap.set(idKey, type);
    }

    const reportSet = identifierMap.get(idKey);

    // Case 1: Item contains an array of linked reports
    if (Array.isArray(item.reports)) {
      for (const rep of item.reports) {
        if (rep && typeof rep === 'object') {
          const status = (rep.status || '').trim().toLowerCase();
          const repId = rep.id || rep.reportId;
          // Strictly only VERIFIED reports contribute
          if (status === 'verified' && repId) {
            reportSet.add(String(repId).trim());
          }
        }
      }
    }

    // Case 2: Flat item representing a single match link
    const flatStatus = (item.status || item.reportStatus || '').trim().toLowerCase();
    const flatRepId = item.reportId || item.id;
    if (flatStatus === 'verified' && flatRepId) {
      reportSet.add(String(flatRepId).trim());
    }
  }

  // Filter to identifiers that have at least 1 verified report
  const verifiedIdentifiers = [];
  let hasVerifiedPaymentIdentifierWithMin2Reports = false;

  for (const [idKey, reportSet] of identifierMap.entries()) {
    const verifiedCount = reportSet.size;
    if (verifiedCount > 0) {
      const type = typeMap.get(idKey);
      verifiedIdentifiers.push({
        type,
        verifiedCount,
      });

      if (PAYMENT_IDENTIFIER_TYPES.includes(type) && verifiedCount >= 2) {
        hasVerifiedPaymentIdentifierWithMin2Reports = true;
      }
    }
  }

  const verifiedIdentifiersCount = verifiedIdentifiers.length;
  if (verifiedIdentifiersCount === 0) {
    return {
      score: 0,
      factors: [],
      verifiedIdentifiersCount: 0,
      maxVerifiedReportsPerIdentifier: 0,
      hasVerifiedPaymentIdentifierWithMin2Reports: false,
    };
  }

  // Find strongest single identifier (maximum verified reports)
  const maxVerifiedReports = Math.max(...verifiedIdentifiers.map((v) => v.verifiedCount));
  const factors = [];

  // Strongest individual identifier scoring
  let strongestPoints = 0;
  if (maxVerifiedReports >= 3) {
    strongestPoints = 35;
    factors.push({
      factorKey: 'HISTORICAL_STRONG_REUSE',
      description: 'Contact identifier matched in 3 or more verified fraud reports',
      weight: 35,
      evidenceCategory: 'historical',
      confidence: 'high',
      provenance: 'verified_report_cross_reference',
      explanation:
        'A contact identifier in this offer has been confirmed in 3 or more independent, verified fraud investigations.',
    });
  } else if (maxVerifiedReports === 2) {
    strongestPoints = 25;
    factors.push({
      factorKey: 'HISTORICAL_MODERATE_REUSE',
      description: 'Contact identifier matched in 2 verified fraud reports',
      weight: 25,
      evidenceCategory: 'historical',
      confidence: 'high',
      provenance: 'verified_report_cross_reference',
      explanation:
        'A contact identifier in this offer has been confirmed in 2 independent, verified fraud investigations.',
    });
  } else if (maxVerifiedReports === 1) {
    strongestPoints = 15;
    factors.push({
      factorKey: 'HISTORICAL_PRIOR_MATCH',
      description: 'Contact identifier matched in 1 verified fraud report',
      weight: 15,
      evidenceCategory: 'historical',
      confidence: 'medium',
      provenance: 'verified_report_cross_reference',
      explanation:
        'A contact identifier in this offer matches 1 previously verified fraud investigation.',
    });
  }

  // Corroboration scoring across distinct verified identifiers
  let corroborationPoints = 0;
  if (verifiedIdentifiersCount >= 3) {
    corroborationPoints = 25;
    factors.push({
      factorKey: 'HISTORICAL_MULTI_IDENTIFIER_STRONG',
      description: 'Corroboration across 3 or more distinct verified identifiers',
      weight: 25,
      evidenceCategory: 'historical',
      confidence: 'high',
      provenance: 'verified_report_cross_reference',
      explanation:
        'Three or more distinct contact identifiers (e.g. phone, email, domain, or payment handle) each independently match verified fraud reports, indicating organized fraud infrastructure.',
    });
  } else if (verifiedIdentifiersCount === 2) {
    corroborationPoints = 10;
    factors.push({
      factorKey: 'HISTORICAL_MULTI_IDENTIFIER_MODERATE',
      description: 'Corroboration across 2 distinct verified identifiers',
      weight: 10,
      evidenceCategory: 'historical',
      confidence: 'high',
      provenance: 'verified_report_cross_reference',
      explanation:
        'Two distinct contact identifiers each independently match verified fraud reports, confirming multi-point historical fraud corroboration.',
    });
  }

  const rawHistoricalScore = strongestPoints + corroborationPoints;
  const cappedHistoricalScore = Math.min(60, rawHistoricalScore);

  return {
    score: cappedHistoricalScore,
    factors,
    verifiedIdentifiersCount,
    maxVerifiedReportsPerIdentifier: maxVerifiedReports,
    hasVerifiedPaymentIdentifierWithMin2Reports,
  };
}

/**
 * Determine risk level and category based on combined score and strict critical eligibility gates.
 *
 * @param {number} totalScore - Combined score (0-100)
 * @param {boolean} hasFeeDemand - Explicit fee demand detected
 * @param {boolean} hasVerifiedPaymentIdentifierWithMin2Reports - Payment identifier verified in >= 2 reports
 * @returns {{ riskCategory: 'low'|'medium'|'high'|'critical', riskLevel: 'LOW'|'MEDIUM'|'HIGH'|'CRITICAL' }}
 */
function determineRiskCategory(totalScore, hasFeeDemand, hasVerifiedPaymentIdentifierWithMin2Reports) {
  // Critical Gate: Score >= 80 AND explicit fee demand AND verified payment handle in >= 2 verified reports
  if (totalScore >= 80) {
    const isCriticalEligible = hasFeeDemand && hasVerifiedPaymentIdentifierWithMin2Reports;
    if (isCriticalEligible) {
      return { riskCategory: 'critical', riskLevel: 'CRITICAL' };
    }
    // Downgrade to high if critical eligibility criteria are not met
    return { riskCategory: 'high', riskLevel: 'HIGH' };
  }

  if (totalScore >= 60) {
    return { riskCategory: 'high', riskLevel: 'HIGH' };
  }

  if (totalScore >= 35) {
    return { riskCategory: 'medium', riskLevel: 'MEDIUM' };
  }

  return { riskCategory: 'low', riskLevel: 'LOW' };
}

/**
 * Generate human-readable summary text for an assessment.
 *
 * @param {'low'|'medium'|'high'|'critical'} category
 * @returns {string}
 */
function generateSummary(category) {
  switch (category) {
    case 'critical':
      return 'Critical risk: confirmed fee demands matching verified fraudulent payment infrastructure. Extreme caution advised.';
    case 'high':
      return 'High risk: strong fraud indicators or multiple verified fraud reports detected. Independent verification strongly recommended.';
    case 'medium':
      return 'Medium risk: concerning offer terms, fee demands, or corroborated suspicious patterns noted. Exercise caution.';
    case 'low':
    default:
      return 'Low risk: limited suspicious signals detected. This does not confirm legitimacy; always verify independently.';
  }
}

/**
 * Calculate a pure, deterministic, explainable risk assessment.
 *
 * @param {object} input
 * @param {string} [input.offerMessage] - Full text of the job or internship offer
 * @param {string} [input.paymentRequest] - Optional explicit fee request description
 * @param {Array<object>} [input.identifiers] - Extracted or submitted identifiers
 * @param {Array<object>} [input.historicalMatches] - Matches against historical intelligence
 * @returns {object} Assessment result
 */
function calculateRiskAssessment(input = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError('Assessment input must be a non-null object', 400);
  }

  const offerMessage = typeof input.offerMessage === 'string' ? input.offerMessage : '';
  const paymentRequest = typeof input.paymentRequest === 'string' ? input.paymentRequest : '';
  const historicalMatches = Array.isArray(input.historicalMatches) ? input.historicalMatches : [];

  if (input.historicalMatches !== undefined && !Array.isArray(input.historicalMatches)) {
    throw new AppError('historicalMatches must be an array when provided', 400);
  }

  // 1. Evaluate Intrinsic Signals (0-40)
  const intrinsic = evaluateIntrinsicSignals(offerMessage, paymentRequest);

  // 2. Evaluate Historical Evidence (0-60)
  const historical = evaluateHistoricalEvidence(historicalMatches);

  // 3. Combined Numerical Score (0-100)
  const combinedScore = Math.min(100, Math.max(0, intrinsic.score + historical.score));

  // 4. Determine Category & Level with Critical Gate
  const { riskCategory, riskLevel } = determineRiskCategory(
    combinedScore,
    intrinsic.hasFeeDemand,
    historical.hasVerifiedPaymentIdentifierWithMin2Reports
  );

  const factors = [...intrinsic.factors, ...historical.factors];

  return {
    score: combinedScore,
    riskCategory,
    riskLevel,
    intrinsicScore: intrinsic.score,
    historicalScore: historical.score,
    policyVersion: RISK_POLICY_VERSION,
    summary: generateSummary(riskCategory),
    disclaimer:
      'Risk scores are indicators based on pattern matching and historical community reports. They are not legal determinations. A low score does not guarantee legitimacy.',
    factors,
    metadata: {
      hasExplicitFeeDemand: intrinsic.hasFeeDemand,
      verifiedIdentifiersCount: historical.verifiedIdentifiersCount,
      maxVerifiedReportsPerIdentifier: historical.maxVerifiedReportsPerIdentifier,
      hasVerifiedPaymentIdentifierWithMin2Reports: historical.hasVerifiedPaymentIdentifierWithMin2Reports,
      criticalEligible: intrinsic.hasFeeDemand && historical.hasVerifiedPaymentIdentifierWithMin2Reports,
    },
  };
}

module.exports = {
  RISK_POLICY_VERSION,
  PAYMENT_IDENTIFIER_TYPES,
  calculateRiskAssessment,
  evaluateIntrinsicSignals,
  evaluateHistoricalEvidence,
  hasAffirmativeFeeDemand,
};
