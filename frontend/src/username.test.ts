import { describe, expect, it } from 'vitest';
import { normalizeSignupUsername, normalizeUsername } from './username';

describe('login username rules', () => {
  it('trims whitespace and compares ASCII names without case differences', () => {
    expect(normalizeUsername('  Horu_Bak23  ')).toBe('horu_bak23');
    expect(normalizeUsername('8ab')).toBe('8ab');
    expect(normalizeUsername('x'.repeat(24))).toBe('x'.repeat(24));
  });

  it.each(['ab', 'x'.repeat(25), '_horubak', 'horu-bak', 'horu bak', 'horu@example.com', '호루박', 'Kim'])('rejects invalid login IDs such as %s', (input) => {
    expect(normalizeUsername(input)).toBeUndefined();
  });
});

describe('signup username rules', () => {
  it('accepts the 3 and 10 character limits and normalizes uppercase', () => {
    expect(normalizeSignupUsername('8AB')).toBe('8ab');
    expect(normalizeSignupUsername('HoruBak123')).toBe('horubak123');
  });

  it.each(['ab', 'HoruBak1234', 'Horu_Bak', ' abc', 'abc ', 'abc\n', '호루박', 'Kim'])('rejects invalid new IDs such as %j', (input) => {
    expect(normalizeSignupUsername(input)).toBeUndefined();
  });
});
