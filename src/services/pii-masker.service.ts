/**
 * PII Masker Service
 * Detects and masks Personally Identifiable Information in prompt text.
 * One-way masking only — masked data is never restored.
 *
 * @see Requirements 3.1, 3.2, 4.1, 4.2, 4.3, 4.4
 */

import { DetectedEntity, MaskResult, PIIEntityType } from '../types/pii.types.js';

/**
 * Valid Indonesian province codes (first 2 digits of NIK).
 * Codes 11-94 as per Indonesian administrative divisions.
 */
const VALID_PROVINCE_CODES = new Set([
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '31', '32', '33', '34', '35', '36',
  '51', '52', '53',
  '61', '62', '63', '64', '65',
  '71', '72', '73', '74', '75', '76',
  '81', '82',
  '91', '92', '94',
]);

/**
 * Valid Indonesian mobile number prefixes (digits after 0/62/+62).
 * Covers all major operators: Telkomsel, Indosat, XL, Tri, Smartfren, etc.
 */
const VALID_MOBILE_PREFIXES = new Set([
  '811', '812', '813', '814', '815', '816', '817', '818', '819',
  '821', '822', '823',
  '831', '832', '833',
  '851', '852', '853',
  '855', '856', '857', '858',
  '877', '878', '879',
  '881', '882', '883', '884', '885', '886', '887', '888', '889',
  '895', '896', '897', '898', '899',
]);

/**
 * Curated dictionary of Indonesian bank names for detection.
 * Includes common abbreviations and full names.
 */
const BANK_NAMES: string[] = [
  'BCA',
  'BNI',
  'BRI',
  'BTN',
  'BSI',
  'Mandiri',
  'Bank Permata',
  'Bank Jago',
  'CIMB Niaga',
  'Danamon',
  'Bank Mega',
  'OCBC NISP',
  'Bank Muamalat',
  'Bank Syariah Indonesia',
  'Bank DKI',
  'Bank BJB',
  'Maybank',
  'HSBC',
  'Standard Chartered',
  'Citibank',
  'Bank Sinarmas',
  'Bank BTPN',
  'Jenius',
  'SeaBank',
  'Bank Neo Commerce',
  'Allo Bank',
  'Bank Raya',
];

/**
 * Common alternative spellings/abbreviations for fuzzy matching.
 * Maps alternative forms to their canonical bank name.
 */
const BANK_NAME_ALIASES: Record<string, string> = {
  'mandiri': 'Mandiri',
  'bank mandiri': 'Mandiri',
  'bank central asia': 'BCA',
  'bank negara indonesia': 'BNI',
  'bank rakyat indonesia': 'BRI',
  'bank tabungan negara': 'BTN',
  'bank syariah indonesia': 'BSI',
  'cimb': 'CIMB Niaga',
  'nisp': 'OCBC NISP',
  'ocbc': 'OCBC NISP',
  'permata': 'Bank Permata',
  'seabank': 'SeaBank',
  'sea bank': 'SeaBank',
  'neo commerce': 'Bank Neo Commerce',
  'bank neo': 'Bank Neo Commerce',
  'btpn': 'Bank BTPN',
  'sinarmas': 'Bank Sinarmas',
  'muamalat': 'Bank Muamalat',
  'jago': 'Bank Jago',
  'mega': 'Bank Mega',
  'allo': 'Allo Bank',
  'raya': 'Bank Raya',
  'danamon': 'Danamon',
  'maybank': 'Maybank',
  'jenius': 'Jenius',
};

/**
 * Indonesian honorific/title prefixes that typically precede a person's name.
 * Used as strong signals for name detection.
 */
const TITLE_PREFIXES = [
  'Bapak', 'Ibu', 'Pak', 'Bu', 'Sdr', 'Sdri', 'Saudara', 'Saudari',
  'Tn', 'Ny', 'Nn', 'Tuan', 'Nyonya', 'Nona',
  'Dr', 'Drg', 'Prof', 'Ir', 'Drs', 'Dra', 'Hj', 'H',
];

/**
 * Common Indonesian words that should NOT be treated as person names.
 * These are stopwords, common nouns, verbs, or location/institution words
 * that happen to be capitalized (e.g., at sentence start).
 */
