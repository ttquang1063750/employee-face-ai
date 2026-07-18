import { isPasswordValid, generateRandomPassword, PASSWORD_PATTERN } from './credentials.util';

describe('isPasswordValid', () => {
  it('accepts a password with upper, lower, digit, and special char', () => {
    expect(isPasswordValid('Abcdefg1!')).toBe(true);
  });

  it('rejects a password shorter than 8 characters', () => {
    expect(isPasswordValid('Ab1!xyz')).toBe(false);
  });

  it('rejects a password with no uppercase letter', () => {
    expect(isPasswordValid('abcdefg1!')).toBe(false);
  });

  it('rejects a password with no lowercase letter', () => {
    expect(isPasswordValid('ABCDEFG1!')).toBe(false);
  });

  it('rejects a password with no digit', () => {
    expect(isPasswordValid('Abcdefgh!')).toBe(false);
  });

  it('rejects a password with no special character', () => {
    expect(isPasswordValid('Abcdefg12')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isPasswordValid('')).toBe(false);
  });
});

describe('generateRandomPassword', () => {
  it('always satisfies its own PASSWORD_PATTERN validator (100 samples)', () => {
    for (let i = 0; i < 100; i++) {
      const password = generateRandomPassword();
      expect(PASSWORD_PATTERN.test(password)).toBe(true);
    }
  });

  it('defaults to length 12', () => {
    expect(generateRandomPassword()).toHaveLength(12);
  });

  it('honors a custom length', () => {
    expect(generateRandomPassword(20)).toHaveLength(20);
  });

  it('does not always place the required characters in the same position', () => {
    const samples = Array.from({ length: 20 }, () => generateRandomPassword());
    const firstChars = new Set(samples.map((p) => p[0]));
    expect(firstChars.size).toBeGreaterThan(1);
  });
});
