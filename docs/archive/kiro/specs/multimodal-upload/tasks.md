# Implementation Plan: Multimodal Upload Support

## Overview

This implementation adds document (PDF, DOCX) and image (PNG, JPEG, WEBP) upload support to the Unified Inference Gateway. Documents are text-extracted server-side, images are base64-encoded for vision-capable models, and PII masking is applied to all extracted text. The approach is incremental: infrastructure and types first, then core processing services, then route integration, and finally the frontend UI.

## Tasks

- [x] 1. Install Dependencies and Configure Upload Infrastructure
  - [x] 1.1 Install multer, @types/multer, pdf-parse, @types/pdf-parse, and mammoth packages
    - _Requirements: 2.1, 2.2, 3.1_
  - [x] 1.2 Create `/src/config/model-capabilities.ts` with the Model_Capability_Registry mapping each model to `text-only` or `text-and-image`
    - _Requirements: 4.1_
  - [x] 1.3 Create `/src/types/upload.types.ts` with interfaces: `ValidatedUpload`, `DocumentFile`, `ImageFile`, `ExtractionResult`, `ImageContentBlock`, `ContentBlock`, `ContentBuildInput`
    - _Requirements: 1.1, 3.1, 5.1_
  - [x] 1.4 Add `fileCount`, `fileMimeTypes`, `totalFileSize`, and `isMultimodal` optional fields to the `AuditEntry` interface in `/src/types/audit.types.ts`
    - _Requirements: 5.5_
  - [x] 1.5 Create database migration `002_audit_upload_fields.sql` adding nullable columns: `file_count INTEGER`, `file_mime_types TEXT[]`, `total_file_size INTEGER`, `is_multimodal BOOLEAN DEFAULT FALSE` to audit_logs table
    - _Requirements: 5.5_

- [x] 2. Implement Upload Middleware and Validation
  - [x] 2.1 Create `/src/middleware/upload.middleware.ts` with multer configured for memory storage, 10 MB file size limit, max 5 files, and MIME type filtering for PDF, DOCX, PNG, JPEG, WEBP
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6_
  - [x] 2.2 Create `/src/services/upload-validator.service.ts` with `validateAndClassifyFiles()` function that separates files into documents and images, and computes metadata (totalSize, fileCount, mimeTypes)
    - _Requirements: 1.1, 1.2_
  - [x] 2.3 Add multer error handling middleware that converts multer-specific errors (LIMIT_FILE_SIZE, LIMIT_FILE_COUNT, LIMIT_UNEXPECTED_FILE) into standard API error responses
    - _Requirements: 1.4, 1.6_
  - [x]* 2.4 Write unit tests for upload validator: correct classification of documents vs images, rejection of empty file arrays, correct metadata computation
    - _Requirements: 1.1, 1.2_
  - [x]* 2.5 Write property test for MIME type validation: for any arbitrary MIME type string, acceptance iff in allowed set
    - **Property 1: MIME Type Validation Completeness**
    - **Validates: Requirements 1.2, 1.3**
  - [x]* 2.6 Write property test for file size boundary: for any file size, acceptance iff ≤ 10 MB
    - **Property 2: File Size Boundary Enforcement**
    - **Validates: Requirements 1.4, 1.5**
  - [x]* 2.7 Write property test for file count limit: for any count N, acceptance iff N ≤ 5
    - **Property 3: File Count Limit Enforcement**
    - **Validates: Requirements 1.6, 1.7**

- [x] 3. Implement Document Text Extraction
  - [x] 3.1 Create `/src/services/document-extractor.service.ts` with `extractPdfText()` using pdf-parse for buffer-based extraction
    - _Requirements: 2.1, 2.3_
  - [x] 3.2 Implement `extractDocxText()` using mammoth for buffer-based DOCX-to-text extraction with paragraph boundary preservation
    - _Requirements: 2.2, 2.6_
  - [x] 3.3 Implement `extractDocumentText()` router function that dispatches to the correct extractor based on MIME type
    - _Requirements: 2.1, 2.2_
  - [x] 3.4 Handle edge cases: image-only PDFs (return empty text with isEmpty flag), corrupted files (throw descriptive error), empty documents
    - _Requirements: 2.4_
  - [x]* 3.5 Write unit tests for PDF extraction with test fixtures: multi-paragraph PDF, empty PDF, image-only PDF
    - _Requirements: 2.1, 2.4_
  - [x]* 3.6 Write unit tests for DOCX extraction with test fixtures: paragraphs, tables, empty document
    - _Requirements: 2.2, 2.6_
  - [x]* 3.7 Write property test for paragraph boundary preservation: for any document with N paragraphs, extracted text contains appropriate newline separators
    - **Property (subset): Paragraph Boundary Preservation**
    - **Validates: Requirements 2.6**

