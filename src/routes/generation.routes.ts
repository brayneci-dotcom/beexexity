/**
 * Generation Routes — PPTX/PDF file generation endpoints.
 *
 * POST /api/v1/generate/pptx — Generate .pptx from prompt (+ optional files + conversation context)
 * POST /api/v1/generate/pdf  — Generate .pdf from prompt (+ optional files + conversation context)
 *
 * Query: ?format=html (default, beautiful CSS) | ?format=json (editable, python-pptx)
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { forcePasswordResetMiddleware } from '../middleware/password-reset.middleware.js';
import { generatePptx, generatePdf } from '../services/pptx-generator.service.js';
import { extractDocumentText } from '../services/document-extractor.service.js';
import { config } from '../config/index.js';
import type { DocumentFile } from '../types/upload.types.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 5 } });

router.use(authMiddleware as any);
router.use(forcePasswordResetMiddleware as any);

async function buildPromptWithFiles(prompt: string, files: Express.Multer.File[]): Promise<string> {
  if (files.length === 0) return prompt;
  const extractedTexts: string[] = [];
  for (const file of files) {
    try {
      const docFile: DocumentFile = { buffer: file.buffer, mimetype: file.mimetype, originalname: file.originalname, size: file.size };
      const result = await extractDocumentText(docFile);
      if (result.text && result.text.trim().length > 0) {
        extractedTexts.push(`### ${file.originalname}\n${result.text.trim()}`);
      }
    } catch (err) {
      console.warn(`[generation] Failed to extract text from ${file.originalname}:`, (err as Error).message);
    }
  }
  if (extractedTexts.length === 0) return prompt;
  let combined = extractedTexts.join('\n\n---\n\n');
  if (combined.length > 30000) combined = combined.slice(0, 30000) + '\n...(truncated)';
  return `${prompt}\n\n--- DOKUMEN TERLAMPIR (gunakan sebagai sumber konten presentasi) ---\n\n${combined}`;
}

/** Shared handler for both /pptx and /pdf */
async function handleGenerate(req: Request, res: Response, next: NextFunction, type: 'pptx' | 'pdf') {
  try {
    const prompt: string = req.body?.prompt || '';
    const modelId: string | undefined = req.body?.modelId || undefined;
    const context: string | undefined = req.body?.context || undefined;
    // Auto-fallback: HTML mode needs Gotenberg, JSON mode needs python-pptx service
    const requestedFormat = req.query?.format as string | undefined;
    let format: 'html' | 'json' = 'html';
    if (requestedFormat === 'json') {
      format = 'json';
    } else if (!config.gotenberg.url) {
      // No Gotenberg → use HTML path, return raw HTML as preview (not PPTX)
      format = 'html';
      console.log('[generation] GOTENBERG_URL not configured — returning HTML preview');
    }

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      res.status(400).json({ error: 'INVALID_PROMPT', message: 'Prompt is required' });
      return;
    }
    if (prompt.length > 16000) {
      res.status(400).json({ error: 'PROMPT_TOO_LONG', message: 'Prompt + context too long' });
      return;
    }

    const files = (req.files as Express.Multer.File[]) || [];
    let combinedPrompt = await buildPromptWithFiles(prompt.trim(), files);
    if (context && context.trim().length > 0) {
      const maxCtx = 6000;
      const ctx = context.length > maxCtx ? context.slice(-maxCtx) : context;
      combinedPrompt = `${combinedPrompt}\n\n--- KONTEKS PERCAKAPAN SEBELUMNYA ---\n\n${ctx}`;
    }

    // When Gotenberg is missing, return HTML preview directly (local dev / testing)
    if (format === 'html' && !config.gotenberg.url) {
      const { generateHtmlSlides } = await import('../services/pptx-generator.service.js');
      const safeTitle = combinedPrompt.replace(/[^a-z0-9\-_ ]/gi, '').replace(/\s+/g, '-').slice(0, 40) || 'presentation';
      const { html, modelUsed } = await generateHtmlSlides(combinedPrompt, modelId);
      console.log(`[generation] HTML preview (no Gotenberg): ${modelUsed}, ${(Buffer.byteLength(html) / 1024).toFixed(0)}KB`);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeTitle)}-preview.html"`);
      res.send(html);
      return;
    }

    const result = type === 'pptx'
      ? await generatePptx(combinedPrompt, modelId, undefined, format)
      : await generatePdf(combinedPrompt, modelId, format);

    const contentType = type === 'pptx'
      ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      : 'application/pdf';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.filename)}"`);
    res.setHeader('Content-Length', result.buffer.length.toString());
    res.send(result.buffer);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Generation failed';
    const label = type === 'pptx' ? 'PPTX' : 'PDF';
    console.error(`[${label} Generation Error]`, message);

    if (message.includes('not configured') || message.includes('GOTENBERG_URL') || message.includes('PPTX_SERVICE_URL')) {
      res.status(503).json({ error: 'SERVICE_UNAVAILABLE', message: 'Generation service not configured' });
    } else if (message.includes('No <section>') || message.includes('No slide sections') || message.includes('No valid theme') || message.includes('Inconsistent themes') || message.includes('Consecutive duplicate') || message.includes('layout-content used') || message.includes('should be layout-hero') || message.includes('missing layout class') || message.includes('Minimum') || message.includes('slide(s) found')) {
      res.status(422).json({ error: 'CONTENT_GENERATION_FAILED', message: 'Failed to generate valid slides. Try a more specific prompt.' });
    } else if (message.includes('Gotenberg')) {
      console.error(`[${label} Generation] Gotenberg error details:`, message);
      res.status(502).json({ error: 'UPSTREAM_ERROR', message: `Rendering service error: ${message.slice(0, 200)}` });
    } else if (message.includes('JSON') || message.includes('validation')) {
      res.status(422).json({ error: 'CONTENT_GENERATION_FAILED', message: 'Failed to generate valid presentation content. Try a more specific prompt.' });
    } else {
      next(err);
    }
  }
}

router.post('/pptx', upload.any(), (req, res, next) => handleGenerate(req, res, next, 'pptx'));
router.post('/pdf', upload.any(), (req, res, next) => handleGenerate(req, res, next, 'pdf'));

export default router;
