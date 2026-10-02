import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config';

function isHex(value: string): boolean {
  return value.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(value);
}

export function verifyBuildcoSignature(
  rawBody: Buffer,
  signatureHeader: string,
  secret: string = config.buildco.webhookSecret,
): boolean {
  if (!secret || !signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const expectedHex = signatureHeader.slice('sha256='.length);
  const computed = createHmac('sha256', secret).update(rawBody).digest('hex');

  if (!isHex(expectedHex) || expectedHex.length !== computed.length) {
    return false;
  }

  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const computedBuf = Buffer.from(computed, 'hex');
  if (expectedBuf.length !== computedBuf.length) {
    return false;
  }

  return timingSafeEqual(expectedBuf, computedBuf);
}
