# Requirements Document

## Introduction

This document defines the requirements for the Multimodal Upload feature — an additive extension to the existing Unified Inference Gateway that enables users to upload documents (PDF, DOCX) and images (PNG, JPG, WEBP) alongside their text prompts. The feature allows the LLM to read, analyze, and respond to uploaded content such as bank statements, contracts, and screenshots. Document files are text-extracted server-side before inference, while images are sent as native base64 content blocks to AWS Bedrock's Converse API. All file processing occurs in-memory to maintain data residency compliance with no persistent file storage.

## Glossary

- **Gateway**: The Unified Inference Gateway module that routes inference requests to AWS Bedrock
- **File_Processor**: The server-side component that receives uploaded files, validates them, and prepares content for inference (text extraction for documents, base64 encoding for images)
- **Document_Extractor**: The sub-component of File_Processor responsible for extracting plain text from PDF and DOCX files
- **Image_Payload**: A base64-encoded image with its MIME type, formatted as a Bedrock Converse API image content block
- **Content_Block**: A unit of content in the Bedrock Converse API messages array — either a text block or an image block
- **Multimodal_Request**: An inference request that includes one or more uploaded files alongside an optional text prompt
- **Vision_Model**: A model that supports image content blocks in the Bedrock Converse API (openai.gpt-oss-120b-1:0 and qwen.qwen3-235b-a22b-2507-v1:0)
- **Text_Only_Model**: A model that supports only text content blocks (nvidia.nemotron-super-3-120b, qwen.qwen3-32b-v1:0, deepseek.v3-v1:0)
- **PII_Masker**: The pre-processing engine that detects and masks Personally Identifiable Information in text content before inference
- **Bedrock_API**: AWS Bedrock Converse API service in region ap-southeast-3 (Jakarta)

## Requirements

### Requirement 1: File Upload Acceptance

**User Story:** As a banking employee, I want to upload documents and images alongside my text prompt, so that the LLM can analyze the content of my files.

#### Acceptance Criteria

1. WHEN a user submits an inference request with attached files, THE Gateway SHALL accept files with the following MIME types: application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document (DOCX), image/png, image/jpeg, and image/webp.
2. IF a user submits a file with a MIME type not in the accepted list, THEN THE Gateway SHALL reject that file with a validation error specifying the unsupported file type.
3. WHEN a user submits files, THE Gateway SHALL enforce a maximum file size of 10 megabytes per individual file.
4. IF a user submits a file exceeding 10 megabytes, THEN THE Gateway SHALL reject the request with a validation error specifying the file size limit.
5. WHEN a user submits files, THE Gateway SHALL enforce a maximum of 5 files per single inference request.
6. IF a user submits more than 5 files in a single request, THEN THE Gateway SHALL reject the request with a validation error specifying the file count limit.
7. WHEN a user submits an inference request with files but without a text prompt, THE Gateway SHALL accept the request and use a default prompt of "Analyze the attached content."

### Requirement 2: Document Text Extraction

**User Story:** As a banking employee, I want to upload PDF and DOCX documents so the LLM can read their text content, even though Bedrock does not natively support these formats.

#### Acceptance Criteria

1. WHEN a PDF file is uploaded, THE Document_Extractor SHALL extract the text content from all pages of the PDF and produce a plain text representation.
2. WHEN a DOCX file is uploaded, THE Document_Extractor SHALL extract the text content from the document body and produce a plain text representation.
3. THE Document_Extractor SHALL perform all extraction in-memory without writing any file data to disk or persistent storage.
4. IF a PDF or DOCX file contains no extractable text (e.g., a scanned image PDF with no OCR layer), THEN THE Document_Extractor SHALL return an empty text result and THE Gateway SHALL include a notice in the content indicating that no text was extractable from the file.
5. WHEN extracted text is produced from a document, THE PII_Masker SHALL apply PII detection and masking to the extracted text using the same rules applied to user-typed prompts.
6. WHEN a document is processed, THE Document_Extractor SHALL preserve paragraph boundaries from the source document as newline characters in the extracted text.

