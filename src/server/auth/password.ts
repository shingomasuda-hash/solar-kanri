import bcrypt from 'bcryptjs';

/**
 * bcrypt cost factor. 12 is roughly 250 ms on current server hardware — slow
 * enough to make offline cracking expensive, fast enough that a login does not
 * feel broken. Raise it as hardware improves; existing hashes keep their own
 * cost and are re-hashed on next successful login.
 */
const COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  assertPasswordPolicy(plain);
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  // bcrypt.compare is constant-time with respect to the hash contents.
  return bcrypt.compare(plain, hash);
}

/** True when a stored hash was made with a weaker cost than we now require. */
export function needsRehash(hash: string): boolean {
  const rounds = bcrypt.getRounds(hash);
  return rounds < COST;
}

export const PASSWORD_MIN_LENGTH = 12;

export class WeakPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeakPasswordError';
  }
}

/**
 * Length over composition rules. NIST SP 800-63B deprecated forced character
 * mixing because it pushes users toward predictable substitutions; a longer
 * passphrase is stronger and easier to remember.
 */
export function assertPasswordPolicy(plain: string): void {
  if (plain.length < PASSWORD_MIN_LENGTH) {
    throw new WeakPasswordError(
      `パスワードは${PASSWORD_MIN_LENGTH}文字以上にしてください / Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    );
  }
  // bcrypt silently truncates beyond 72 bytes, which would make everything past
  // that point decorative. Reject rather than quietly ignore.
  if (Buffer.byteLength(plain, 'utf8') > 72) {
    throw new WeakPasswordError(
      'パスワードが長すぎます（72バイトまで） / Password must be at most 72 bytes.',
    );
  }
  if (/^(.)\1*$/.test(plain)) {
    throw new WeakPasswordError(
      '同じ文字の繰り返しは使用できません / Password cannot be a single repeated character.',
    );
  }
}
