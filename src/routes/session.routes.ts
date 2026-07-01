import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import {
  listUserSessions,
  getSessionById,
  getSessionMessages,
  getSessionStats,
  resumeSession,
  SessionNotFoundError,
} from '../services/session.service.js';
import { config } from '../config/index.js';
import { ErrorResponse } from '../types/error.types.js';

/**
 * Session routes — chat history sidebar endpoints.
 * Lists past sessions, retrieves messages and stats, and resumes inactive sessions.
 *
 * @see Requirements R5, R6, R7, R8
 */
const sessionRouter = Router();

// All session endpoints require authentication
sessionRouter.use(authMiddleware);

/**
 * GET /api/v1/sessions
 *
 * List the authenticated user's sessions with pagination, preview text,
 * and aggregated token statistics.
 *
 * Query params:
 *   - page (default 1, min 1)
 *   - pageSize (default from config, min 1, max 100)
 *
 * Response: { sessions: SessionWithStats[], total, page, pageSize, hasMore }
 */
sessionRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;

  // Parse pagination params
  const page = Math.max(1, parseInt(String(req.query.page ?? ''), 10) || 1);
  const rawPageSize = parseInt(String(req.query.pageSize ?? ''), 10) || config.session.listPageSize;
  const pageSize = Math.min(100, Math.max(1, rawPageSize));

  try {
    const { sessions, total } = await listUserSessions(user.sub, page, pageSize);
    const hasMore = page * pageSize < total;

    res.status(200).json({
      sessions,
      total,
      page,
      pageSize,
      hasMore,
    });
  } catch (error: unknown) {
    console.error('[sessions] List failed:', (error as Error).message);
    const errorResponse: ErrorResponse = {
      error: 'INTERNAL_ERROR',
      message: 'Failed to load conversations',
    };
    res.status(500).json(errorResponse);
  }
});

/**
 * GET /api/v1/sessions/:id/messages
 *
 * Returns the full message history and session metadata for a specific session.
 * The session must belong to the authenticated user (404 otherwise).
 *
 * Response: { session: Session, messages: Message[] }
 */
sessionRouter.get('/:id/messages', async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;
  const sessionId = req.params.id as string;

  // Validate UUID format
  if (!isValidUUID(sessionId)) {
    const errorResponse: ErrorResponse = {
      error: 'VALIDATION_ERROR',
      message: 'Invalid session ID format',
    };
    res.status(400).json(errorResponse);
    return;
  }

  try {
    // Verify ownership
    const session = await getSessionById(user.sub, sessionId);
    if (!session) {
      const errorResponse: ErrorResponse = {
        error: 'SESSION_NOT_FOUND',
        message: 'Session not found',
      };
      res.status(404).json(errorResponse);
      return;
    }

    // Fetch messages (existing function, returns all messages chronologically)
    const storedMessages = await getSessionMessages(sessionId);
    const messages = storedMessages.map((msg) => ({
      role: msg.role,
      content: msg.sanitizedContent,
      createdAt: msg.createdAt,
    }));

    res.status(200).json({ session, messages });
  } catch (error: unknown) {
    console.error('[sessions] Get messages failed:', (error as Error).message);
    const errorResponse: ErrorResponse = {
      error: 'INTERNAL_ERROR',
      message: 'Failed to load conversation messages',
    };
    res.status(500).json(errorResponse);
  }
});

/**
 * GET /api/v1/sessions/:id/stats
 *
 * Returns aggregated token/cost statistics for a session from audit_logs.
 * Returns stats-with-zeros if the session exists but has no successful requests yet.
 *
 * Response: SessionStats
 */
sessionRouter.get('/:id/stats', async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;
  const sessionId = req.params.id as string;

  if (!isValidUUID(sessionId)) {
    const errorResponse: ErrorResponse = {
      error: 'VALIDATION_ERROR',
      message: 'Invalid session ID format',
    };
    res.status(400).json(errorResponse);
    return;
  }

  try {
    // Verify ownership
    const session = await getSessionById(user.sub, sessionId);
    if (!session) {
      const errorResponse: ErrorResponse = {
        error: 'SESSION_NOT_FOUND',
        message: 'Session not found',
      };
      res.status(404).json(errorResponse);
      return;
    }

    const stats = await getSessionStats(sessionId);

    if (!stats) {
      // Session exists but has no successful requests yet — return zeros
      res.status(200).json({
        sessionId,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        requestCount: 0,
        estimatedCostUsd: 0,
        breakdown: [],
      });
      return;
    }

    res.status(200).json(stats);
  } catch (error: unknown) {
    console.error('[sessions] Get stats failed:', (error as Error).message);
    const errorResponse: ErrorResponse = {
      error: 'INTERNAL_ERROR',
      message: 'Failed to load session statistics',
    };
    res.status(500).json(errorResponse);
  }
});

/**
 * POST /api/v1/sessions/:id/resume
 *
 * Reactivates an inactive or degraded session so the user can continue the conversation.
 * Any currently active session for this user is marked inactive.
 *
 * Response: { session: Session }
 * Errors: 400 (expired), 404 (not found)
 */
sessionRouter.post('/:id/resume', async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;
  const sessionId = req.params.id as string;

  if (!isValidUUID(sessionId)) {
    const errorResponse: ErrorResponse = {
      error: 'VALIDATION_ERROR',
      message: 'Invalid session ID format',
    };
    res.status(400).json(errorResponse);
    return;
  }

  try {
    const session = await resumeSession(user.sub, sessionId);
    res.status(200).json({ session });
  } catch (error: unknown) {
    if (error instanceof SessionNotFoundError) {
      const errorResponse: ErrorResponse = {
        error: 'SESSION_NOT_FOUND',
        message: 'Session not found',
      };
      res.status(404).json(errorResponse);
      return;
    }

    console.error('[sessions] Resume failed:', (error as Error).message);
    const errorResponse: ErrorResponse = {
      error: 'SESSION_RESUME_ERROR',
      message: 'Failed to resume conversation',
    };
    res.status(500).json(errorResponse);
  }
});

/**
 * Basic UUID format validation (does not need to be exhaustive —
 * the database cast will catch truly malformed strings).
 */
function isValidUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export { sessionRouter };