const NAME_EXCLUSION_SET = new Set([
  // Common sentence starters / conjunctions
  'yang', 'dan', 'atau', 'dengan', 'untuk', 'dari', 'ke', 'di', 'pada',
  'ini', 'itu', 'adalah', 'akan', 'telah', 'sudah', 'belum', 'tidak',
  'saya', 'kami', 'kita', 'mereka', 'anda', 'dia', 'ia',
  'ada', 'bisa', 'dapat', 'harus', 'perlu', 'mau', 'ingin',
  'jika', 'kalau', 'maka', 'karena', 'sebab', 'agar', 'supaya',
  'bahwa', 'seperti', 'namun', 'tetapi', 'tapi', 'juga', 'pun',
  // Common nouns that might be capitalized
  'bank', 'rekening', 'nomor', 'nama', 'alamat', 'tanggal', 'tahun',
  'bulan', 'hari', 'nasabah', 'pelanggan', 'karyawan', 'pegawai',
  'kantor', 'cabang', 'pusat', 'daerah', 'wilayah', 'provinsi',
  'kota', 'kabupaten', 'kecamatan', 'kelurahan', 'desa',
  'jalan', 'jl', 'rt', 'rw',
  'indonesia', 'jakarta', 'surabaya', 'bandung', 'medan', 'semarang',
  'makassar', 'yogyakarta', 'palembang', 'tangerang', 'depok', 'bekasi', 'bogor',
  // English common words
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'are', 'was',
  'has', 'have', 'been', 'will', 'can', 'not', 'but', 'also',
  'please', 'thank', 'thanks', 'dear', 'hello', 'sorry',
  // Financial/business terms
  'transfer', 'pembayaran', 'transaksi', 'saldo', 'kredit', 'debit',
  'tabungan', 'deposito', 'pinjaman', 'cicilan', 'bunga', 'biaya',
  // Date/time words (often capitalized in Indonesian)
  'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu',
  'januari', 'februari', 'maret', 'april', 'mei', 'juni',
  'juli', 'agustus', 'september', 'oktober', 'november', 'desember',
]);

/**
 * Keywords that indicate a banking context for account number detection.
 */
const BANKING_CONTEXT_KEYWORDS = [
  'rekening',
  'rek',
  'no rek',
  'no. rek',
  'nomor rekening',
  'account',
  'account number',
  'acc',
  'no akun',
  'tabungan',
  'giro',
  'transfer ke',
  'transfer dari',
];

/**
 * Represents a raw detection match before placeholder assignment.
 */
interface RawDetection {
  type: PIIEntityType;
  startIndex: number;
  endIndex: number;
  matchedText: string;
}

/**
 * Detect NIK (Nomor Induk Kependudukan) — 16-digit Indonesian national ID.
 * Validates that the first 2 digits are a valid province code.
 * Only matches standalone 16-digit numbers (word boundaries).
 */
export function detectNIK(text: string): RawDetection[] {
  const detections: RawDetection[] = [];
  // Match 16-digit sequences that are not part of longer digit sequences
  const regex = /(?<!\d)\d{16}(?!\d)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const digits = match[0];
    const provinceCode = digits.substring(0, 2);

    if (VALID_PROVINCE_CODES.has(provinceCode)) {
      detections.push({
        type: 'NIK',
        startIndex: match.index,
        endIndex: match.index + digits.length,
        matchedText: digits,
      });
    }
  }

  return detections;
}

/**
 * Detect NO_HP (Indonesian mobile phone numbers).
 * Formats supported:
 *   - +62 followed by 8-12 digits (with optional separators)
 *   - 62 followed by 8-12 digits (with optional separators)
 *   - 08 followed by 8-12 digits (with optional separators)
 *
 * Validates mobile prefix (3 digits after country code) against known operator prefixes.
 * Separators: spaces, dashes, dots are optional between digit groups.
 */
