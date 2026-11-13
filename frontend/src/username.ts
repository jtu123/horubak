export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 10;
export const USERNAME_RULES = '영문·숫자만 3~10자';
export const LOGIN_USERNAME_MAX_LENGTH = 24;

export function normalizeSignupUsername(value: string): string | undefined {
  if (value.length < USERNAME_MIN_LENGTH || value.length > USERNAME_MAX_LENGTH || /[^A-Za-z0-9]/.test(value)) return;
  return value.toLowerCase();
}

export function normalizeUsername(value: string): string | undefined {
  const username = value.trim();
  if (username.length < USERNAME_MIN_LENGTH || username.length > LOGIN_USERNAME_MAX_LENGTH) return;
  if (!/^[A-Za-z0-9][A-Za-z0-9_]*$/.test(username)) return;
  return username.toLowerCase();
}
