import { createHmac } from 'crypto';
import { verifyBuildcoSignature } from '../src/utils/webhookSignature';

const secret = 'webhook-secret';
const body = Buffer.from('{"id":"bc-proj-1"}');

describe('verifyBuildcoSignature', () => {
  it('accepts a matching sha256 hex digest', () => {
    const digest = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyBuildcoSignature(body, `sha256=${digest}`, secret)).toBe(true);
  });

  it('rejects invalid hex of the same length instead of throwing', () => {
    const digest = createHmac('sha256', secret).update(body).digest('hex');
    const bogus = `sha256=${'g'.repeat(digest.length)}`;
    expect(verifyBuildcoSignature(body, bogus, secret)).toBe(false);
  });

  it('rejects an empty secret', () => {
    const digest = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyBuildcoSignature(body, `sha256=${digest}`, '')).toBe(false);
  });
});
