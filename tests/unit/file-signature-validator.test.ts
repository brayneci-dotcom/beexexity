/**
 * Unit tests for File Signature Validator.
 * Tests signature detection, mismatched MIME detection, and edge cases.
 *
 * @see Requirements 1.3
 */

import { describe, it, expect } from 'vitest';
import {
  validateFileSignature,
  assertValidFileSignature,
} from '../../src/services/file-signature-validator.js';
import type { DocumentFile, ImageFile } from '../../src/types/upload.types.js';

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Create a Buffer from a hex string. */
function hex(hexStr: string): Buffer {
  return Buffer.from(hexStr.replace(/\s+/g, ''), 'hex');
}

/** Create a Buffer from an ASCII string. */
function ascii(s: string): Buffer {
  return Buffer.from(s, 'ascii');
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('validateFileSignature', () => {
  describe('PDF', () => {
    it('accepts %PDF prefix', () => {
      const buf = hex('25 50 44 46 2D 31 2E 34'); // %PDF-1.4
      const result = validateFileSignature(buf, 'application/pdf');
      expect(result.passed).toBe(true);
      expect(result.detectedLabel).toBe('PDF');
    });

    it('rejects non-PDF prefix', () => {
      const buf = hex('50 4B 03 04 00 00 00 00'); // PK\x03\x04 (ZIP)
      const result = validateFileSignature(buf, 'application/pdf');
      expect(result.passed).toBe(false);
      expect(result.error).toContain("magic bytes don't match");
    });
  });

  describe('DOCX / PPTX (ZIP-based)', () => {
    it('accepts PK\x03\x04 prefix for DOCX', () => {
      const buf = hex('50 4B 03 04 14 00 00 00'); // ZIP local file header
      const result = validateFileSignature(buf, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(result.passed).toBe(true);
    });

    it('accepts PK\x03\x04 prefix for PPTX', () => {
      const buf = hex('50 4B 03 04 14 00 00 00');
      const result = validateFileSignature(buf, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      expect(result.passed).toBe(true);
    });

    it('rejects DOCX claimed but not ZIP', () => {
      const buf = hex('00 00 00 00 00 00 00 00');
      const result = validateFileSignature(buf, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(result.passed).toBe(false);
    });
  });

  describe('Images', () => {
    it('accepts PNG signature', () => {
      const buf = hex('89 50 4E 47 0D 0A 1A 0A'); // PNG magic
      const result = validateFileSignature(buf, 'image/png');
      expect(result.passed).toBe(true);
    });

    it('accepts JPEG signature', () => {
      const buf = hex('FF D8 FF E0 00 10 4A 46'); // JPEG SOI
      const result = validateFileSignature(buf, 'image/jpeg');
      expect(result.passed).toBe(true);
    });

    it('accepts WEBP signature (RIFF + WEBP)', () => {
      const buf = hex('52 49 46 46 00 00 00 00 57 45 42 50'); // RIFF + WEBP
      const result = validateFileSignature(buf, 'image/webp');
      expect(result.passed).toBe(true);
    });

    it('rejects PNG claimed but JPEG bytes', () => {
      const buf = hex('FF D8 FF E0 00 10 4A 46');
      const result = validateFileSignature(buf, 'image/png');
      expect(result.passed).toBe(false);
    });
  });

  describe('Text-based formats (no magic bytes registered)', () => {
    it('passes HTML (no signature registry entry)', () => {
      const buf = ascii('<html><body>hello</body></html>');
      const result = validateFileSignature(buf, 'text/html');
      expect(result.passed).toBe(true);
      expect(result.detectedLabel).toBeNull();
    });

    it('passes JSON (no signature registry entry)', () => {
      const buf = ascii('{"key": "value"}');
      const result = validateFileSignature(buf, 'application/json');
      expect(result.passed).toBe(true);
    });

    it('passes CSV (no signature registry entry)', () => {
      const buf = ascii('a,b,c\n1,2,3');
      const result = validateFileSignature(buf, 'text/csv');
      expect(result.passed).toBe(true);
    });

    it('passes TXT (no signature registry entry)', () => {
      const buf = ascii('hello world');
      const result = validateFileSignature(buf, 'text/plain');
      expect(result.passed).toBe(true);
    });

    it('passes XML (no signature registry entry)', () => {
      const buf = ascii('<root><item>text</item></root>');
      const result = validateFileSignature(buf, 'text/xml');
      expect(result.passed).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('handles empty buffer', () => {
      const buf = Buffer.alloc(0);
      const result = validateFileSignature(buf, 'application/pdf');
      expect(result.passed).toBe(false);
      expect(result.error).toContain("magic bytes don't match");
    });

    it('handles buffer shorter than signature length', () => {
      const buf = hex('25 50'); // only 2 bytes, need 4 for %PDF
      const result = validateFileSignature(buf, 'application/pdf');
      expect(result.passed).toBe(false);
    });

    it('handles unknown MIME type gracefully (passes)', () => {
      const buf = ascii('some content');
      const result = validateFileSignature(buf, 'application/octet-stream');
      expect(result.passed).toBe(true);
      expect(result.detectedLabel).toBeNull();
    });
  });
});

describe('assertValidFileSignature', () => {
  it('throws on mismatch', () => {
    const file: DocumentFile = {
      buffer: hex('FF D8 FF E0'), // JPEG header
      mimetype: 'application/pdf',
      originalname: 'fake.pdf',
      size: 4,
    };
    expect(() => assertValidFileSignature(file)).toThrow();
  });

  it('does not throw on match', () => {
    const file: DocumentFile = {
      buffer: hex('25 50 44 46 2D 31 2E 34'),
      mimetype: 'application/pdf',
      originalname: 'real.pdf',
      size: 6,
    };
    expect(() => assertValidFileSignature(file)).not.toThrow();
  });

  it('does not throw for text formats (no signature check)', () => {
    const file: DocumentFile = {
      buffer: ascii('<html>hi</html>'),
      mimetype: 'text/html',
      originalname: 'doc.html',
      size: 16,
    };
    expect(() => assertValidFileSignature(file)).not.toThrow();
  });

  it('rejects .exe renamed to .pdf', () => {
    // MZ executable signature
    const file: DocumentFile = {
      buffer: hex('4D 5A 90 00 03 00 00 00'), // MZ header
      mimetype: 'application/pdf',
      originalname: 'document.pdf',
      size: 8,
    };
    expect(() => assertValidFileSignature(file)).toThrow();
  });
});
