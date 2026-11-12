export const getRiskCategory = (score) => {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
};

export const calculateRiskScore = (formData, matchedIdentifiers, connectedReports) => {
  let score = 0;
  const factors = [];

  const upiMatches = matchedIdentifiers.filter(id => id.type === 'upi');
  upiMatches.forEach(upi => {
    if (upi.reportIds.length >= 3) {
      score += 35;
      factors.push({
        factor: 'shared_upi_critical',
        description: `UPI ${upi.value} found in ${upi.reportIds.length} previous reports`,
        weight: 35,
        evidence: `Cross-referenced with ${upi.reportIds.join(', ')}`,
        confidence: 'high',
        explanation: 'The same UPI handle appearing in three or more reports is a strong indicator of an organised fraud network reusing a single payment collection channel across multiple victims.',
        severity: 'critical',
      });
    } else if (upi.reportIds.length >= 1) {
      score += 20;
      factors.push({
        factor: 'shared_upi',
        description: `UPI ${upi.value} found in a previous report`,
        weight: 20,
        evidence: `Cross-referenced with ${upi.reportIds.join(', ')}`,
        confidence: upi.reportIds.length >= 2 ? 'medium' : 'low',
        explanation: 'A UPI ID that has appeared in at least one previous fraud report warrants caution, even if the pattern has not yet been fully confirmed.',
        severity: 'high',
      });
    }
  });

  const phoneMatches = matchedIdentifiers.filter(id => id.type === 'phone');
  phoneMatches.forEach(phone => {
    if (phone.reportIds.length >= 2) {
      score += 25;
      factors.push({
        factor: 'shared_phone_multiple',
        description: `Phone ${phone.value} used in ${phone.reportIds.length} reports`,
        weight: 25,
        evidence: `Same phone reused across different companies`,
        confidence: 'high',
        explanation: 'A single mobile number being used by recruiters claiming to represent different companies strongly suggests a single actor behind multiple fraudulent offers.',
        severity: 'high',
      });
    } else {
      score += 15;
      factors.push({
        factor: 'shared_phone',
        description: `Phone ${phone.value} found in a previous report`,
        weight: 15,
        evidence: `Cross-referenced with ${phone.reportIds.join(', ')}`,
        confidence: 'medium',
        explanation: 'This phone number has appeared in at least one previous report. The risk depends on the nature of that report.',
        severity: 'medium',
      });
    }
  });

  const emailMatches = matchedIdentifiers.filter(id => id.type === 'email');
  emailMatches.forEach(email => {
    const isFreeEmail = /gmail|yahoo|hotmail|outlook/i.test(email.value);
    if (email.reportIds.length >= 2) {
      score += 20;
      factors.push({
        factor: 'shared_email_multiple',
        description: `Email ${email.value} used in ${email.reportIds.length} reports`,
        weight: 20,
        evidence: `Reused across different companies`,
        confidence: 'high',
        explanation: 'The same email address being used by multiple companies in separate fraud reports indicates a shared fraud infrastructure.',
        severity: 'high',
      });
    } else {
      score += 10;
      factors.push({
        factor: 'shared_email',
        description: `Email found in a previous report`,
        weight: 10,
        evidence: `Cross-referenced with ${email.reportIds.join(', ')}`,
        confidence: 'medium',
        explanation: 'This email address has appeared in at least one previous report. Exercise caution.',
        severity: 'medium',
      });
    }
    if (isFreeEmail && formData.companyName) {
      score += 5;
      factors.push({
        factor: 'free_email_corporate',
        description: 'Free email provider used for corporate contact',
        weight: 5,
        evidence: `${email.value} uses a free provider instead of a company domain`,
        confidence: 'low',
        explanation: 'Legitimate companies typically use their own domain for email (e.g. name@company.com). Using Gmail, Yahoo or similar free providers for corporate HR contact is unusual.',
        severity: 'low',
      });
    }
  });

  const domainMatches = matchedIdentifiers.filter(id => id.type === 'domain');
  domainMatches.forEach(domain => {
    if (domain.reportIds.length >= 2) {
      score += 15;
      factors.push({
        factor: 'shared_domain',
        description: `Domain ${domain.value} appears in ${domain.reportIds.length} reports`,
        weight: 15,
        evidence: `Domain linked to multiple reports`,
        confidence: 'high',
        explanation: 'A domain that features across multiple fraud reports is likely part of a persistent fraudulent infrastructure.',
        severity: 'high',
      });
    }
  });

  if (formData.paymentRequest && formData.paymentRequest.trim().length > 0) {
    score += 20;
    factors.push({
      factor: 'payment_requested',
      description: 'Upfront payment or fee requested',
      weight: 20,
      evidence: formData.paymentRequest,
      confidence: 'high',
      explanation: 'Legitimate employers do not ask candidates to pay fees, deposits or registration amounts before employment begins. Any such request is a significant warning sign.',
      severity: 'high',
    });
  }

  if (formData.upiId && upiMatches.length === 0) {
    score += 10;
    factors.push({
      factor: 'upi_present_unmatched',
      description: 'UPI ID provided but not found in database',
      weight: 10,
      evidence: `${formData.upiId} has not been seen in previous reports`,
      confidence: 'low',
      explanation: 'A UPI ID was submitted but does not match any previously reported identifier. This is a low-level signal — the absence of a match does not mean the offer is safe.',
      severity: 'medium',
    });
  }

  if (formData.offerMessage) {
    const msg = formData.offerMessage.toLowerCase();
    if (/congratulation|selected|confirm.*seat|limited.*seat|seats filling/i.test(msg)) {
      score += 8;
      factors.push({
        factor: 'urgency_language',
        description: 'Urgency and congratulatory language patterns detected',
        weight: 8,
        evidence: 'Phrases such as "congratulations", "confirm your seat", or "seats filling fast" were detected',
        confidence: 'medium',
        explanation: 'Fraudsters often use congratulatory and scarcity language to create emotional pressure, encouraging victims to pay quickly before they can verify the legitimacy of the offer.',
        severity: 'low',
      });
    }
    if (/register|registration|fee|deposit|advance|security|license|kit|verification charge/i.test(msg)) {
      score += 10;
      factors.push({
        factor: 'fee_language',
        description: 'Fee-related language detected in offer message',
        weight: 10,
        evidence: 'Terms such as "fee", "deposit", "registration", "security", or "charge" were detected',
        confidence: 'medium',
        explanation: 'The offer message contains language associated with fraudulent fee requests. Legitimate internship and job offers do not require candidates to pay anything.',
        severity: 'medium',
      });
    }
  }

  score = Math.min(score, 100);
  const category = getRiskCategory(score);

  const summaries = {
    critical: 'Multiple strong fraud signals detected across shared identifiers and payment requests. Exercise significant caution — this offer shares characteristics with confirmed fraud reports.',
    high: 'Several suspicious indicators found. This offer shares identifiers or patterns with previous reports. We recommend verifying independently before taking any action.',
    medium: 'Some concerning patterns noted. While not conclusive, the offer contains elements that warrant careful scrutiny.',
    low: 'Limited suspicious signals detected. No strong matches found in our database. This does not confirm the offer is legitimate — always verify independently.',
  };

  return {
    score,
    factors,
    category,
    connectedCount: connectedReports.length,
    summary: summaries[category],
    disclaimer: 'Risk scores are based on user-submitted reports and pattern matching against a database of reported fraud indicators. They are indicators only, not legal determinations. Reported information has not been independently verified. A low score does not confirm an offer is genuine.',
  };
};

