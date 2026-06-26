/**
 * PII detection and masking types.
 * @see Requirements 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3
 */

export interface MaskResult {
  maskedText: string;
  detectedEntities: DetectedEntity[];
  entityCount: number;
}

export interface DetectedEntity {
  type: PIIEntityType;
  placeholder: string;
  startIndex: number;
  endIndex: number;
}

export type PIIEntityType = 'NIK' | 'NO_REKENING' | 'NO_HP' | 'NAMA' | 'NAMA_BANK';
