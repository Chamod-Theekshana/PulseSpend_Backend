import { describe, it, expect } from 'vitest';
import { parseSender } from './mailer';

describe('parseSender', () => {
  it('parses the RFC form `Name <email>`', () => {
    expect(parseSender('PulseSpend <you@example.com>')).toEqual({
      name: 'PulseSpend',
      email: 'you@example.com',
    });
  });

  it('parses a bare address', () => {
    expect(parseSender('you@example.com')).toEqual({ name: undefined, email: 'you@example.com' });
  });

  it('parses the bracket-less `Name email` form nodemailer tolerated', () => {
    // This is what the real .env had — Brevo 400s on it unless we extract.
    expect(parseSender('PulseSpend japansamurai1234@gmail.com')).toEqual({
      name: 'PulseSpend',
      email: 'japansamurai1234@gmail.com',
    });
  });

  it('strips surrounding quotes (dashboard paste mistake)', () => {
    expect(parseSender('"PulseSpend <you@example.com>"')).toEqual({
      name: 'PulseSpend',
      email: 'you@example.com',
    });
  });

  it('tolerates extra whitespace', () => {
    expect(parseSender('  PulseSpend   <  you@example.com  >  ')).toEqual({
      name: 'PulseSpend',
      email: 'you@example.com',
    });
  });

  it('returns the raw value when there is no address to find', () => {
    // sendMail validates this and throws a clear error rather than calling Brevo.
    expect(parseSender('PulseSpend').email).toBe('PulseSpend');
  });
});
