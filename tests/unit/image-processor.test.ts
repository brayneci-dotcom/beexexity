import { describe, it, expect } from 'vitest';
import { processImage } from '../../src/services/image-processor.service.js';
import { ImageFile } from '../../src/types/upload.types.js';

describe('image-processor.service', () => {
  describe('processImage', () => {
    it('should convert a PNG buffer to a base64 ImageContentBlock with format "png"', () => {
      const file: ImageFile = {
        buffer: Buffer.from('fake-png-data'),
        mimetype: 'image/png',
        originalname: 'screenshot.png',
        size: 13,
      };

      const result = processImage(file);

      expect(result).toEqual({
        image: {
          format: 'png',
          source: {
            bytes: Buffer.from('fake-png-data').toString('base64'),
          },
        },
      });
    });

    it('should convert a JPEG buffer to a base64 ImageContentBlock with format "jpeg"', () => {
      const file: ImageFile = {
        buffer: Buffer.from('fake-jpeg-data'),
        mimetype: 'image/jpeg',
        originalname: 'photo.jpg',
        size: 14,
      };

      const result = processImage(file);

      expect(result.image.format).toBe('jpeg');
      expect(result.image.source.bytes).toBe(Buffer.from('fake-jpeg-data').toString('base64'));
    });

    it('should convert a WEBP buffer to a base64 ImageContentBlock with format "webp"', () => {
      const file: ImageFile = {
        buffer: Buffer.from('fake-webp-data'),
        mimetype: 'image/webp',
        originalname: 'image.webp',
        size: 14,
      };

      const result = processImage(file);

      expect(result.image.format).toBe('webp');
      expect(result.image.source.bytes).toBe(Buffer.from('fake-webp-data').toString('base64'));
    });

    it('should throw an error for unsupported MIME types', () => {
      const file = {
        buffer: Buffer.from('fake-gif-data'),
        mimetype: 'image/gif',
        originalname: 'animation.gif',
        size: 13,
      } as unknown as ImageFile;

      expect(() => processImage(file)).toThrow('Unsupported image MIME type: image/gif');
    });

    it('should produce valid base64 that decodes back to the original buffer', () => {
      const originalData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const file: ImageFile = {
        buffer: originalData,
        mimetype: 'image/png',
        originalname: 'test.png',
        size: originalData.length,
      };

      const result = processImage(file);
      const decoded = Buffer.from(result.image.source.bytes, 'base64');

      expect(decoded).toEqual(originalData);
    });
  });
});