export function detectPhoneNumber(text: string): RawDetection[] {
  const detections: RawDetection[] = [];

  // Pattern: +62 or 62 or 08 followed by digits (with optional separators like -, space, .)
  // Total digits after prefix should be 8-12
  const regex = /(?<!\d)(\+62|62|08)[\s\-.]?(\d[\s\-.]?){7,11}\d(?!\d)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const matchedText = match[0];
    const digits = matchedText.replace(/\D/g, '');
    const digitCount = digits.length;

    // Total digits should be 10-14 (prefix + 8-12 digit number)
    if (digitCount < 10 || digitCount > 14) continue;

    // Extract the mobile prefix (3 digits after the country code)
    // +62812... → prefix is 812
    // 62812...  → prefix is 812
    // 0812...   → prefix is 812
    let mobilePrefix: string;
    if (digits.startsWith('62')) {
      mobilePrefix = digits.substring(2, 5);
    } else if (digits.startsWith('0')) {
      mobilePrefix = digits.substring(1, 4);
    } else {
      continue;
    }

    // Validate against known Indonesian mobile prefixes
    if (VALID_MOBILE_PREFIXES.has(mobilePrefix)) {
      detections.push({
        type: 'NO_HP',
        startIndex: match.index,
        endIndex: match.index + matchedText.length,
        matchedText,
      });
    }
  }

  return detections;
}

/**
 * Detect NO_REKENING (bank account numbers) — 8-15 digit sequences in banking context.
 * A banking context is determined by the presence of banking-related keywords
 * near the digit sequence.
 */
export function detectBankAccount(text: string): RawDetection[] {
  const detections: RawDetection[] = [];
  const lowerText = text.toLowerCase();

  // Find all 8-15 digit sequences
  const digitRegex = /(?<!\d)\d{8,15}(?!\d)/g;
  let match: RegExpExecArray | null;

  while ((match = digitRegex.exec(text)) !== null) {
    const matchedText = match[0];
    const startIndex = match.index;

    // Check if there's a banking context keyword within a window before this number
    // Look back up to 50 characters for context keywords
    const lookbackStart = Math.max(0, startIndex - 50);
    const contextWindow = lowerText.substring(lookbackStart, startIndex);

    const hasBankingContext = BANKING_CONTEXT_KEYWORDS.some(keyword =>
      contextWindow.includes(keyword)
    );

    if (hasBankingContext) {
      detections.push({
        type: 'NO_REKENING',
        startIndex,
        endIndex: startIndex + matchedText.length,
        matchedText,
      });
    }
  }

  return detections;
}

/**
 * Detect NAMA_BANK (Indonesian bank institution names).
 * Uses case-insensitive matching against a curated dictionary.
 * Includes fuzzy matching via aliases (common alternative spellings and abbreviations).
 * Matches whole words/phrases to avoid false positives.
 */
export function detectBankName(text: string): RawDetection[] {
  const detections: RawDetection[] = [];

  // First, match exact bank names (case-insensitive, word boundaries)
  for (const bankName of BANK_NAMES) {
    const escapedName = bankName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escapedName}\\b`, 'gi');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      detections.push({
        type: 'NAMA_BANK',
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        matchedText: match[0],
      });
    }
  }

  // Then, match aliases (fuzzy matching via alternative names/spellings)
  for (const alias of Object.keys(BANK_NAME_ALIASES)) {
    const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escapedAlias}\\b`, 'gi');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      // Avoid duplicate/overlapping detections at positions already covered
      const matchStart = match.index;
      const matchEnd = match.index + match[0].length;
      const alreadyDetected = detections.some(
        d => (matchStart >= d.startIndex && matchStart < d.endIndex) ||
             (matchEnd > d.startIndex && matchEnd <= d.endIndex) ||
             (matchStart <= d.startIndex && matchEnd >= d.endIndex)
      );
      if (!alreadyDetected) {
        detections.push({
          type: 'NAMA_BANK',
          startIndex: match.index,
          endIndex: match.index + match[0].length,
          matchedText: match[0],
        });
      }
    }
  }

  // Sort by startIndex for consistent ordering
  detections.sort((a, b) => a.startIndex - b.startIndex);

  return detections;
}

/**
 * Detect NAMA (person names) using pattern-based heuristics for Indonesian names.
 *
 * Detection strategy: Title-prefixed names only.
 * "Bapak Ahmad Rizky", "Ibu Siti Nurhaliza", "Pak Budi", etc.
 *
 * Avoids false positives by:
 * - Excluding standalone common words from the exclusion list
 * - Not matching words that are part of already-detected entities (bank names, etc.)
 */
