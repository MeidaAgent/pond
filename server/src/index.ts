/**
 * Pond backend entry point.
 *
 * - Loads environment variables
 * - Builds an Express app
 * - Wires CORS, JSON parsing, rate limiting and the global error handler
 * - Mounts the API router at /api
 * - Starts listening on $PORT (default 4000)
 *
 * The application is split into `createApp()` (returns the Express app) and
 * `start()` (binds the port). Splitting them makes the app testable in
 * isolation by importing `createApp` and stubbing the listener.
 */

import 'dotenv/config';
import cors from 'cors';
import express, { Application, NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';

import apiRouter from './routes/api';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { PROTOCOL_CONFIG } from './config/protocol';

const DEFAULT_PORT = 4000;

/** Build (but do not start) the Express application. */
export function createApp(): Application {
  const app = express();

  // Trust X-Forwarded-* headers when running behind a reverse proxy (nginx, caddy,
  // a Cloudflare worker, etc.). Without this the rate limiter sees the proxy IP
  // rather than the real client.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // CORS — allow the configured origin(s). `*` opens it for everyone, which is
  // fine for public read-only endpoints but should be tightened in production
  // for any route that accepts a wallet signature.
  const origins = (process.env.CORS_ORIGIN || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin: origins.length === 0 || origins.includes('*') ? true : origins,
      methods: ['GET', 'POST', 'OPTIONS'],
      credentials: false,
      maxAge: 86_400
    })
  );

  // Body parsing — explicit 1MB cap so a malicious client cannot OOM the process.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  // Rate limiting — global limiter, applied before the router. Reads the limit
  // and window from env so deployments can tune them per-environment.
  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
  const max = Number(process.env.RATE_LIMIT_MAX ?? 120);
  app.use(
    rateLimit({
      windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60_000,
      max: Number.isFinite(max) && max > 0 ? max : 120,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        error: 'Too many requests, slow down.',
        code: 'TOO_MANY_REQUESTS'
      }
    })
  );

  // Request logging — small, structured, single line.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();
    _res.on('finish', () => {
      const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
      // eslint-disable-next-line no-console
      console.log(
        `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${_res.statusCode} ${elapsed.toFixed(1)}ms`
      );
    });
    next();
  });

  // Mount the API router under /api. The root path returns a tiny welcome that
  // tells the caller the service is alive without leaking implementation details.
  app.get('/', (_req: Request, res: Response) => {
    res.json({
      service: 'usepond-backend',
      network: PROTOCOL_CONFIG.chainName,
      docs: '/api/health',
      version: '1.0.0'
    });
  });

  app.use('/api', apiRouter);

  // 404 + global error handler. The 404 must come first so unknown paths hit
  // it before the error handler ever sees them.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/** Start the HTTP listener. Returns the underlying http.Server. */
export function start(port = Number(process.env.PORT || DEFAULT_PORT), host = process.env.HOST || '0.0.0.0') {
  const app = createApp();
  const server = app.listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(
      `[usepond-backend] listening on http://${host}:${port} (chain=${PROTOCOL_CONFIG.chainName}#${PROTOCOL_CONFIG.chainId})`
    );
  });

  const shutdown = (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`[usepond-backend] received ${signal}, closing...`);
    server.close((err) => {
      if (err) {
        // eslint-disable-next-line no-console
        console.error('[usepond-backend] close error', err);
        process.exit(1);
      }
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

if (require.main === module) {
  start();
}
