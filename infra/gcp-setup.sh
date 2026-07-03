#!/usr/bin/env bash
#
# gcp-setup.sh — One-time GCP infrastructure provisioning for Cloud Run deployment.
#
# Prerequisites:
#   1. gcloud CLI installed and authenticated (gcloud auth login)
#   2. A GCP project created with billing enabled
#   3. PROJECT_ID exported or set below
#
# Usage:
#   export PROJECT_ID="my-gcp-project"
#   bash infra/gcp-setup.sh
#
# Creates:
#   - Enabled APIs (Cloud Run, Artifact Registry, Secret Manager, IAM)
#   - Artifact Registry Docker repository
#   - Secret Manager secrets (populated interactively or from env vars)
#   - Cloud Run service account with required roles
#   - Workload Identity Federation for GitHub Actions

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────

: "${PROJECT_ID:?Set PROJECT_ID to your GCP project ID}"
REGION="${REGION:-asia-southeast2}"
AR_REPO="${AR_REPO:-bedrock-gateway}"
CLOUD_RUN_SA="${CLOUD_RUN_SA:-bedrock-gateway-sa}"
GITHUB_REPO="${GITHUB_REPO:-brayneci-dotcom/beexexity}"

echo "=== GCP Cloud Run Setup ==="
echo "Project:     $PROJECT_ID"
echo "Region:      $REGION"
echo "AR Repo:     $AR_REPO"
echo "SA:          $CLOUD_RUN_SA"
echo "GitHub:      $GITHUB_REPO"
echo ""

# ── 1. Enable APIs ─────────────────────────────────────────────────────────

echo "[1/5] Enabling GCP APIs..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com \
  --project "$PROJECT_ID"
echo "  APIs enabled."

# ── 2. Create Artifact Registry repository ──────────────────────────────────

echo "[2/5] Creating Artifact Registry repository..."
if gcloud artifacts repositories describe "$AR_REPO" \
  --location="$REGION" --project="$PROJECT_ID" &>/dev/null; then
  echo "  Artifact Registry '$AR_REPO' already exists."
else
  gcloud artifacts repositories create "$AR_REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --project="$PROJECT_ID" \
    --description="Bedrock Inference Gateway container images"
  echo "  Artifact Registry '$AR_REPO' created."
fi

# ── 3. Create Secrets ───────────────────────────────────────────────────────

echo "[3/5] Creating secrets in Secret Manager..."

create_secret() {
  local name="$1"
  local label="$2"
  local env_var="$3"

  if gcloud secrets describe "$name" --project="$PROJECT_ID" &>/dev/null; then
    echo "  Secret '$name' already exists."
    return
  fi

  # Use env var if set, otherwise prompt
  local value="${!env_var:-}"
  if [ -z "$value" ]; then
    read -rsp "  Enter $label: " value
    echo ""
  fi

  echo -n "$value" | gcloud secrets create "$name" \
    --project="$PROJECT_ID" \
    --data-file=- \
    --replication-policy=automatic
  echo "  Secret '$name' created."
}

create_secret "db-password"           "RDS database password"           "DB_PASSWORD"
create_secret "jwt-secret"            "JWT signing secret"              "JWT_SECRET"
create_secret "aws-access-key-id"     "AWS IAM access key ID"           "AWS_ACCESS_KEY_ID"
create_secret "aws-secret-access-key" "AWS IAM secret access key"       "AWS_SECRET_ACCESS_KEY"

# ── 4. Service Account + Roles ──────────────────────────────────────────────

echo "[4/5] Setting up Cloud Run service account..."
SA_EMAIL="${CLOUD_RUN_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

if gcloud iam service-accounts describe "$SA_EMAIL" \
  --project="$PROJECT_ID" &>/dev/null; then
  echo "  Service account '$SA_EMAIL' already exists."
else
  gcloud iam service-accounts create "$CLOUD_RUN_SA" \
    --display-name="Bedrock Inference Gateway" \
    --project="$PROJECT_ID"
  echo "  Service account '$SA_EMAIL' created."