export function detectPersonName(text: string): RawDetection[] {
  const detections: RawDetection[] = [];

  // Title prefix followed by capitalized words
  // Build title pattern: (Bapak|Ibu|Pak|Bu|...) followed by 1-4 capitalized words
  const titlePattern = TITLE_PREFIXES
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const titleRegex = new RegExp(
    `(?:^|(?<=\\s|[,.;:!?]))((?:${titlePattern})\\.?)\\s+((?:[A-Z][a-zA-Z']+)(?:\\s+[A-Z][a-zA-Z']+){0,3})`,
    'gm'
  );

  let match: RegExpExecArray | null;
  while ((match = titleRegex.exec(text)) !== null) {
    const fullMatch = match[0];
    const namePartStr = match[2];
    const startIndex = match.index;

    // Validate that the name part words aren't all excluded words
    const nameWords = namePartStr.split(/\s+/);
    const nonExcludedWords = nameWords.filter(
      w => !NAME_EXCLUSION_SET.has(w.toLowerCase())
    );

    // At least one word must not be in the exclusion list
    if (nonExcludedWords.length >= 1) {
      detections.push({
        type: 'NAMA',
        startIndex,
        endIndex: startIndex + fullMatch.length,
        matchedText: fullMatch,
      });
    }
  }

  return detections;
}

/**
 * Run all detectors on the input text and return merged, non-overlapping detections.
 * Detections are sorted by startIndex. When overlaps occur, the longer match wins.
 */
export function detectAll(text: string): RawDetection[] {
  const allDetections: RawDetection[] = [
    ...detectNIK(text),
    ...detectPhoneNumber(text),
    ...detectBankAccount(text),
    ...detectBankName(text),
    ...detectPersonName(text),
  ];

  // Sort by startIndex, then by length descending (longer matches preferred)
  allDetections.sort((a, b) => {
    if (a.startIndex !== b.startIndex) return a.startIndex - b.startIndex;
    return (b.endIndex - b.startIndex) - (a.endIndex - a.startIndex);
  });

  // Remove overlapping detections — keep the first (longest at same position)
  const resolved: RawDetection[] = [];
  let lastEnd = -1;

  for (const detection of allDetections) {
    if (detection.startIndex >= lastEnd) {
      resolved.push(detection);
      lastEnd = detection.endIndex;
    }
  }

  return resolved;
}

/**
 * Assign indexed placeholders to detections.
 * When multiple entities of the same type exist, they get indexed: [TYPE_1], [TYPE_2], etc.
 * When only one entity of a type exists, it still uses [TYPE_1] for consistency.
 */
export function assignPlaceholders(detections: RawDetection[]): DetectedEntity[] {
  // Count occurrences per type
  const typeCounts = new Map<PIIEntityType, number>();
  for (const detection of detections) {
    typeCounts.set(detection.type, (typeCounts.get(detection.type) ?? 0) + 1);
  }

  // Assign indexed placeholders
  const typeIndices = new Map<PIIEntityType, number>();
  const entities: DetectedEntity[] = [];

  for (const detection of detections) {
    const currentIndex = (typeIndices.get(detection.type) ?? 0) + 1;
    typeIndices.set(detection.type, currentIndex);

    const placeholder = `[${detection.type}_${currentIndex}]`;

    entities.push({
      type: detection.type,
      placeholder,
      startIndex: detection.startIndex,
      endIndex: detection.endIndex,
    });
  }

  return entities;
}

/**
 * Mask detected PII entities in the text by replacing them with placeholders.
 * Processes replacements from end to start to preserve index positions.
 */
export function mask(text: string): MaskResult {
  const detections = detectAll(text);

  if (detections.length === 0) {
    return {
      maskedText: text,
      detectedEntities: [],
      entityCount: 0,
    };
  }

  const entities = assignPlaceholders(detections);

  // Replace from end to start to preserve earlier indices
  let maskedText = text;
  for (let i = entities.length - 1; i >= 0; i--) {
    const entity = entities[i];
    maskedText =
      maskedText.substring(0, entity.startIndex) +
      entity.placeholder +
      maskedText.substring(entity.endIndex);
  }

  return {
    maskedText,
    detectedEntities: entities,
    entityCount: entities.length,
  };
}
