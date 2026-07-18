// Min 8 chars, at least one lowercase, one uppercase, one digit, one special character.
// Must mirror PASSWORD_PATTERN in server.py.
export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

export const PASSWORD_HINT = 'Tối thiểu 8 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.';

export function isPasswordValid(password: string): boolean {
  return PASSWORD_PATTERN.test(password);
}
