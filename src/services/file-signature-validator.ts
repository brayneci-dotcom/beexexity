/**
 * File Signature Validator
 *
 * Checks file magic bytes against declared MIME type as a heuristic gate.
 * This is NOT a full trust boundary — it reduces accidental misclassification
 * (e.g. .exe renamed .pdf) but does not prove file safety.
 * Structural validation (XXE, depth, proto keys) happens in each extractor.
 *
 * @see Requirements 1.3
 */

import type { DocumentFile, ImageFile } from '../types/upload.types.js';

// ─── Signature Registry ─────────────────────────────────────────────────────────
//
// Each entry lists magic byte sequences that a file of the claimed MIME type
// MUST begin with (at the given offset). Only one match is required.
//
// Declared as functions so the byte arrays are lazily allocated.

interface SignatureSpec {
  /** Byte sequences to check (any match = pass) */
  patterns: { bytes: number[]; offset: number }[];
  /** Human-readable label for error messages */
  label: string;
}

const SIGNATURES: Record<string, SignatureSpec> = {
  'application/pdf': {
    label: 'PDF',
    patterns: [{ bytes: [0x25, 0x50, 0x44, 0x46], offset: 0 }], // %PDF
  },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    label: 'DOCX (ZIP)',
    patterns: [{ bytes: [0x50, 0x4B, 0x03, 0x04], offset: 0 }], // PK\x03\x04
  },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    label: 'PPTX (ZIP)',
    patterns: [{ bytes: [0x50, 0x4B, 0x03, 0x04], offset: 0 }], // PK\x03\x04
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    label: 'XLSX (ZIP)',
    patterns: [{ bytes: [0x50, 0x4B, 0x03, 0x04], offset: 0 }], // PK\x03\x04
  },
  'image/png': {
    label: 'PNG',
    patterns: [{ bytes: [0x89, 0x50, 0x4E, 0x47], offset: 0 }], // \x89PNG
  },
  'image/jpeg': {
    label: 'JPEG',
    patterns: [{ bytes: [0xFF, 0xD8, 0xFF], offset: 0 }], // \xFF\xD8\xFF
  },
  'image/webp': {
    label: 'WEBP',
    patterns: [
      { bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },     // RIFF
      { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },     // WEBP
    ],
  },
};

// Text-based formats (HTML, JSON, CSV, TXT, MD, XML) are validated by
// content inspection in their respective extractors rather than magic bytes,
// since they share the same text/* MIME space and lack unique binary signatures.
// They are accepted at the MIME level. The extractors reject suspicious content.

// ─── Public API ─────────────────────────────────────────────────────────────────

export interface SignatureValidationResult {
  passed: boolean;
  declaredMime: string;
  detectedLabel: string | null;
  /** Human-readable error when failed */
  error?: string;
}

/**
 * Validate a file buffer against its declared MIME type using magic bytes.
 *
 * @param buffer  Raw file bytes (first few KB are checked).
 * @param mime    Declared MIME type from the upload.
 * @returns SignatureValidationResult with pass/fail and diagnostic info.
 */
export function validateFileSignature(
  buffer: Buffer,
  mime: string,
): SignatureValidationResult {
  const spec = SIGNATURES[mime];

  // No signature registry entry → heuristic pass.
  // Structural validation is deferred to the extractor.
  if (!spec) {
    return {
      passed: true,
      declaredMime: mime,
      detectedLabel: null,
    };
  }

  // Check all required patterns — each must match
  const allMatch = spec.patterns.every(p =>
    p.bytes.every((b, i) => {
      const pos = p.offset + i;
      return pos < buffer.length && buffer[pos] === b;
    }),
  );

  if (!allMatch) {
    // Read first 8 bytes for diagnostics
    const header = buffer.slice(0, Math.min(16, buffer.length));
    const headerHex = header.toString('hex').toUpperCase();
    return {
      passed: false,
      declaredMime: mime,
      detectedLabel: spec.label,
      error: `Declared ${spec.label} (${mime}) but magic bytes don't match. Header: 0x${headerHex}`,
    };
  }

  return {
    passed: true,
    declaredMime: mime,
    detectedLabel: spec.label,
  };
}

/**
 * Convenience wrapper for DocumentFile | ImageFile.
 * Throws a descriptive error on mismatch (fail-closed).
 */
export function assertValidFileSignature(
  file: DocumentFile | ImageFile,
): void {
  const result = validateFileSignature(file.buffer, file.mimetype);
  if (!result.passed) {
    throw new Error(result.error);
  }
}
