import { describe, expect, it } from 'vitest';
import { buildCheckoutHandoffUrl } from '../src/lib/handoff.ts';

describe('buildCheckoutHandoffUrl', () => {
  it('builds the convention URL', () => {
    const url = buildCheckoutHandoffUrl(
      'https://checkout.jpl.example/checkout',
      [
        { offerId: 'quiver-devkit-thomas-texas', quantity: 1 },
        { offerId: 'spare-propellers-thomas-texas', quantity: 2 },
      ],
      'ord_01KTSY7M20Q8HFGK7BQB4PEBGX',
    );
    expect(url).toBe(
      'https://checkout.jpl.example/checkout?items=quiver-devkit-thomas-texas%3A1%2Cspare-propellers-thomas-texas%3A2&ref=ord_01KTSY7M20Q8HFGK7BQB4PEBGX',
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get('items')).toBe(
      'quiver-devkit-thomas-texas:1,spare-propellers-thomas-texas:2',
    );
  });

  it('preserves existing query parameters on the base URL', () => {
    const url = new URL(
      buildCheckoutHandoffUrl('https://example.com/checkout?env=test', [{ offerId: 'a', quantity: 1 }], 'r'),
    );
    expect(url.searchParams.get('env')).toBe('test');
    expect(url.searchParams.get('items')).toBe('a:1');
  });
});
