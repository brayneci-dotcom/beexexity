# Design: Model Access Control (Public/Private)

## Overview
Add `anthropic.claude-sonnet-5` and `zai.glm-5` as private models with username-based whitelist access. Private models require explicit whitelist per user. **Manual override only** — user selects in dropdown. Routing engine unchanged.

## Model Pricing

| Model ID | Display Name | Input / 1M tokens | Output / 1M tokens | Default |
|---|---|---|---|---|
| `anthropic.claude-sonnet-5` | Claude Sonnet 5 | $2.00 | $10.00 | Private |
| `zai.glm-5` | GLM-5 | $1.20 | $3.84 | Private |

Both confirmed available in AWS Bedrock ap-southeast-3 (Jakarta).

## Database

### Migration: `013_model_access.sql`

```sql
-- User-to-model whitelist for private model access.
-- Admin manages by username (not UUID) for UX simplicity.
CREATE TABLE user_model_access (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    model_id VARCHAR(128) NOT NULL,
    username VARCHAR(64) NOT NULL,          -- Denormalized for display
    granted_by UUID REFERENCES users(id),
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, model_id)
);

CREATE INDEX idx_user_model_access_user ON user_model_access(user_id);
CREATE INDEX idx_user_model_access_model ON user_model_access(model_id);
```

**Why username in the table:** Admin management is by username (admin types "john.doe", not a UUID). The username is denormalized here so admin queries and displays work without a JOIN.

**Private model detection:** A model is private if ANY row exists for it in `user_model_access`. If 0 rows, model is public (no access restrictions).

## How It Works

| Term | Meaning |
|---|---|
| **Public model** | Zero rows in `user_model_access` for that model_id. All users can select it. |
| **Private model** | Has rows in `user_model_access`. Only those users can select it. |
| **Make private** | Insert access rows for whitelisted usernames. Model becomes private. |
| **Make public** | Delete all rows for that model_id. Model becomes public again. |

## Files to Change

### 1. `src/types/inference.types.ts`

Add to `ALLOWED_MODELS`:

```typescript
export const ALLOWED_MODELS = [
  'amazon.nova-lite-v1:0',
  'anthropic.claude-sonnet-5',
  'openai.gpt-oss-120b-1:0',
  'qwen.qwen3-235b-a22b-2507-v1:0',
  'qwen.qwen3-32b-v1:0',
  'zai.glm-5',
] as const;
```

### 2. `src/config/model-capabilities.ts`

Add vision capabilities. Claude Sonnet 5 supports images, GLM-5 is text-only.

```typescript
const MODEL_CAPABILITIES: Record<string, ModelCapability> = {
  'anthropic.claude-sonnet-5': { vision: true },
  'zai.glm-5': { vision: false },
  // ... existing entries
};
```

### 3. `src/frontend/pricing-config.json`

Add pricing entries:

```json
{
  "models": {
    "anthropic.claude-sonnet-5": {
      "displayName": "Claude Sonnet 5",
      "inputPricePer1MTokens": 2.00,
      "outputPricePer1MTokens": 10.00
    },
    "zai.glm-5": {
      "displayName": "GLM-5",
      "inputPricePer1MTokens": 1.20,
      "outputPricePer1MTokens": 3.84
    }
  }
}
```

### 4. `src/services/inference.service.ts`

Make `validateModelId()` async — add private model access check:

```typescript
export async function validateModelId(modelId?: string, userId?: string): Promise<string> {
  if (modelId === undefined || modelId === null || modelId === '') {
    return DEFAULT_MODEL;
  }
  if (modelId === 'auto_v2') {
    return 'auto_v2';
  }
  if (!ALLOWED_MODELS.includes(modelId as any)) {
    const error = new Error(`Invalid model. Choose from: ${ALLOWED_MODELS.join(', ')}`);
    (error as any).code = 'INVALID_MODEL';
    (error as any).statusCode = 400;
    throw error;
  }
  // Private model access check
  if (userId) {
    const hasAccess = await checkModelAccess(userId, modelId);
    if (!hasAccess) {
      const error = new Error('You do not have access to this model');
      (error as any).code = 'ACCESS_DENIED';
      (error as any).statusCode = 403;
      throw error;
    }
  }
  return modelId;
}

async function checkModelAccess(userId: string, modelId: string): Promise<boolean> {
  // If model has no access rows at all, it's public — everyone can use it
  const { rows } = await query(
    `SELECT 1 FROM user_model_access
     WHERE model_id = $1
     LIMIT 1`,
    [modelId]
  );
  if (rows.length === 0) return true; // public model

  // Model is private — check if this user is whitelisted
  const { rows: access } = await query(
    `SELECT 1 FROM user_model_access
     WHERE user_id = $1 AND model_id = $2`,
    [userId, modelId]
  );
  return access.length > 0;
}
```

### 5. Update call sites in `inference.routes.ts`

Both JSON and multipart handlers call `validateModelId(modelId)` — change to `await validateModelId(modelId, user.sub)`:

```typescript
// Before:
validatedModelId = validateModelId(modelId);

// After:
validatedModelId = await validateModelId(modelId, user.sub);
```

Also update the catch block to handle the new error code:

```typescript
} catch (error: unknown) {
  const err = error as Error & { code?: string; statusCode?: number };
  res.status(err.statusCode ?? 400).json({
    error: err.code ?? 'INVALID_MODEL',
    message: err.message,
  });
  return;
}
```

The existing error handler already reads `err.code` and `err.statusCode` — just need to ensure the 403 error from `ACCESS_DENIED` is properly rendered on the frontend.

### 6. `src/routes/models.routes.ts`

Filter models by user access. Private models excluded for users without whitelist:

