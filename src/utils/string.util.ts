import { randomBytes, randomUUID } from 'crypto';

export function extractBearerToken(tokenOrHeader?: string): string | undefined {
  if (!tokenOrHeader || typeof tokenOrHeader !== 'string') {
    return undefined;
  }

  const trimmed = tokenOrHeader.trim();
  if (trimmed.startsWith('Bearer ')) {
    return trimmed.slice(7).trim();
  }

  return trimmed;
}

export function sanitizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function generateRandomToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('hex');
}

export function generateUuid(): string {
  return randomUUID();
}