- [x] 4. Implement Image Processing
  - [x] 4.1 Create `/src/services/image-processor.service.ts` with `processImage()` that converts a buffer to base64 ImageContentBlock with correct format field
    - _Requirements: 3.1, 3.3_
  - [x] 4.2 Implement `processImages()` that processes multiple image files into ordered content blocks
    - _Requirements: 3.4_
  - [x]* 4.3 Write unit tests for image processing: PNG, JPEG, WEBP format detection, correct base64 encoding
    - _Requirements: 3.1_
  - [x]* 4.4 Write property test for base64 round-trip integrity: encode then decode equals original buffer
    - **Property 5: Image Base64 Round-Trip Integrity**
    - **Validates: Requirements 3.1, 3.3**
  - [x]* 4.5 Write property test for image count and order preservation: N images produce N blocks in same order
    - **Property 6: Image Content Block Count and Order Preservation**
    - **Validates: Requirements 3.4**

- [x] 5. Implement Model Compatibility Check
  - [x] 5.1 Implement `supportsImages()` and `getVisionModels()` functions in `/src/config/model-capabilities.ts`
    - _Requirements: 4.1, 4.3_
  - [x]* 5.2 Write unit tests for model capability lookups: each model returns correct capability, vision model list is complete
    - _Requirements: 4.1_
  - [x]* 5.3 Write property test for model compatibility gate: images + text-only model → reject, images + vision model → accept, no images + any model → accept
    - **Property 7: Model Compatibility Gate**
    - **Validates: Requirements 4.3, 4.5**

- [x] 6. Implement Content Block Builder
  - [x] 6.1 Create `/src/services/content-builder.service.ts` with `buildContentBlocks()` that assembles text blocks (prompt, labeled document texts) followed by image blocks
    - _Requirements: 5.1, 5.2, 5.3_
  - [x] 6.2 Implement document text labeling: prepend "Content from uploaded document '{filename}':" before each document's extracted text
    - _Requirements: 5.2_
  - [x] 6.3 Handle edge cases: no prompt (documents/images only), no documents (prompt + images only), multiple documents with separate labels
    - _Requirements: 1.7, 5.1_
  - [x]* 6.4 Write unit tests for content builder with various combinations of inputs
    - _Requirements: 5.1, 5.2, 5.3_
  - [x]* 6.5 Write property test for content block ordering: text blocks always precede image blocks
    - **Property 8: Content Block Ordering Invariant**
    - **Validates: Requirements 5.1**
  - [x]* 6.6 Write property test for document labeling: filename appears in label for every document
    - **Property 9: Document Text Labeling**
    - **Validates: Requirements 5.2**
  - [x]* 6.7 Write property test for empty request rejection: no prompt + no files → error
    - **Property 11: Empty Request Rejection**
    - **Validates: Requirements 5.1**

- [x] 7. Checkpoint - Core services validation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Extend Inference Route for Multipart Requests
  - [x] 8.1 Update `/src/routes/inference.routes.ts` to detect content-type and route to either JSON handler (existing) or multipart handler (new)
    - _Requirements: 5.4_
  - [x] 8.2 Implement `handleMultipartInference()` that: parses multipart, validates uploads, checks model compatibility, extracts document text, masks all text (prompt + document), processes images, builds content blocks, calls inference
    - _Requirements: 1.1, 2.5, 3.1, 4.3, 5.1_
  - [x] 8.3 Update the `generate()` function in inference service to accept content blocks array (not just a single text string) and construct proper Bedrock Converse messages
    - _Requirements: 5.4_
  - [x] 8.4 Ensure memory cleanup in finally block: nullify file buffers after inference completes or fails
    - _Requirements: 2.3, 3.3_
  - [x] 8.5 Update audit logging to include file metadata (fileCount, fileMimeTypes, totalFileSize, isMultimodal) when attachments are present
    - _Requirements: 5.5_
  - [x]* 8.6 Write integration test for end-to-end multipart upload → SSE streaming response
    - _Requirements: 5.4_
  - [x]* 8.7 Write integration test for backward compatibility: JSON text-only requests continue working unchanged
    - _Requirements: 5.4_

