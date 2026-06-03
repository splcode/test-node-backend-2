import type { Request, Response, NextFunction } from "express";

/**
 * Browser (BFF) guard: requires an authenticated session. Machine clients use a
 * separate bearer guard (step 3); a combined "session OR bearer" guard can wrap
 * both once that lands.
 */
export function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.user) {
    next();
    return;
  }
  res.status(401).json({ error: "unauthorized" });
}
