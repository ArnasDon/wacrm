import { describe, expect, it } from 'vitest';
import type { Offer } from '@/types';
import { matchOffers } from './offers';

function offer(overrides: Partial<Offer>): Offer {
  return {
    id: 'offer-1',
    user_id: 'user-1',
    name: 'Starter Website Package',
    category: 'local_service',
    provider: 'Acme Studio',
    price_amount: 15000,
    fee_amount: 0,
    commission_value: 1200,
    benefits: ['website', 'booking'],
    rules: { city: ['mumbai', 'delhi'], min_budget: 10000 },
    requirements: ['Business name'],
    metadata: {},
    is_active: true,
    created_at: '2026-05-21T00:00:00.000Z',
    updated_at: '2026-05-21T00:00:00.000Z',
    ...overrides,
  };
}

describe('offer matching', () => {
  it('matches by category, interest, location, and budget', () => {
    const matches = matchOffers({
      offers: [
        offer({ id: 'inactive', is_active: false }),
        offer({
          id: 'card',
          category: 'credit_card',
          benefits: ['cashback'],
          metadata: { annual_fee: 499 },
        }),
        offer({
          id: 'service',
          category: 'local_service',
          benefits: ['website', 'booking'],
          commission_value: 2500,
        }),
      ],
      lead: {
        category: 'local_service',
        interest: 'website booking package',
        city: 'Mumbai',
        budget: 20000,
      },
    });

    expect(matches.map((match) => match.offer.id)).toEqual(['service']);
    expect(matches[0].reasons).toContain('Category match');
  });

  it('keeps credit-card details in metadata instead of the base catalog shape', () => {
    const matches = matchOffers({
      offers: [
        offer({
          id: 'cashback-card',
          category: 'credit_card',
          benefits: ['cashback'],
          metadata: { annual_fee: 999, network: 'Visa' },
        }),
      ],
      lead: {
        category: 'credit_card',
        interest: 'cashback card',
        city: 'Delhi',
        budget: 1000,
      },
    });

    expect(matches[0].offer.metadata).toEqual({
      annual_fee: 999,
      network: 'Visa',
    });
  });

  it('rejects offers when required budget or city rules fail', () => {
    const matches = matchOffers({
      offers: [
        offer({
          id: 'premium-service',
          rules: { min_budget: 100000, city: ['bengaluru'] },
        }),
      ],
      lead: {
        interest: 'website',
        city: 'Delhi',
        budget: 20000,
      },
    });

    expect(matches).toEqual([]);
  });
});