```typescript
router.get('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  // Build model list (existing logic)
  const models = ALLOWED_MODELS.map(modelId => { ... });

  // Filter: exclude private models the user cannot access
  const allowed = await Promise.all(
    models.map(async (m) => {
      const isPrivate = await modelHasAccessRows(m.modelId);
      if (!isPrivate) return m;
      const hasAccess = await checkModelAccess(req.user!.sub, m.modelId);
      return hasAccess ? m : null;
    })
  );

  res.json({ models: allowed.filter(Boolean) });
});
```

Helper (reuse in models route):

```typescript
async function modelHasAccessRows(modelId: string): Promise<boolean> {
  const { rows } = await query(
    'SELECT 1 FROM user_model_access WHERE model_id = $1 LIMIT 1',
    [modelId]
  );
  return rows.length > 0;
}
```

### 7. `public/index.html`

**No changes needed.** Dropdown already renders from `GET /api/v1/models` response. Private models simply won't appear for non-whitelisted users.

### 8. Admin API (`src/routes/admin.routes.ts`)

New endpoints for managing access by **username**:

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/admin/model-access` | List all models + access count + usernames per model |
| `PUT /api/v1/admin/model-access/:modelId` | Set access list: `{ usernames: ["john.doe", "jane"] }` |

**PUT implementation:**

```typescript
router.put('/model-access/:modelId', adminMiddleware, async (req, res) => {
  const { modelId } = req.params;
  const { usernames } = req.body; // string[]

  // Validate model exists
  if (!ALLOWED_MODELS.includes(modelId as any)) {
    return res.status(400).json({ error: 'INVALID_MODEL', message: 'Model not found' });
  }

  // Resolve usernames → user_ids
  const placeholders = usernames.map((_, i) => `$${i + 1}`).join(',');
  const { rows: users } = await query(
    `SELECT id, username FROM users WHERE username IN (${placeholders})`,
    usernames
  );

  // Replace whitelist: delete old, insert new
  await query('DELETE FROM user_model_access WHERE model_id = $1', [modelId]);

  if (users.length > 0) {
    const values = users.map(u => [u.id, modelId, u.username, req.user!.sub]);
    // Bulk INSERT
    const placeholders = values.map((_, i) =>
      `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`
    ).join(',');
    const flat = values.flat();
    await query(
      `INSERT INTO user_model_access (user_id, model_id, username, granted_by) VALUES ${placeholders}`,
      flat
    );
  }

  // Return updated list
  const updated = await query(
    `SELECT uma.username, uma.granted_at
     FROM user_model_access WHERE model_id = $1
     ORDER BY uma.granted_at`,
    [modelId]
  );

  res.json({
    modelId,
    isPrivate: updated.rows.length > 0,
    users: updated.rows.map(r => ({ username: r.username, grantedAt: r.granted_at })),
  });
});
```

**GET implementation:**

```typescript
router.get('/model-access', adminMiddleware, async (req, res) => {
  const result = await Promise.all(
    ALLOWED_MODELS.map(async (modelId) => {
      const { rows } = await query(
        `SELECT uma.username, uma.granted_at
         FROM user_model_access uma
         WHERE uma.model_id = $1
         ORDER BY uma.granted_at`,
        [modelId]
      );
      return {
        modelId,
        isPrivate: rows.length > 0,
        users: rows.map(r => ({ username: r.username, grantedAt: r.granted_at })),
      };
    })
  );
  res.json({ models: result });
});
```

### 9. Admin UI (`public/admin.html`)

Add new section under existing tabs:

```
Tab Bar: Users | Bulk Upload | Usage & Cost | Account Settings | [NEW] Model Access
```

**Model Access tab:**

| Column | Type |
|---|---|
| Model ID | Text |
| Status | Badge: Public 🟢 / Private 🔴 |
| Users | Count + "Manage" button |

**Manage modal:**
- Title: "Manage Access: anthropic.claude-sonnet-5"
- Text input: "Add username" + Add button (resolves username, shows as chip)
- Chips of current whitelist usernames with × remove
- Save button → PUT to admin API
- On save: refresh list, show toast

## Error Handling

| Scenario | Behavior | HTTP |
|---|---|---|
| Unauthenticated user | Auth middleware rejects first | 401 |
| Select private model without access | 403, frontend shows "You don't have access" | 403 |
| Username not found during admin add | Return 400 with unknown usernames list | 400 |
| Private model with 0 access rows (orphaned) | Treated as public (fallback safe) | — |
| User deleted → cascade deletes their access rows | Automatic via FK | — |

## What We're NOT Doing

| Original PRD Item | Reason |
|---|---|
| `models` database table | Duplicates static config |
| `models.service.ts` | 2 small helper functions suffice |
| Routing engine changes | New models = manual override only |
| Pricing in DB | `pricing-config.json` is source of truth |
| Model seeding script | Migrations + code changes cover it |

## Tasks

- [ ] Add `anthropic.claude-sonnet-5` and `zai.glm-5` to `ALLOWED_MODELS`
- [ ] Add vision capabilities in `model-capabilities.ts`
- [ ] Add pricing in `pricing-config.json`
- [ ] Create migration `013_model_access.sql`
- [ ] Run migration on local + production
- [ ] Make `validateModelId()` async with access check
- [ ] Update both `handleJsonInference` and `handleMultipartInference` to `await`
- [ ] Filter models in `models.routes.ts` by user access
- [ ] Add admin GET + PUT endpoints for access management
- [ ] Add "Model Access" tab to `admin.html`
- [ ] Test: non-whitelisted user gets 403 on private model
- [ ] Test: whitelisted user can use private model
- [ ] Test: admin can add/remove usernames via API
- [ ] Test: auto/auto_v2 modes unaffected
