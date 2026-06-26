/**
 * Unit tests for PII detection (Task 4.1).
 * Tests regex patterns for NIK, NO_HP, NO_REKENING, and dictionary-based NAMA_BANK detection.
 * @see Requirements 3.1, 3.2
 */

import { describe, it, expect } from 'vitest';
import {
  detectNIK,
  detectPhoneNumber,
  detectBankAccount,
  detectBankName,
  detectAll,
} from '../../src/services/pii-masker.service.js';

describe('PII Detection - NIK', () => {
  it('detects a valid NIK with valid province code', () => {
    const text = 'NIK saya 3201234567890001';
    const results = detectNIK(text);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('NIK');
    expect(results[0].matchedText).toBe('3201234567890001');
  });

  it('detects NIK with province code 11 (Aceh)', () => {
    const text = 'Nomor NIK: 1171234567890001';
    const results = detectNIK(text);
    expect(results).toHaveLength(1);
    expect(results[0].matchedText).toBe('1171234567890001');
  });

  it('detects NIK with province code 94 (Papua)', () => {
    const text = '9401234567890001 adalah NIK';
    const results = detectNIK(text);
    expect(results).toHaveLength(1);
    expect(results[0].matchedText).toBe('9401234567890001');
  });

  it('rejects 16-digit number with invalid province code', () => {
    // Province code 00 is not valid
    const text = '0001234567890001';
    const results = detectNIK(text);
    expect(results).toHaveLength(0);
  });

  it('rejects 16-digit number with province code 99 (invalid)', () => {
    const text = '9901234567890001';
    const results = detectNIK(text);
    expect(results).toHaveLength(0);
  });

  it('does not match numbers shorter than 16 digits', () => {
    const text = '320123456789000';
    const results = detectNIK(text);
    expect(results).toHaveLength(0);
  });

  it('does not match numbers longer than 16 digits', () => {
    const text = '32012345678900011';
    const results = detectNIK(text);
    expect(results).toHaveLength(0);
  });

  it('detects multiple NIKs in the same text', () => {
    const text = 'NIK suami: 3201234567890001, NIK istri: 3201234567890002';
    const results = detectNIK(text);
    expect(results).toHaveLength(2);
  });

  it('detects NIK with female date encoding (DD+40)', () => {
    // Female NIK has DD+40, e.g., born on 15th → 55
    const text = '3201015512890001';
    const results = detectNIK(text);
    expect(results).toHaveLength(1);
  });
});

describe('PII Detection - NO_HP (Phone Numbers)', () => {
  it('detects phone number with +62 prefix', () => {
    const text = 'Hubungi saya di +6281234567890';
    const results = detectPhoneNumber(text);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('NO_HP');
    expect(results[0].matchedText).toBe('+6281234567890');
  });

  it('detects phone number with 62 prefix (no plus)', () => {
    const text = 'Nomor HP: 6281234567890';
    const results = detectPhoneNumber(text);
    expect(results).toHaveLength(1);
    expect(results[0].matchedText).toBe('6281234567890');
  });

  it('detects phone number with 08 prefix', () => {
    const text = 'WA: 081234567890';
    const results = detectPhoneNumber(text);
    expect(results).toHaveLength(1);
    expect(results[0].matchedText).toBe('081234567890');
  });

  it('detects phone with separators (dashes)', () => {
    const text = 'Call 0812-3456-7890';
    const results = detectPhoneNumber(text);
    expect(results).toHaveLength(1);
    expect(results[0].matchedText).toBe('0812-3456-7890');
  });

  it('detects phone with separators (spaces)', () => {
    const text = 'Call 0812 3456 7890';
    const results = detectPhoneNumber(text);
    expect(results).toHaveLength(1);
  });

  it('detects various valid mobile prefixes', () => {
    const prefixes = ['0811', '0821', '0831', '0851', '0855', '0877', '0881', '0895'];
    for (const prefix of prefixes) {
      const text = `Nomor: ${prefix}12345678`;
      const results = detectPhoneNumber(text);
      expect(results).toHaveLength(1);
    }
  });

  it('rejects phone number with invalid mobile prefix', () => {
    // 0801 is not a valid Indonesian mobile prefix
    const text = '08011234567890';
    const results = detectPhoneNumber(text);
    expect(results).toHaveLength(0);
  });

  it('rejects too-short phone numbers', () => {
    const text = '08123456';
    const results = detectPhoneNumber(text);
    expect(results).toHaveLength(0);
  });
});

