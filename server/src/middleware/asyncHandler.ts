/**
 * Async request wrapper.
 *
 * Express 4 does not natively await async route handlers, so any rejection
 * inside them becomes an UnhandledPromiseRejection. This wrapper forwards
 * the rejection to `next(err)` so the global error handler can render it.
 */

import { NextFunction, Request, RequestHandler, Response } from 'express';

export function asyncHandler<TReq extends Request = Request, TRes extends Response = Response>(
  fn: (req: TReq, res: TRes, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as TReq, res as TRes, next)).catch(next);
  };
}
