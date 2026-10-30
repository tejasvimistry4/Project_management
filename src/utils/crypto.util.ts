import * as bcrypt from 'bcrypt';

const DEFAULT_SALT_ROUNDS = 12;

export async function hashString(
  plainText: string,
  saltRounds = DEFAULT_SALT_ROUNDS,
): Promise<string> {
  return bcrypt.hash(plainText, saltRounds);
}

export async function compareHash(
  plainText: string,
  hashed: string,
): Promise<boolean> {
  return bcrypt.compare(plainText, hashed);
}
