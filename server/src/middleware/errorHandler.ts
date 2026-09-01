/**
 * Custom error type + Express error handler.
 *
 * Every controller throws `HttpError` to signal a meaningful status code, and the
 * global error handler at the bottom of the chain turns it into a JSON response
 * with `{ error, code, details? }`. Anything else that escapes the stack is
 * logged in full and reported as 500 to the client.
 */

import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (resource: string): HttpError =>
  new HttpError(404, 'NOT_FOUND', `${resource} not found`);

export const badRequest = (message: string, details?: unknown): HttpError =>
  new HttpError(400, 'BAD_REQUEST', message, details);

export const tooManyRequests = (message = 'Too many requests'): HttpError =>
  new HttpError(429, 'TOO_MANY_REQUESTS', message);

export const serviceUnavailable = (message = 'Service unavailable'): HttpError =>
  new HttpError(503, 'SERVICE_UNAVAILABLE', message);

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: err.flatten()
    });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: err.message,
      code: err.code,
      ...(err.details !== undefined ? { details: err.details } : {})
    });
    return;
  }

  const message = err instanceof Error ? err.message : 'Unknown server error';
  // eslint-disable-next-line no-console
  console.error('[error]', err);
  res.status(500).json({
    error: message,
    code: 'INTERNAL_ERROR'
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: `No route matches ${req.method} ${req.originalUrl}`,
    code: 'ROUTE_NOT_FOUND'
  });
}
