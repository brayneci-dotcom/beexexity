/**
 * Upload and multimodal content types.
 * @see Requirements 1.1, 3.1, 5.1
 */

export interface DocumentFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

export interface ImageFile {
  buffer: Buffer;
  mimetype: 'image/png' | 'image/jpeg' | 'image/webp';
  originalname: string;
  size: number;
}

export interface ValidatedUpload {
  documents: DocumentFile[];
  images: ImageFile[];
  totalSize: number;
  fileCount: number;
  mimeTypes: string[];
}

export interface ExtractionResult {
  text: string;
  filename: string;
  isEmpty: boolean;
}

export interface ImageContentBlock {
  image: {
    format: 'png' | 'jpeg' | 'webp';
    source: {
      bytes: string; // base64-encoded
    };
  };
}

export interface DocumentContentBlock {
  document: {
    format: 'pdf' | 'docx';
    name: string;
    source: {
      bytes: string; // base64-encoded
    };
  };
}

export type TextContentBlock = { text: string };
export type ContentBlock = TextContentBlock | ImageContentBlock | DocumentContentBlock;

export interface ContentBuildInput {
  maskedPrompt?: string;
  documentExtractions: Array<{ text: string; filename: string }>;
  imageBlocks: ImageContentBlock[];
  /** Document buffers for OCR fallback when text extraction returns empty */
  documentBlocks?: DocumentContentBlock[];
}
