# Requirements Document

## Introduction

This document defines requirements for a set of enhancements to the Unified Inference Gateway. The changes span four areas: (1) mandatory password reset on first login, (2) a frontend UI overhaul to match the beexexity design language defined in sampleui.html, (3) removal of DeepSeek V3 from all model registries and routing paths, and (4) implementation of automatic model routing with prompt refinement, complexity scoring, and policy-based model selection. All changes operate within the existing banking compliance constraints: processing confined to AWS Bedrock in ap-southeast-3, PII masking mandatory before any model invocation, and audit logging preserved.

## Glossary

- **Gateway**: The Unified Inference Gateway server application handling authentication, inference routing, and streaming responses.
- **Auth_Service**: The backend service responsible for credential validation, JWT issuance, and user management.
- **Chat_UI**: The single-page frontend application served at public/index.html providing login, model selection, file upload, and chat interaction.
- **Routing_Engine**: The server-side component that refines prompts, evaluates complexity, checks modality and policy constraints, and produces the final routing decision.
- **Complexity_Score**: An integer score from 1 to 5 representing the estimated reasoning difficulty of a request.
- **Refined_Prompt**: A cleaned, model-facing reformulation of the original user request and eligible extracted context.
- **Routing_State**: The request-level routing mode; allowed values are `auto` and `manual`.
- **Routing_Decision**: The final routing outcome including executed model, routing state, reason code, modality flags, and whether manual override was applied.
- **Modality_Flags**: Derived request attributes indicating text-only, document-text, image, or mixed input.
- **Vision_Model**: A model that accepts image content in addition to text.
- **Reasoning_Summary**: A concise explanation of why a routing decision was made; not full chain-of-thought.
- **Capability_Registry**: The existing model-capabilities configuration (MODEL_CAPABILITIES) identifying whether a model supports text only or text and image.
- **First_Login_Flag**: A boolean database column indicating whether a user has completed their initial password change after account creation.
- **ALLOWED_MODELS**: The server-side constant array defining which model IDs are valid for inference requests.

## Requirements

---

### Requirement 1: Force Password Reset on First Login

**User Story:** As a platform administrator, I want newly created users to be required to change their password on first login, so that admin-assigned temporary passwords are never used beyond initial authentication.

#### Acceptance Criteria

1. WHEN a new user account is created, THE Auth_Service SHALL set the First_Login_Flag to `true` in the user record.
2. WHEN a user authenticates successfully and the First_Login_Flag is `true`, THE Auth_Service SHALL return a response indicating that a password change is required instead of a standard session token.
3. WHILE the First_Login_Flag is `true`, THE Gateway SHALL reject all non-authentication API requests from the user with an HTTP 403 status and a message indicating password change is required.
4. THE Auth_Service SHALL provide a password-change endpoint that accepts the current password and a new password.
5. WHEN the user submits a valid password change through the password-change endpoint, THE Auth_Service SHALL hash the new password, update the stored credential, set First_Login_Flag to `false`, and return a valid session token.
6. THE Auth_Service SHALL validate that the new password differs from the current password.
7. THE Auth_Service SHALL validate that the new password meets a minimum length of 8 characters.
8. IF the password change request contains an incorrect current password, THEN THE Auth_Service SHALL reject the request with HTTP 401 and a generic authentication error.
9. THE Chat_UI SHALL display a password-change form when the login response indicates a required password reset, preventing access to the chat interface until the reset is completed.

---

### Requirement 2: UI Overhaul — Dark Theme and Layout

**User Story:** As a user, I want a modern dark-themed interface with improved visual hierarchy, so that the chat experience is comfortable for extended use and visually consistent with the beexexity brand.

#### Acceptance Criteria

1. THE Chat_UI SHALL use CSS custom properties for theming with the following base values: `--bg-primary: #0f0f0f`, `--bg-secondary: #1a1a1a`, `--bg-tertiary: #262626`, `--accent: #b5e4f7`, `--text-primary: #ffffff`, `--text-secondary: #a0a0a0`, `--border: #2a2a2a`.
2. THE Chat_UI SHALL display the login screen with a centered card on a gradient background (`linear-gradient(135deg, #0f0f0f 0%, #1a1a2e 100%)`), rounded inputs with 12px border-radius, and an accent-colored login button.
3. THE Chat_UI SHALL display a sticky header with a backdrop-blur effect (`backdrop-filter: blur(12px)`) containing the "beexexity" logo text rendered with a gradient fill on the left side.
4. THE Chat_UI SHALL display a user avatar circle in the header showing the first letter of the user display name, styled with a gradient background matching the accent color.
5. THE Chat_UI SHALL constrain the message area to a maximum width of 800px, centered horizontally, with 2rem padding.
6. THE Chat_UI SHALL render user messages as right-aligned dark cards (background `var(--bg-secondary)`, border-radius 16px with bottom-right corner at 4px).
7. THE Chat_UI SHALL render assistant messages as left-aligned plain text with proper formatting for bold, inline code, and code blocks, without a visible card container.
8. THE Chat_UI SHALL display an empty state centered in the message area with the heading "How can I help you today?" and a descriptive subtitle when no messages exist.
9. THE Chat_UI SHALL position the input area at the bottom with a sticky container, max-width 800px, containing a rounded card (border-radius 16px) with the textarea, model select, attach button, and send button arranged inside.
10. THE Chat_UI SHALL use a plus icon (two perpendicular lines) for the file-attach button instead of a paperclip icon.
11. THE Chat_UI SHALL display the model-select dropdown inside the input card area adjacent to the send button, styled with the secondary background color.
12. THE Chat_UI SHALL animate the send button to show a rotating spinner SVG while a response is streaming, and revert to the send arrow icon when streaming completes.
13. THE Chat_UI SHALL apply a fade-in animation (opacity 0 to 1, translateY 10px to 0, 0.3s ease) to each newly added message.

