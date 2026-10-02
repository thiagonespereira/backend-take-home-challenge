import express, { Express } from 'express';
import { IncomingMessage } from 'http';
import { errorHandler } from './middleware/errorHandler';
import healthRouter from './routes/health';
import webhooksRouter from './routes/webhooks';

export function createApp(): Express {
  const app = express();
  app.use(
    express.json({
      verify: (req: IncomingMessage, _res, buf) => {
        (req as IncomingMessage & { rawBody: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use(healthRouter);
  app.use('/webhooks', webhooksRouter);
  app.use(errorHandler);
  return app;
}
