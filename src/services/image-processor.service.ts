import { ImageFile, ImageContentBlock } from '../types/upload.types.js';

/**
 * Map MIME type to Bedrock image format identifier.
 */
function mimeToFormat(mimetype: string): 'png' | 'jpeg' | 'webp' {
  switch (mimetype) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpeg';
    case 'image/webp':
      return 'webp';
    default:
      throw new Error(`Unsupported image MIME type: ${mimetype}`);
  }
}

/**
 * Convert an image file buffer to a Bedrock-compatible image content block.
 * Preserves original format (no conversion).
 * All processing is in-memory (no disk I/O).
 */
export function processImage(file: ImageFile): ImageContentBlock {
  return {
    image: {
      format: mimeToFormat(file.mimetype),
      source: {
        bytes: file.buffer.toString('base64'),
      },
    },
  };
}

/**
 * Process multiple images into ordered content blocks.
 * Images are processed in the order provided (preserving upload order).
 */
export function processImages(files: ImageFile[]): ImageContentBlock[] {
  return files.map(processImage);
}