### Requirement 3: Image Handling

**User Story:** As a banking employee, I want to upload images (screenshots, scanned documents, photos) so the LLM can visually analyze them using its vision capabilities.

#### Acceptance Criteria

1. WHEN an image file (PNG, JPEG, or WEBP) is uploaded, THE File_Processor SHALL encode the image as a base64 string and format it as a Bedrock Converse API image content block with the correct MIME type.
2. THE File_Processor SHALL send image content blocks directly to the Bedrock_API without applying PII masking to the image binary data.
3. THE File_Processor SHALL perform all image encoding in-memory without writing image data to disk or persistent storage.
4. WHEN multiple images are uploaded in a single request, THE File_Processor SHALL include each image as a separate content block in the messages array sent to the Bedrock_API.

### Requirement 4: Model Compatibility Enforcement

**User Story:** As a banking employee, I want to be informed when my selected model cannot process images, so that I do not submit requests that will fail.

#### Acceptance Criteria

1. THE Gateway SHALL classify each available model as either a Vision_Model or a Text_Only_Model based on its image input support: openai.gpt-oss-120b-1:0 and qwen.qwen3-235b-a22b-2507-v1:0 are Vision_Models; nvidia.nemotron-super-3-120b, qwen.qwen3-32b-v1:0, and deepseek.v3-v1:0 are Text_Only_Models.
2. WHEN a user selects a Text_Only_Model in the frontend, THE frontend SHALL disable the image upload control and display a message indicating that the selected model does not support image input.
3. IF a user submits image files with a Text_Only_Model selected, THEN THE Gateway SHALL reject the request with a validation error indicating that the selected model does not support image input.
4. WHEN a user selects a Vision_Model in the frontend, THE frontend SHALL enable the image upload control.
5. THE Gateway SHALL accept document files (PDF, DOCX) regardless of the selected model, because document text extraction produces text content blocks compatible with all models.

### Requirement 5: Multimodal Request Assembly

**User Story:** As a banking employee, I want my text prompt and uploaded files combined into a single coherent request to the LLM, so that the model can reference all provided context.

#### Acceptance Criteria

1. WHEN an inference request contains a text prompt and one or more files, THE Gateway SHALL assemble the Bedrock Converse API messages array with the text prompt as the first content block, followed by extracted document text blocks, followed by image content blocks.
2. WHEN an inference request contains extracted document text, THE Gateway SHALL include the masked document text as text content blocks with a prefix label identifying the source filename.
3. WHEN an inference request contains images, THE Gateway SHALL include each image as an image content block in the messages array.
4. THE Gateway SHALL send the assembled multimodal messages array to the Bedrock_API using the same ConverseStream command and SSE streaming mechanism used for text-only requests.
5. WHEN a multimodal inference request completes, THE Audit_Logger SHALL record the same metadata fields as text-only requests plus an additional field indicating the count and types of attached files.

### Requirement 6: Frontend File Upload Interface

**User Story:** As a banking employee, I want a file attachment button in the chat interface, so that I can easily select and preview files before sending my prompt.

#### Acceptance Criteria

1. THE frontend SHALL display a file attachment button adjacent to the prompt input area that opens a file picker dialog filtered to accepted file types (PDF, DOCX, PNG, JPG, WEBP).
2. WHEN a user selects files via the file picker, THE frontend SHALL display a preview area showing the filename, file size, and file type for each selected file.
3. WHEN a user selects image files, THE frontend SHALL display a thumbnail preview of each image in the preview area.
4. THE frontend SHALL allow the user to remove individual files from the selection before submitting the request.
5. THE frontend SHALL enforce the 10 megabyte per-file limit client-side and display an error message if a user selects a file exceeding the limit.
6. THE frontend SHALL enforce the 5-file maximum client-side and display an error message if a user attempts to attach more than 5 files.
7. WHEN the user submits a request with attached files, THE frontend SHALL send the files as base64-encoded data in the request body using a JSON payload structure.
8. WHILE a multimodal inference request is streaming, THE frontend SHALL display the file attachments in the user message bubble alongside the prompt text.

