import { Router } from 'express';
import { z } from 'zod';
import { AppDataSource } from '../data-source';
import { Tenant } from '../entities/Tenant';
import { logger } from '../logger';
import { BuildcoEvent, processEvent } from '../services/eventService';
import { verifyBuildcoSignature } from '../utils/webhookSignature';

const eventSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['project.created', 'project.updated', 'contact.created', 'contact.updated']),
  occurred_at: z.string().datetime({ offset: true }),
  data: z.record(z.unknown()),
});

const router = Router();

router.post('/buildco', async (req, res, next) => {
  try {
    const signature = req.header('x-buildco-signature') ?? '';
    const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody;
    if (!rawBody || !verifyBuildcoSignature(rawBody, signature)) {
      res.status(401).json({ error: 'invalid signature' });
      return;
    }

    const accountId = req.header('x-buildco-account');
    if (!accountId) {
      res.status(400).json({ error: 'missing account header' });
      return;
    }

    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid event payload', details: parsed.error.flatten() });
      return;
    }

    const tenantRepo = AppDataSource.getRepository(Tenant);
    const tenant = await tenantRepo.findOne({ where: { buildcoAccountId: accountId } });
    if (!tenant) {
      res.status(404).json({ error: 'unknown account' });
      return;
    }

    await processEvent(tenant, parsed.data as BuildcoEvent);
    logger.info(
      { tenantId: tenant.id, eventType: parsed.data.type, externalId: parsed.data.id },
      'webhook processed',
    );
    res.status(202).json({ received: true });
  } catch (err) {
    next(err);
  }
});

export default router;