---

### Requirement 3: Remove DeepSeek V3 Model

**User Story:** As a platform operator, I want DeepSeek V3 removed from all available model lists and routing paths, so that no inference requests are sent to this model.

#### Acceptance Criteria

1. THE Gateway SHALL remove `deepseek.v3-v1:0` from the ALLOWED_MODELS array in inference types.
2. THE Gateway SHALL remove the `deepseek.v3-v1:0` entry from the MODEL_CAPABILITIES registry.
3. THE Chat_UI SHALL NOT display `deepseek.v3-v1:0` in the model selection dropdown.
4. WHEN a request specifies `deepseek.v3-v1:0` as the modelId, THE Gateway SHALL reject the request with an INVALID_MODEL error and HTTP 400 status.
5. THE Routing_Engine SHALL NOT route any request to `deepseek.v3-v1:0` under any routing policy.

---

### Requirement 4: Prompt Refinement

**User Story:** As a banking employee, I want the system to refine my raw request into a clearer model-facing prompt, so that downstream model execution is more consistent without requiring me to write perfect prompts.

#### Acceptance Criteria

1. WHEN a user submits a request in `auto` routing state, THE Routing_Engine SHALL generate a Refined_Prompt before final model selection.
2. THE Routing_Engine SHALL incorporate the original user prompt and any already-extracted, already-masked document text into the Refined_Prompt when attachments are present.
3. THE Routing_Engine SHALL NOT include raw unmasked PII in the Refined_Prompt.
4. IF prompt refinement fails, THEN THE Gateway SHALL continue using the original masked prompt and record a `refinement-failed` routing flag in metadata.
5. THE Gateway SHALL include the Refined_Prompt in the inference response metadata when routing metadata is enabled.

---

### Requirement 5: Complexity Scoring

**User Story:** As a platform owner, I want each request scored by complexity, so that the gateway can consistently distinguish inexpensive requests from expensive reasoning tasks.

#### Acceptance Criteria

1. WHEN a request is received in `auto` routing state, THE Routing_Engine SHALL assign a Complexity_Score from 1 to 5.
2. THE Complexity_Score SHALL be derived from the request text and any extracted document context that is eligible for inference.
3. THE Gateway SHALL interpret the score bands as: 1 to 3 for direct-answer lane, 4 for stronger reasoning lane, 5 for advanced reasoning lane.
4. THE Routing_Engine SHALL emit machine-readable routing metadata that includes the score, score band, and confidence indicator.
5. IF scoring fails, THEN THE Gateway SHALL default the Complexity_Score to 2 and log the event as a warning.

---

### Requirement 6: Routing State and Auto/Manual Selection

**User Story:** As a banking employee, I want the gateway to default to automatic routing while still allowing me to explicitly choose a model when needed, so that I get efficient default behavior without losing manual control.

#### Acceptance Criteria

1. THE Gateway SHALL support two routing states: `auto` and `manual`.
2. THE default Routing_State SHALL be `auto` for every new request when no explicit model is selected.
3. WHEN the user does not select a specific model from the dropdown (default option remains selected), THE Gateway SHALL keep the request in `auto` state and THE Routing_Engine SHALL determine the execution model.
4. WHEN the user selects a specific model from the dropdown, THE Gateway SHALL set the request to `manual` state and use the selected model as the execution target.
5. IN `manual` state, THE Gateway SHALL use the user-selected Model_ID as the execution target, subject to existing validation and modality compatibility rules.
6. THE Routing_State SHALL be determined per request and SHALL NOT permanently alter session behavior.
7. THE active Routing_State SHALL be included in routing metadata returned in the inference response.

---

### Requirement 7: Text-Only Routing Policy

