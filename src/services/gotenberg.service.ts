/**
 * Gotenberg Service — converts legacy Office documents (.doc, .ppt) to PDF
 * via Gotenberg's LibreOffice endpoint, then extracts text using pdf-parse.
 *
 * Gotenberg is deployed as a separate Cloud Run service:
 *   - Image: gotenberg/gotenberg:8
 *   - Endpoint: /forms/libreoffice/convert
 *   - Resources: 2 vCPU / 4GB RAM
 *
 * GOTENBERG_URL env var must point to the Gotenberg service (e.g.
 * https://gotenberg-xxxxx-uc.a.run.app).
 *
 * @see Requirements 1.1, 1.2
 */

import { config } from '../config/index.js';
import { extractPdfText } from './document-extractor.service.js';
import type { ExtractionResult } from '../types/upload.types.js';

/**
 * Convert a legacy Office document (.doc, .ppt) to text via Gotenberg → PDF → pdf-parse.
 *
 * Steps:
 *   1. POST file buffer to Gotenberg /forms/libreoffice/convert
 *   2. Receive PDF response
 *   3. Extract text from PDF via pdf-parse
 *
 * Graceful degradation: returns low-confidence empty result if Gotenberg is
 * not configured or unreachable. Never throws.
 */
export async function convertViaGotenberg(
  buffer: Buffer,
  filename: string,
): Promise<ExtractionResult> {
  const gotenbergUrl = config.gotenberg.url;
  if (!gotenbergUrl) {
    console.warn('[gotenberg] GOTENBERG_URL not configured — skipping conversion');
    return { text: '', filename, isEmpty: true, confidence: 'low', format: 'unknown' };
  }

  const ext = filename.split('.').pop()?.toLowerCase() || 'doc';
  const endpoint = `${gotenbergUrl}/forms/libreoffice/convert`;

  try {
    // Build multipart form
    const form = new FormData();
    form.append('files', new Blob([buffer as any], { type: 'application/octet-stream' }), filename);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.gotenberg.timeoutMs);

    const response = await fetch(endpoint, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`[gotenberg] API returned ${response.status} for ${filename}`);
      return { text: '', filename, isEmpty: true, confidence: 'low', format: ext };
    }

    // Response is a PDF — extract text via pdf-parse
    const pdfBuffer = Buffer.from(await response.arrayBuffer());
    const result = await extractPdfText(pdfBuffer, filename.replace(/\.(doc|ppt)$/i, '.pdf'));

    return {
      ...result,
      format: ext, // Report original format, not pdf
    };
  } catch (error) {
    console.error(`[gotenberg] Conversion failed for ${filename}:`, (error as Error).message);
    return { text: '', filename, isEmpty: true, confidence: 'low', format: ext };
  }
}
