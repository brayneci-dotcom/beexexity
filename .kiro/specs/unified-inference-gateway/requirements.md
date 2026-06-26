# Requirements Document

## Introduction

This document defines the requirements for the Unified Inference Gateway — a built-in module for an internal banking application that provides access to multiple LLM models via AWS Bedrock in the Jakarta region (ap-southeast-3). The gateway replaces Google Gemini Enterprise and enforces Indonesian financial data sovereignty regulations (OJK/Bank Indonesia) through mandatory one-way PII masking, local authentication, and region-locked processing. Users select models manually from a dropdown interface with no recommendation engine involved.

## Glossary

- **Gateway**: The Unified Inference Gateway module that routes inference requests to AWS Bedrock
- **Bedrock_API**: AWS Bedrock Converse API service in region ap-southeast-3 (Jakarta)
- **PII_Masker**: The pre-processing engine that detects and masks Personally Identifiable Information in prompts before they are sent to the model
- **Auth_Service**: The authentication and authorization service that validates credentials and issues JWT tokens
- **Whitelist_DB**: The local database containing approved user accounts, credentials, and roles
- **Audit_Logger**: The component that records interaction metadata to the local audit database
- **JWT**: JSON Web Token used for session authentication after login
- **PII**: Personally Identifiable Information — sensitive data including NIK, account numbers, phone numbers, person names, and bank names
- **NIK**: Nomor Induk Kependudukan — Indonesian national identification number (16 digits)
- **Placeholder**: An anonymized token (e.g., `[NIK]`, `[NO_REKENING]`, `[NAMA]`) that replaces detected PII in masked prompts
- **SSE**: Server-Sent Events — a protocol for streaming real-time token-by-token responses to clients
- **Model_ID**: The specific AWS Bedrock model identifier used for routing inference requests
- **On_Demand_Pricing**: AWS Bedrock billing model where charges are calculated per input/output token without provisioned capacity
- **Pricing_Config**: A local, read-only configuration file containing the cost per 1 million tokens (input and output) for each supported Model_ID, denominated in USD

## Requirements

### Requirement 1: User Authentication

**User Story:** As a banking employee, I want to authenticate with my username and password, so that I can securely access the inference gateway.

#### Acceptance Criteria

1. WHEN a user submits valid credentials (username and password), THE Auth_Service SHALL validate the credentials against the Whitelist_DB and return a signed JWT containing the user ID, username, and role.
2. WHEN a user submits invalid credentials, THE Auth_Service SHALL return an authentication error without revealing whether the username or password was incorrect.
3. THE Auth_Service SHALL issue JWT tokens with a configurable expiry duration.
4. WHEN a request is received at any inference endpoint, THE Gateway SHALL validate the JWT signature and expiry before processing the request.
5. IF a JWT is expired or invalid, THEN THE Gateway SHALL reject the request with an HTTP 401 status and a descriptive error message.

### Requirement 2: User Management

**User Story:** As an administrator, I want to register new users and manage their profiles, so that I can control who has access to the inference gateway.

#### Acceptance Criteria

1. WHEN an admin submits a user registration request with username, password, and role, THE Auth_Service SHALL create a new entry in the Whitelist_DB and return the created user profile (excluding the password).
2. WHEN an admin submits an update request for a user, THE Auth_Service SHALL update the specified profile fields (role, display name) in the Whitelist_DB.
3. IF a registration request contains a username that already exists in the Whitelist_DB, THEN THE Auth_Service SHALL reject the request with a conflict error.
4. THE Auth_Service SHALL restrict user management endpoints to authenticated users with the admin role.

### Requirement 3: PII Detection

**User Story:** As a compliance officer, I want all prompts scanned for sensitive data before reaching the LLM, so that customer PII is never exposed to third-party models.

#### Acceptance Criteria

1. WHEN a prompt is submitted for inference, THE PII_Masker SHALL scan the prompt text and detect the following PII entity types: NIK (16-digit Indonesian national ID), bank account numbers, phone numbers (Indonesian formats), person names, and bank institution names.
2. THE PII_Masker SHALL use Named Entity Recognition (NER) or calibrated regular expressions to identify PII entities.
3. WHEN multiple PII entities of the same type are detected in a single prompt, THE PII_Masker SHALL assign unique indexed placeholders to each occurrence (e.g., `[NAMA_1]`, `[NAMA_2]`).
4. IF the PII_Masker detects no PII entities in a prompt, THEN THE PII_Masker SHALL pass the prompt through unchanged.

### Requirement 4: PII Masking (Pre-processing)

**User Story:** As a compliance officer, I want detected PII replaced with safe placeholders before the prompt reaches AWS Bedrock, so that no sensitive data leaves the application boundary.

#### Acceptance Criteria

1. WHEN PII entities are detected in a prompt, THE PII_Masker SHALL replace each entity with its corresponding placeholder token (e.g., NIK → `[NIK]`, account number → `[NO_REKENING]`, phone → `[NO_HP]`, person name → `[NAMA]`, bank name → `[NAMA_BANK]`).
2. THE PII_Masker SHALL complete masking before the prompt is forwarded to the Bedrock_API.
3. THE PII_Masker SHALL preserve the grammatical structure and readability of the masked prompt so that the LLM can produce a coherent response.
4. THE PII_Masker SHALL treat masking as a one-way operation — masked data is not restored in responses returned to the user.

