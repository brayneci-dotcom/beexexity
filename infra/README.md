# Infrastructure: GCP Cloud Run + AWS Bedrock + AWS RDS

## Architecture

```
Users → Cloud Run (HTTPS, asia-southeast2)
              │
              ├── AWS Bedrock Account #1 (LLM inference)
              │     - ap-southeast-3 (Jakarta)
              │     - All models via ConverseStream / Converse / InvokeModel API
              │
              └── GCP Cloud SQL (PostgreSQL)
                    - Public IP
                    - SSL required
                    - Connection pool (pg Pool, max 20)
```

## Prerequisites

- GCP project with Cloud Run enabled
- GCP Cloud SQL for PostgreSQL instance running
- AWS Account #1 with Bedrock access in ap-southeast-3
- `gcloud` CLI installed and authenticated
- Docker installed

## One-Time Setup

```bash
# 1. Set your GCP project
export PROJECT_ID="my-gcp-project"

# 2. Run the setup script
bash infra/gcp-setup.sh
```

This creates:
- Enabled APIs (Cloud Run, Artifact Registry, Secret Manager)
- Artifact Registry Docker repository
- Secret Manager secrets for DB credentials and AWS keys
- Cloud Run service account with secret access
- Workload Identity Federation for GitHub Actions

## Database

GCP Cloud SQL for PostgreSQL. Public IP with SSL required.

- `DB_HOST` — `34.101.75.59`
- `DB_PORT` — 5432
- `DB_NAME` — bedrock_gateway
- `DB_USER` — postgres
- `DB_PASSWORD` — stored in Secret Manager as `db-password`
- `DB_SSL` — true

### Running Migrations

Migrations are idempotent. Run after the first deploy:

```bash
gcloud run jobs execute beexexity-migrate  # if set up as a job
# OR via Cloud Run with a one-off command:
gcloud run deploy beexexity --source . \
  --set-env-vars="DB_HOST=...,DB_PASSWORD=..." \
  --command="npx tsx src/scripts/run-migrations.ts"
```

## Bedrock Access

AWS Account #1 provides Bedrock access. Credentials stored in Secret Manager:

| Secret | Value |
|---|---|
| `aws-access-key-id` | IAM user with `AmazonBedrockFullAccess` |
| `aws-secret-access-key` | Corresponding secret key |

The IAM user needs Bedrock access in `ap-southeast-3` (Jakarta) with Converse, ConverseStream, and InvokeModel permissions.

## Deploying

### Via Cloud Build (push-to-deploy)

Push to `main` branch → Cloud Build trigger builds and deploys to Cloud Run automatically (configured via `cloudbuild.yaml`).

### Manual deploy

```bash
gcloud builds submit --config cloudbuild.yaml \
  --substitutions=_DB_HOST="<rds-endpoint>",_DB_USER="postgres"
```

### Cloud Run Configuration

| Setting | Value |
|---|---|
| Region | `asia-southeast2` |
| Memory | 512Mi |
| CPU | 1 |
| Timeout | 300s |
| Max instances | 10 |
| Concurrency | 80 |
| Port | 3000 |
| Auth | Allow unauthenticated (or use IAM) |

## Environment Variables

Set via Cloud Run env vars or Secret Manager:

| Variable | Source |
|---|---|
| `NODE_ENV` | Env var: `production` |
| `AWS_REGION` | Env var: `ap-southeast-3` |
| `DB_HOST` | Env var |
| `DB_PORT` | Env var |
| `DB_NAME` | Env var |
| `DB_USER` | Env var |
| `DB_PASSWORD` | Secret Manager: `db-password` |
| `JWT_SECRET` | Secret Manager: `jwt-secret` |
| `AWS_ACCESS_KEY_ID` | Secret Manager: `aws-access-key-id` |
| `AWS_SECRET_ACCESS_KEY` | Secret Manager: `aws-secret-access-key` |

## Cost Estimate

| Resource | Monthly Cost |
|---|---|
| Cloud Run (light use) | ~$0–5 |
| Artifact Registry (500MB free) | $0 |
| Cloud SQL (db-f1-micro, 10GB) | ~$8/mo |
| Bedrock (per-token) | Varies by model usage |
| **Total** | **~$15–20/mo baseline + Bedrock usage** |
