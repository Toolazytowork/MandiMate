export interface PasswordRules {
  length: boolean;
  letterAndDigit: boolean;
}

export function passwordRules(password: string): PasswordRules {
  return {
    length: password.length >= 8,
    letterAndDigit: /[A-Za-z]/.test(password) && /\d/.test(password),
  };
}

export function meetsPasswordPolicy(password: string): boolean {
  const rules = passwordRules(password);
  return rules.length && rules.letterAndDigit;
}

/** 0 = empty, 1 = weak … 4 = strong. Policy is the floor; length and variety raise the score. */
export function passwordScore(password: string): 0 | 1 | 2 | 3 | 4 {
  if (!password) return 0;
  const rules = passwordRules(password);
  if (!rules.length || !rules.letterAndDigit) return 1;
  let score = 2;
  if (password.length >= 12) score += 1;
  if ((/[a-z]/.test(password) && /[A-Z]/.test(password)) || /[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(score, 4) as 2 | 3 | 4;
}
