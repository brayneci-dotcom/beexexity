import { describe, it, expect } from 'vitest';
import { detectPersonName, detectAll, mask } from '../../src/services/pii-masker.service.js';

describe('PII Masker - Person Name Detection (NAMA)', () => {
  describe('detectPersonName', () => {
    describe('title-prefixed names', () => {
      it('should detect names prefixed with "Bapak"', () => {
        const text = 'Tolong hubungi Bapak Ahmad Rizky mengenai laporan ini';
        const detections = detectPersonName(text);

        expect(detections).toHaveLength(1);
        expect(detections[0].type).toBe('NAMA');
        expect(detections[0].matchedText).toBe('Bapak Ahmad Rizky');
      });

      it('should detect names prefixed with "Ibu"', () => {
        const text = 'Ibu Siti Nurhaliza telah mengajukan permohonan';
        const detections = detectPersonName(text);

        expect(detections).toHaveLength(1);
        expect(detections[0].type).toBe('NAMA');
        expect(detections[0].matchedText).toBe('Ibu Siti Nurhaliza');
      });

      it('should detect names prefixed with "Pak"', () => {
        const text = 'Sampaikan kepada Pak Budi Santoso segera';
        const detections = detectPersonName(text);

        expect(detections).toHaveLength(1);
        expect(detections[0].type).toBe('NAMA');
        expect(detections[0].matchedText).toBe('Pak Budi Santoso');
      });

      it('should detect names prefixed with "Bu"', () => {
        const text = 'Menurut Bu Dewi Lestari hal ini sudah sesuai';
        const detections = detectPersonName(text);

        expect(detections).toHaveLength(1);
        expect(detections[0].type).toBe('NAMA');
        expect(detections[0].matchedText).toBe('Bu Dewi Lestari');
      });

      it('should detect names prefixed with "Tn" (Tuan)', () => {
        const text = 'Nasabah atas nama Tn Hendro Gunawan';
        const detections = detectPersonName(text);

        expect(detections).toHaveLength(1);
        expect(detections[0].type).toBe('NAMA');
        expect(detections[0].matchedText).toBe('Tn Hendro Gunawan');
      });

      it('should detect names prefixed with "Ny" (Nyonya)', () => {
        const text = 'Akun milik Ny Ratna Dewi Putri perlu diverifikasi';
        const detections = detectPersonName(text);

        expect(detections).toHaveLength(1);
        expect(detections[0].type).toBe('NAMA');
        expect(detections[0].matchedText).toBe('Ny Ratna Dewi Putri');
      });

      it('should detect names prefixed with "Dr"', () => {
        const text = 'Dr Andi Pratama menyetujui transaksi';
        const detections = detectPersonName(text);

        expect(detections).toHaveLength(1);
        expect(detections[0].type).toBe('NAMA');
        expect(detections[0].matchedText).toBe('Dr Andi Pratama');
      });
    });

    describe('capitalized word sequences (without titles)', () => {
      it('should NOT detect capitalized words without a title prefix', () => {
        const text = 'Nasabah bernama Ahmad Rizky telah konfirmasi';
        const detections = detectPersonName(text);

        // Strategy 2 (capitalized word sequences without titles) removed —
        // only title-prefixed names (Bapak/Ibu/etc.) are detected
        expect(detections).toHaveLength(0);
      });

      it('should NOT detect 3 capitalized words without a title prefix', () => {
        const text = 'Transfer dari Siti Nur Aisyah berhasil';
        const detections = detectPersonName(text);

        expect(detections).toHaveLength(0);
      });

      it('should NOT detect 4 capitalized words without a title prefix', () => {
        const text = 'Data milik Muhammad Rizky Andi Pratama sudah diupdate';
        const detections = detectPersonName(text);

        expect(detections).toHaveLength(0);
      });
    });

    describe('false positive avoidance', () => {
      it('should NOT detect standalone common Indonesian words', () => {
        const text = 'Yang Perlu Dilakukan adalah mengisi formulir';
        const detections = detectPersonName(text);

        // "Yang" is excluded, the sequence should not match
        expect(detections).toHaveLength(0);
      });

      it('should NOT detect bank names as person names', () => {
        const text = 'Silakan transfer ke Bank Permata';
        const detections = detectPersonName(text);

        expect(detections).toHaveLength(0);
      });

      it('should NOT detect location names in the exclusion set', () => {
        const text = 'Kantor kami di Jakarta Pusat buka setiap hari';
        const detections = detectPersonName(text);

        // "Jakarta" and "Pusat" are in exclusion set
        expect(detections).toHaveLength(0);
      });
    });

    describe('multiple names in same text', () => {
      it('should detect multiple distinct person names', () => {
        const text = 'Bapak Ahmad Susanto dan Ibu Ratna Sari menghadiri rapat';
        const detections = detectPersonName(text);

        expect(detections).toHaveLength(2);
        expect(detections[0].matchedText).toBe('Bapak Ahmad Susanto');
        expect(detections[1].matchedText).toBe('Ibu Ratna Sari');
      });
    });
  });

  describe('mask() integration with NAMA detection', () => {
    it('should mask person names with indexed placeholders', () => {
      const text = 'Bapak Ahmad Rizky mengirim transfer ke Ibu Siti Dewi';
      const result = mask(text);

      expect(result.maskedText).toContain('[NAMA_1]');
      expect(result.maskedText).toContain('[NAMA_2]');
      expect(result.maskedText).not.toContain('Ahmad Rizky');
      expect(result.maskedText).not.toContain('Siti Dewi');
    });

    it('should assign unique indexed placeholders per type', () => {
      const text = 'Pak Budi dan Bu Ani hadir';
      const result = mask(text);

      const namaEntities = result.detectedEntities.filter(e => e.type === 'NAMA');
      expect(namaEntities.length).toBeGreaterThanOrEqual(2);

      const placeholders = namaEntities.map(e => e.placeholder);
      expect(placeholders[0]).toBe('[NAMA_1]');
      expect(placeholders[1]).toBe('[NAMA_2]');
    });

    it('should not mask text when no PII is found', () => {
      const text = 'tolong bantu saya cek saldo rekening';
      const result = mask(text);

      expect(result.maskedText).toBe(text);
      expect(result.detectedEntities).toHaveLength(0);
      expect(result.entityCount).toBe(0);
    });

    it('should handle names alongside other PII types', () => {
      const text = 'Bapak Ahmad Susanto dengan NIK 3201012345678901 menghubungi +6281234567890';
      const result = mask(text);

      expect(result.maskedText).toContain('[NAMA_1]');
      expect(result.maskedText).toContain('[NIK_1]');
      expect(result.maskedText).toContain('[NO_HP_1]');
      expect(result.maskedText).not.toContain('Ahmad Susanto');
      expect(result.maskedText).not.toContain('3201012345678901');
    });
  });
});
