import type { Offer } from '@/types';

export interface OfferLeadProfile {
  category?: string | null;
  interest?: string | null;
  city?: string | null;
  budget?: number | null;
}

export interface OfferMatch {
  offer: Offer;
  score: number;
  reasons: string[];
}

interface OfferRules {
  min_budget?: number;
  max_budget?: number;
  city?: string[];
}

export function matchOffers({
  offers,
  lead,
}: {
  offers: Offer[];
  lead: OfferLeadProfile;
}): OfferMatch[] {
  return offers
    .filter((offer) => offer.is_active)
    .map((offer) => scoreOffer(offer, lead))
    .filter((match): match is OfferMatch => Boolean(match))
    .sort((a, b) => b.score - a.score);
}

function scoreOffer(offer: Offer, lead: OfferLeadProfile): OfferMatch | null {
  const rules = normalizeRules(offer.rules);
  const leadCategory = normalize(lead.category);
  const leadInterest = normalize(lead.interest);
  const leadCity = normalize(lead.city);
  const offerCategory = normalize(offer.category);
  const minBudget = minimumBudgetFor(offer, rules);

  if (leadCategory && offerCategory !== leadCategory) return null;

  if (
    rules.city &&
    rules.city.length > 0 &&
    (!leadCity || !rules.city.map(normalize).includes(leadCity))
  ) {
    return null;
  }

  if (minBudget && (!lead.budget || lead.budget < minBudget)) {
    return null;
  }

  if (rules.max_budget && lead.budget && lead.budget > rules.max_budget) {
    return null;
  }

  let score = 0;
  const reasons: string[] = [];

  if (leadCategory) {
    score += 30;
    reasons.push('Category match');
  }

  if (leadInterest) {
    const searchable = [
      offer.name,
      offer.category,
      offer.provider,
      ...offer.benefits,
    ]
      .map(normalize)
      .join(' ');

    if (!containsInterest(searchable, leadInterest)) return null;

    score += 30;
    reasons.push('Interest match');
  }

  if (leadCity && rules.city?.map(normalize).includes(leadCity)) {
    score += 20;
    reasons.push(`Available in ${lead.city}`);
  }

  if (minBudget && lead.budget) {
    score += 10;
    reasons.push('Budget eligible');
  }

  score += Math.min(20, Math.round(offer.commission_value / 100));

  return score > 0 ? { offer, score, reasons } : null;
}

function minimumBudgetFor(offer: Offer, rules: OfferRules): number | undefined {
  const annualFee = offer.metadata.annual_fee;
  if (
    normalize(offer.category) === 'credit_card' &&
    typeof annualFee === 'number'
  ) {
    return annualFee;
  }

  return rules.min_budget;
}

function containsInterest(searchable: string, interest: string): boolean {
  const tokens = interest.split(/\s+/).filter((token) => token.length > 2);
  return tokens.some((token) => searchable.includes(token));
}

function normalizeRules(value: Record<string, unknown>): OfferRules {
  return {
    min_budget:
      typeof value.min_budget === 'number' ? value.min_budget : undefined,
    max_budget:
      typeof value.max_budget === 'number' ? value.max_budget : undefined,
    city: Array.isArray(value.city)
      ? value.city.filter((row): row is string => typeof row === 'string')
      : undefined,
  };
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}