fi

# Grant secret access to the Cloud Run service account
for secret in db-password jwt-secret aws-access-key-id aws-secret-access-key; do
  gcloud secrets add-iam-policy-binding "$secret" \
    --project="$PROJECT_ID" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="roles/secretmanager.secretAccessor" \
    --condition=None &>/dev/null && \
    echo "  Granted secret access: $secret → $SA_EMAIL" || true
done

# ── 5. Workload Identity Federation for GitHub Actions ──────────────────────

echo "[5/5] Setting up Workload Identity Federation..."

# Create a dedicated service account for GitHub Actions
WIF_SA="github-actions-sa"
WIF_SA_EMAIL="${WIF_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

if gcloud iam service-accounts describe "$WIF_SA_EMAIL" \
  --project="$PROJECT_ID" &>/dev/null; then
  echo "  GitHub Actions SA '$WIF_SA_EMAIL' already exists."
else
  gcloud iam service-accounts create "$WIF_SA" \
    --display-name="GitHub Actions deploy" \
    --project="$PROJECT_ID"
fi

# Grant roles to the WIF SA
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$WIF_SA_EMAIL" \
  --role="roles/run.admin" \
  --condition=None &>/dev/null && echo "  Granted run.admin" || true

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$WIF_SA_EMAIL" \
  --role="roles/artifactregistry.writer" \
  --condition=None &>/dev/null && echo "  Granted artifactregistry.writer" || true

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$WIF_SA_EMAIL" \
  --role="roles/iam.serviceAccountUser" \
  --condition=None &>/dev/null && echo "  Granted iam.serviceAccountUser" || true

# Create Workload Identity Pool + Provider
POOL_NAME="github-pool"
PROVIDER_NAME="github-provider"

if gcloud iam workload-identity-pools describe "$POOL_NAME" \
  --project="$PROJECT_ID" --location=global &>/dev/null; then
  echo "  WIF pool '$POOL_NAME' already exists."
else
  gcloud iam workload-identity-pools create "$POOL_NAME" \
    --project="$PROJECT_ID" \
    --location=global \
    --display-name="GitHub Actions pool"
fi

POOL_ID=$(gcloud iam workload-identity-pools describe "$POOL_NAME" \
  --project="$PROJECT_ID" --location=global --format="value(name)")

if gcloud iam workload-identity-pools providers describe "$PROVIDER_NAME" \
  --project="$PROJECT_ID" --location=global --workload-identity-pool="$POOL_NAME" &>/dev/null; then
  echo "  WIF provider '$PROVIDER_NAME' already exists."
else
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_NAME" \
    --project="$PROJECT_ID" \
    --location=global \
    --workload-identity-pool="$POOL_NAME" \
    --display-name="GitHub provider" \
    --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
    --issuer-uri="https://token.actions.githubusercontent.com"
fi

# Allow the GitHub repo to impersonate the WIF SA
gcloud iam service-accounts add-iam-policy-binding "$WIF_SA_EMAIL" \
  --project="$PROJECT_ID" \
  --member="principalSet://iam.googleapis.com/${POOL_ID}/attribute.repository/${GITHUB_REPO}" \
  --role="roles/iam.workloadIdentityUser" \
  --condition=None &>/dev/null && \
  echo "  WIF binding: $GITHUB_REPO → $WIF_SA_EMAIL" || true

# ── Done ────────────────────────────────────────────────────────────────────

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Add these to your GitHub repository secrets (Settings → Secrets and variables → Actions):"
echo ""
echo "  GCP_PROJECT_ID:              $PROJECT_ID"
echo "  GCP_WORKLOAD_IDENTITY_PROVIDER: ${POOL_ID}/providers/${PROVIDER_NAME}"
echo "  GCP_SERVICE_ACCOUNT:          $WIF_SA_EMAIL"
echo ""
echo "Add these as well (used by the deployment workflow):"
echo ""
echo "  DB_HOST:     <your RDS endpoint>"
echo "  DB_USER:     postgres"
echo ""
echo "Push to main to trigger deployment."
