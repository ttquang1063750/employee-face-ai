import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

// Min 8 chars, at least one lowercase, one uppercase, one digit, one special character.
// Must mirror PASSWORD_PATTERN in server.py.
export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

export const PASSWORD_HINT = 'Tối thiểu 8 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.';

export function isPasswordValid(password: string): boolean {
  return PASSWORD_PATTERN.test(password);
}

// A blank value passes: on edit forms an empty password field means "keep the
// existing password", so complexity is only enforced when something is typed.
export function passwordComplexityValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = (control.value as string) ?? '';
    if (!value) return null;
    return isPasswordValid(value) ? null : { passwordComplexity: true };
  };
}

// Generates a random password that always satisfies PASSWORD_PATTERN: at least
// one lowercase, one uppercase, one digit, one special char, min length 12.
export function generateRandomPassword(length = 12): string {
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const special = '!@#$%^&*';
  const all = lower + upper + digits + special;

  const pick = (pool: string) => pool[Math.floor(Math.random() * pool.length)];

  const required = [pick(lower), pick(upper), pick(digits), pick(special)];
  const rest = Array.from({ length: Math.max(length - required.length, 0) }, () => pick(all));

  const chars = [...required, ...rest];
  // Fisher-Yates shuffle so the required characters aren't always in the same position
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}
