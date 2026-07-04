import type { ValidatedUpload, DocumentFile, ImageFile } from '../types/upload.types.js';

/**
 * Upload validator service — classifies files into documents and images,
 * and computes upload metadata.
 * @see Requirements 1.1, 1.2
 */

const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/html',
  'text/markdown',
  'application/json',
  'text/csv',
  'text/plain',
  'application/xml',
  'text/xml',
] as const;

const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

/**
 * Validate and classify uploaded files into documents and images.
 * Computes metadata including total size, file count, and distinct MIME types.
 *
 * @param files - Array of multer file objects from the request
 * @returns Validated upload containing classified files and metadata
 * @throws Error if no files are provided
 */
export function validateAndClassifyFiles(files: Express.Multer.File[]): ValidatedUpload {
  if (!files || files.length === 0) {
    throw new Error('No files provided');
  }

  const documents: DocumentFile[] = [];
  const images: ImageFile[] = [];

  for (const file of files) {
    if ((DOCUMENT_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      documents.push({
        buffer: file.buffer,
        mimetype: file.mimetype,
        originalname: file.originalname,
        size: file.size,
      });
    } else if ((IMAGE_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      images.push({
        buffer: file.buffer,
        mimetype: file.mimetype as ImageFile['mimetype'],
        originalname: file.originalname,
        size: file.size,
      });
    }
    // Files that don't match either category have already been filtered by multer
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const mimeTypes = [...new Set(files.map(f => f.mimetype))];

  return {
    documents,
    images,
    totalSize,
    fileCount: files.length,
    mimeTypes,
  };
}