- [x] 9. Implement PII Masking Consistency for Document Text
  - [x] 9.1 Update inference route to apply `mask()` from pii-masker.service to each extracted document text individually before passing to content builder
    - _Requirements: 2.5_
  - [x]* 9.2 Write property test for PII masking consistency: same text produces same masked output regardless of source
    - **Property 4: PII Masking Consistency Across Input Sources**
    - **Validates: Requirements 2.5**
  - [x]* 9.3 Write property test for audit metadata completeness without content leakage
    - **Property 10: Audit Metadata Completeness Without Content**
    - **Validates: Requirements 5.5**

- [x] 10. Update Models Route with Capability Info
  - [x] 10.1 Update `/src/routes/models.routes.ts` to include `capability` field ('text-only' | 'text-and-image') in each model's response object
    - _Requirements: 4.1, 4.2_
  - [x]* 10.2 Write unit test verifying models response includes capability for each model
    - _Requirements: 4.1_

- [x] 11. Checkpoint - Backend integration validation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implement Frontend File Upload Interface
  - [x] 12.1 Add file attachment button (paperclip icon) next to the text input area in `public/index.html`
    - _Requirements: 6.1_
  - [x] 12.2 Implement drag-and-drop file handling on the input/message area with visual drop zone indicator
    - _Requirements: 6.1_
  - [x] 12.3 Create attached files preview list showing filename, size, remove button, and thumbnail for images
    - _Requirements: 6.2, 6.3, 6.4_
  - [x] 12.4 Implement client-side file validation: MIME type check, 10 MB size check, max 5 files check with error messages
    - _Requirements: 6.5, 6.6_
  - [x] 12.5 Display model compatibility warning when images are attached and a text-only model is selected (using capability from /models response)
    - _Requirements: 4.2_
  - [x] 12.6 Update `handleSend()` to construct multipart/form-data request when files are attached, with prompt and modelId as form fields
    - _Requirements: 6.7_
  - [x] 12.7 Disable file attachment controls during streaming and show loading state on file previews
    - _Requirements: 6.8_
  - [x] 12.8 Update the model dropdown change handler to re-evaluate compatibility warning when model changes while files are attached
    - _Requirements: 4.2, 4.4_
  - [x] 12.9 Style the file upload UI to match existing dark theme (background: #1e293b, borders: #334155, accent: #3b82f6)
    - _Requirements: 6.1_

- [x] 13. Update Audit Service for File Metadata Persistence
  - [x] 13.1 Update `auditService.log()` in `/src/services/audit.service.ts` to persist new optional fields (file_count, file_mime_types, total_file_size, is_multimodal) to the database
    - _Requirements: 5.5_
  - [x] 13.2 Update the SQL INSERT query to include new columns when present
    - _Requirements: 5.5_
  - [x]* 13.3 Write unit test verifying audit entries with file metadata are persisted correctly and no content is stored
    - _Requirements: 5.5_

- [x] 14. Final checkpoint - Full integration validation
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation between major feature areas
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All file processing is in-memory only — no disk writes for data residency compliance
- The implementation is backward compatible: existing JSON text-only requests continue working unchanged

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5"] },
    { "id": 1, "tasks": ["2.1", "2.2", "5.1", "10.1"] },
    { "id": 2, "tasks": ["2.3", "2.4", "2.5", "2.6", "2.7", "5.2", "5.3", "10.2"] },
    { "id": 3, "tasks": ["3.1", "3.2", "4.1"] },
    { "id": 4, "tasks": ["3.3", "3.4", "4.2"] },
    { "id": 5, "tasks": ["3.5", "3.6", "3.7", "4.3", "4.4", "4.5"] },
    { "id": 6, "tasks": ["6.1", "6.2", "6.3"] },
    { "id": 7, "tasks": ["6.4", "6.5", "6.6", "6.7"] },
    { "id": 8, "tasks": ["8.1", "8.2", "8.3"] },
    { "id": 9, "tasks": ["8.4", "8.5", "9.1"] },
    { "id": 10, "tasks": ["8.6", "8.7", "9.2", "9.3"] },
    { "id": 11, "tasks": ["12.1", "12.2", "12.3", "12.4", "13.1", "13.2"] },
    { "id": 12, "tasks": ["12.5", "12.6", "12.7", "12.8", "12.9", "13.3"] }
  ]
}
```