### Requirement 5: Manual Model Selection

**User Story:** As a banking employee, I want to select a model from a dropdown of available options, so that I have full control over which model processes my prompt.

#### Acceptance Criteria

1. THE Gateway SHALL provide a dropdown list of all 5 available models: nvidia.nemotron-super-3-120b, openai.gpt-oss-120b-1:0, qwen.qwen3-235b-a22b-2507-v1:0, qwen.qwen3-32b-v1:0, and deepseek.v3-v1:0.
2. THE Gateway SHALL pre-select qwen.qwen3-32b-v1:0 as the default model in the dropdown.
3. WHEN a user submits an inference request with a Model_ID, THE Gateway SHALL use the user-specified model for inference.
4. IF a user submits an inference request without specifying a Model_ID, THEN THE Gateway SHALL use qwen.qwen3-32b-v1:0 as the default model.
5. IF a user specifies a Model_ID that is not in the available model list, THEN THE Gateway SHALL reject the request with a validation error.

### Requirement 6: Inference Routing

**User Story:** As a banking employee, I want my prompts processed by the selected LLM model, so that I receive AI-generated responses for my banking tasks.

#### Acceptance Criteria

1. WHEN a masked prompt and Model_ID are ready for inference, THE Gateway SHALL send the request to the Bedrock_API using the Converse API in region ap-southeast-3.
2. THE Gateway SHALL include the user-selected Model_ID in the Bedrock_API request to route to the correct model.
3. THE Gateway SHALL support streaming responses via Server-Sent Events (SSE) so that tokens are delivered to the client in real-time as they are generated.
4. IF the Bedrock_API returns a throttling error, THEN THE Gateway SHALL retry the request using exponential backoff with a maximum of 3 retry attempts.
5. IF the Bedrock_API returns an error after all retry attempts are exhausted, THEN THE Gateway SHALL return a clear error message to the user indicating the failure reason without exposing internal system details.
6. IF the Bedrock_API times out, THEN THE Gateway SHALL return a timeout error message to the user without attempting auto-fallback to another model.

### Requirement 7: Data Residency Compliance

**User Story:** As a compliance officer, I want all data processing confined to the Jakarta AWS region, so that the application satisfies OJK and Bank Indonesia data sovereignty regulations.

#### Acceptance Criteria

1. THE Gateway SHALL send all inference requests exclusively to AWS Bedrock in region ap-southeast-3 (Jakarta).
2. THE Gateway SHALL store all persistent data (Whitelist_DB, audit logs) within AWS resources located in region ap-southeast-3.
3. THE Gateway SHALL use AWS Bedrock configurations that enforce zero data retention — model providers do not use input data for training.
4. THE Gateway SHALL encrypt all data at-rest using AWS KMS keys located in region ap-southeast-3.
5. THE Gateway SHALL encrypt all data in-transit using TLS version 1.2 or higher.

### Requirement 8: Audit Logging

**User Story:** As a compliance officer, I want interaction metadata recorded for every inference request, so that usage can be audited without storing sensitive content.

#### Acceptance Criteria

1. WHEN an inference request completes (success or failure), THE Audit_Logger SHALL record the following metadata: timestamp, user ID, username, selected Model_ID, input token count, output token count, and request status (success or failed).
2. THE Audit_Logger SHALL NOT store the full prompt text or the full response text in the audit log.
3. THE Audit_Logger SHALL persist audit records to a database within region ap-southeast-3.
4. WHEN an inference request fails, THE Audit_Logger SHALL record the error category (e.g., throttling, timeout, model error) without logging the prompt or response content.

### Requirement 9: Live Session Cost Display (Frontend Only)

**User Story:** As a banking employee, I want to see my estimated token usage and running cost displayed live in the interface while I use the gateway, so that I can monitor my consumption in real-time.

#### Acceptance Criteria

1. THE frontend SHALL read pricing data from the local, read-only Pricing_Config that defines the cost per 1 million tokens (input and output) for each supported Model_ID in USD.
2. WHEN a streaming inference response is in progress, THE frontend SHALL display a live-updating counter showing the accumulated input token count and output token count for the current request.
3. WHEN token counts are updated, THE frontend SHALL calculate and display the estimated cost in USD based on the selected Model_ID's rates from the Pricing_Config (cost = tokens × rate per 1M tokens / 1,000,000).
4. THE frontend SHALL display a running session total that is the sum of individual request costs across all inference requests made during the current user session, where each request's cost is calculated independently using the model and token counts for that specific request.
5. WHEN the user switches models in the dropdown, THE frontend SHALL update the per-token rate display to reflect the newly selected model's pricing from the Pricing_Config, and SHALL continue accumulating cost additively — the session total equals the sum of each request's cost calculated at its own model's rate, not a recalculation of all tokens at the new model's rate.
6. THE frontend SHALL render cost information in a non-intrusive UI element (e.g., status bar or side panel) that does not obstruct the main prompt/response interaction area.
7. IF the Pricing_Config is unavailable or cannot be read, THEN THE frontend SHALL display token counts only without cost estimates and show a warning indicator.