describe('PII Detection - NO_REKENING (Bank Account)', () => {
  it('detects account number with rekening keyword context', () => {
    const text = 'Nomor rekening saya 1234567890';
    const results = detectBankAccount(text);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('NO_REKENING');
    expect(results[0].matchedText).toBe('1234567890');
  });

  it('detects account number with transfer keyword', () => {
    const text = 'transfer ke 12345678901234';
    const results = detectBankAccount(text);
    expect(results).toHaveLength(1);
  });

  it('detects account number with "rek" abbreviation', () => {
    const text = 'No rek 87654321';
    const results = detectBankAccount(text);
    expect(results).toHaveLength(1);
    expect(results[0].matchedText).toBe('87654321');
  });

  it('does not detect digit sequence without banking context', () => {
    const text = 'Kode pos area ini adalah 1234567890';
    const results = detectBankAccount(text);
    expect(results).toHaveLength(0);
  });

  it('detects 8-digit account number (minimum length)', () => {
    const text = 'rekening 12345678';
    const results = detectBankAccount(text);
    expect(results).toHaveLength(1);
  });

  it('detects 15-digit account number (maximum length)', () => {
    const text = 'rekening 123456789012345';
    const results = detectBankAccount(text);
    expect(results).toHaveLength(1);
  });

  it('does not detect 7-digit number even with banking context', () => {
    const text = 'rekening 1234567';
    const results = detectBankAccount(text);
    expect(results).toHaveLength(0);
  });
});

describe('PII Detection - NAMA_BANK (Bank Names)', () => {
  it('detects exact bank name - BCA', () => {
    const text = 'Saya nasabah BCA';
    const results = detectBankName(text);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('NAMA_BANK');
    expect(results[0].matchedText).toBe('BCA');
  });

  it('detects bank name case-insensitively', () => {
    const text = 'Transfer via mandiri';
    const results = detectBankName(text);
    expect(results).toHaveLength(1);
  });

  it('detects multi-word bank names', () => {
    const text = 'Saya buka rekening di Bank Permata';
    const results = detectBankName(text);
    expect(results).toHaveLength(1);
    expect(results[0].matchedText).toBe('Bank Permata');
  });

  it('detects bank name aliases (fuzzy matching)', () => {
    const text = 'rekening di Bank Central Asia';
    const results = detectBankName(text);
    expect(results).toHaveLength(1);
    expect(results[0].matchedText).toBe('Bank Central Asia');
  });

  it('detects abbreviated bank name alias', () => {
    const text = 'Transfer via CIMB saja';
    const results = detectBankName(text);
    expect(results).toHaveLength(1);
    expect(results[0].matchedText).toBe('CIMB');
  });

  it('detects multiple bank names in one text', () => {
    const text = 'Transfer dari BCA ke BNI';
    const results = detectBankName(text);
    expect(results).toHaveLength(2);
  });

  it('does not match partial words that contain bank abbreviations', () => {
    // "BCAA" should not match "BCA"
    const text = 'BCAA is not a bank';
    const results = detectBankName(text);
    expect(results).toHaveLength(0);
  });
});

describe('PII Detection - detectAll (combined)', () => {
  it('detects multiple entity types in one text', () => {
    const text = 'NIK 3201234567890001, HP +6281234567890, rekening BCA 1234567890';
    const results = detectAll(text);
    expect(results.length).toBeGreaterThanOrEqual(3);

    const types = results.map(r => r.type);
    expect(types).toContain('NIK');
    expect(types).toContain('NO_HP');
    expect(types).toContain('NO_REKENING');
  });

  it('resolves overlapping detections by keeping the longer match', () => {
    // If a detection overlaps with another, the first one (or longer) should win
    const text = 'rekening 3201234567890001'; // Could match both NIK and account
    const results = detectAll(text);
    // 16 digits with valid province code → should be detected as NIK (longer/more specific)
    // It's also 8-15 digits in banking context, but NIK takes priority since it starts at same position
    // Actually NIK is 16 digits and account is 8-15, so NIK wins
    const nikResults = results.filter(r => r.type === 'NIK');
    expect(nikResults).toHaveLength(1);
  });

  it('returns empty array for text with no PII', () => {
    const text = 'Halo, apa kabar? Cuaca hari ini cerah.';
    const results = detectAll(text);
    expect(results).toHaveLength(0);
  });
});