**User Story:** As a platform owner, I want text-only requests routed according to reasoning difficulty, so that routine traffic uses cost-effective models and harder requests use stronger models.

#### Acceptance Criteria

1. THE Routing_Engine SHALL consider only the following models for text routing decisions: `nvidia.nemotron-super-3-120b`, `openai.gpt-oss-120b-1:0`, `qwen.qwen3-235b-a22b-2507-v1:0`, `qwen.qwen3-32b-v1:0`.
2. WHEN a request is text-only and Complexity_Score is 1 to 3, THE Routing_Engine SHALL select `qwen.qwen3-32b-v1:0` as the execution model in `auto` state.
3. WHEN a request is text-only and Complexity_Score is 4, THE Routing_Engine SHALL select `nvidia.nemotron-super-3-120b` as the execution model in `auto` state.
4. WHEN a request is text-only and Complexity_Score is 5, THE Routing_Engine SHALL select `qwen.qwen3-235b-a22b-2507-v1:0` as the execution model in `auto` state.
5. THE Gateway SHALL preserve compatibility with manual model-selection behavior for all supported models and SHALL continue to reject unsupported Model_ID values using the existing validation path.

---

### Requirement 8: Multimodal-Aware Routing

**User Story:** As a banking employee uploading files, I want routing decisions to respect attachment type and model capability, so that requests are not sent to models that cannot process them.

#### Acceptance Criteria

1. WHEN image attachments are present and the request is in `auto` state, THE Routing_Engine SHALL select only from Vision_Model entries in the Capability_Registry.
2. IF the request is in `manual` state and the selected model is text-only while image attachments are present, THEN THE Gateway SHALL reject the request with a compatibility validation error.
3. WHEN document uploads are present without images, THE Routing_Engine SHALL treat the request as text-augmented after extraction and masking, not as a vision request.
4. THE Routing_Engine SHALL expose Modality_Flags in the routing metadata.

---

### Requirement 9: Long-Context Routing

**User Story:** As a platform owner, I want requests with unusually large context routed to models optimized for long sequences, so that the gateway does not under-serve complex workloads.

#### Acceptance Criteria

1. WHEN the total input context (prompt plus extracted document text) exceeds a configurable token threshold, THE Routing_Engine SHALL prefer `nvidia.nemotron-super-3-120b` in `auto` state because it supports up to 1M context tokens.
2. THE threshold for long-context routing SHALL be configurable via environment variable or configuration file.
3. THE Routing_Engine SHALL emit a specific reason code (`long-context`) when long-context logic overrides the default complexity-based routing.
4. IF long-context preference conflicts with a valid user-selected model in `manual` state, THEN THE Gateway SHALL honor the valid manual selection and log a warning.

---

### Requirement 10: Routing Transparency

**User Story:** As an auditor or platform operator, I want routing decisions to be explainable at a summary level, so that model choice can be reviewed without exposing chain-of-thought.

#### Acceptance Criteria

1. THE Routing_Engine SHALL generate a concise Reasoning_Summary for each Routing_Decision.
2. THE Reasoning_Summary SHALL describe the factors used: complexity band, modality, long-context flag, and routing state.
3. THE Gateway SHALL NOT expose full chain-of-thought in production responses by default.
4. THE Reasoning_Summary SHALL be included in audit log entries for each inference request.
5. UI exposure of routing explanations SHALL be configurable by environment (enabled in development, disabled in production by default).

---

### Requirement 11: API Contract Extension for Routing Metadata

**User Story:** As an application developer, I want routing metadata available in the API response, so that clients can display or inspect routing outcomes.

#### Acceptance Criteria

1. THE inference response SSE stream SHALL support a new `routing` event type containing optional fields: `refinedPrompt`, `complexityScore`, `routingState`, `executedModelId`, `routingReasonCode`, `reasoningSummary`, `modalityFlags`, and `manualOverrideApplied`.
2. THE API SHALL preserve backward compatibility: clients that do not handle the `routing` event SHALL continue to function without errors.
3. THE API SHALL support returning routing metadata for both JSON and multipart inference requests.
4. THE Gateway SHALL include attachment-derived modality data in the routing event when file uploads are present.

---

### Requirement 12: Operational Fallbacks

**User Story:** As an operator, I want safe fallback behavior when routing components fail, so that the gateway remains available under partial failure.

#### Acceptance Criteria

1. IF the Routing_Engine is unavailable or times out, THEN THE Gateway SHALL fall back to the existing manual model-selection behavior using the default model.
2. IF the request is in `auto` state and routing fails before model selection is completed, THEN THE Gateway SHALL fall back to `qwen.qwen3-32b-v1:0` as the execution model.
3. THE Gateway SHALL log all fallback events with a `routing-fallback` category for operational monitoring.
4. THE Gateway SHALL NOT return an error to the user when falling back; the request SHALL proceed with the fallback model.
