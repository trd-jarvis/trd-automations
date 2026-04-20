import type { ActionBucket, LeadRecord, RawFinding, SignalFinding, SignalRuleSet } from "../types.js";

function normalizeText(value: string): string {
  return value.toLowerCase();
}

function includesKeyword(text: string, keyword: string): boolean {
  return normalizeText(text).includes(keyword.toLowerCase());
}

function baseScore(finding: RawFinding): number {
  let score = 10;
  if (finding.rank && finding.rank > 0) {
    score += Math.max(0, 20 - finding.rank);
  }
  if (finding.rating && finding.rating > 0) {
    score += Math.round(finding.rating * 4);
  }
  return score;
}

export function scoreFindingWithRule(finding: RawFinding, rules: SignalRuleSet): { score: number; reasons: string[] } {
  const haystack = [finding.title, finding.snippet, finding.url].filter(Boolean).join(" ").toLowerCase();
  const reasons: string[] = [];
  let score = baseScore(finding);

  for (const keyword of rules.requiredKeywords) {
    if (includesKeyword(haystack, keyword)) {
      score += 12;
      reasons.push(`matched required keyword "${keyword}"`);
    }
  }

  for (const keyword of rules.boostKeywords) {
    if (includesKeyword(haystack, keyword)) {
      score += 6;
      reasons.push(`matched boost keyword "${keyword}"`);
    }
  }

  for (const keyword of rules.blockedKeywords) {
    if (includesKeyword(haystack, keyword)) {
      score -= 18;
      reasons.push(`matched blocked keyword "${keyword}"`);
    }
  }

  return { score, reasons };
}

function pickActionBucket(sentiment: SignalFinding["sentiment"]): ActionBucket {
  if (sentiment === "POSITIVE") return "REPORT";
  if (sentiment === "NEGATIVE") return "OPTIMIZE";
  return "WATCH";
}

export function splitSignals(finding: RawFinding, positiveRules: SignalRuleSet, negativeRules: SignalRuleSet): SignalFinding {
  const positive = scoreFindingWithRule(finding, positiveRules);
  const negative = scoreFindingWithRule(finding, negativeRules);

  let sentiment: SignalFinding["sentiment"] = "NEUTRAL";
  let score = Math.max(positive.score, negative.score);
  let reasons = positive.reasons.length >= negative.reasons.length ? positive.reasons : negative.reasons;

  if (positive.score >= positiveRules.minimumScore && positive.score >= negative.score) {
    sentiment = "POSITIVE";
    score = positive.score;
    reasons = positive.reasons;
  } else if (negative.score >= negativeRules.minimumScore) {
    sentiment = "NEGATIVE";
    score = negative.score;
    reasons = negative.reasons;
  }

  return {
    ...finding,
    sentiment,
    score,
    reasons,
    actionBucket: pickActionBucket(sentiment)
  };
}

export function computeLeadScores(lead: LeadRecord): LeadRecord {
  const weaknessBonus = Math.min(40, lead.weaknessSignals.length * 8);
  const reviewPenalty = lead.reviewCount && lead.reviewCount > 80 ? 8 : 0;
  const ratingPenalty = lead.rating && lead.rating >= 4.4 ? 12 : 0;
  const baseQualification = 40 + weaknessBonus - reviewPenalty - ratingPenalty;
  const recommendedChannel = lead.phone ? "voice" : lead.email ? "email" : "sms";

  return {
    ...lead,
    qualificationScore: Math.max(0, Math.min(100, baseQualification)),
    recommendedChannel,
    status: "APPROVAL_PENDING",
    updatedAt: new Date().toISOString()
  };
}
