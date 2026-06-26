/**
 * Document Extractor Service
 * Extracts plain text from PDF and DOCX file buffers.
 * All extraction is performed in-memory (no disk I/O).
 *
 * Edge cases handled:
 * - Image-only PDFs: returns empty text with isEmpty=true
 * - Corrupted files: throws descriptive error
 * - Empty documents: returns empty text with isEmpty=true
 *
 * @see Requirements 2.1, 2.2, 2.3, 2.4, 2.6
 */

import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import { DocumentFile, ExtractionResult } from '../types/upload.types.js';

/**
 * Extract text from a PDF buffer using pdf-parse.
 * Returns empty text with isEmpty=true for image-only PDFs or empty documents.
 * Throws descriptive error for corrupted files.
 * All extraction is in-memory (no disk I/O).
 */
export async function extractPdfText(buffer: Buffer, filename: string): Promise<ExtractionResult> {
  let parser: PDFParse | undefined;
  try {
    parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    const text = result.text.trim();
    return {
      text,
      filename,
      isEmpty: text.length === 0,
    };
  } catch (error) {
    throw new Error(`Could not extract text from '${filename}'. File may be corrupted.`);
  } finally {
    if (parser) {
      await parser.destroy();
    }
  }
}

/**
 * Extract text from a DOCX buffer using mammoth.
 * Preserves paragraph boundaries as newlines.
 * Returns empty text with isEmpty=true for empty documents.
 * Throws descriptive error for corrupted files.
 * All extraction is in-memory (no disk I/O).
 */
export async function extractDocxText(buffer: Buffer, filename: string): Promise<ExtractionResult> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = (result.value ?? '').trim();
    return {
      text,
      filename,
      isEmpty: text.length === 0,
    };
  } catch (error) {
    throw new Error(`Could not extract text from '${filename}'. File may be corrupted.`);
  }
}

/**
 * Route to appropriate extractor based on MIME type.
 * Dispatches PDF files to extractPdfText and DOCX files to extractDocxText.
 */
export async function extractDocumentText(file: DocumentFile): Promise<ExtractionResult> {
  if (file.mimetype === 'application/pdf') {
    return extractPdfText(file.buffer, file.originalname);
  }

  if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return extractDocxText(file.buffer, file.originalname);
  }

  throw new Error(`Unsupported document type: ${file.mimetype}`);
}
