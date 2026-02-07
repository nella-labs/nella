#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# GCP Setup Script for Nella
# Sets up: Artifact Registry, Cloud Run, GCS bucket, Workload Identity Federation
# =============================================================================

PROJECT_ID="${GCP_PROJECT_ID:-nella-sync}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="nella-mcp"
BUCKET_NAME="${GCP_STORAGE_BUCKET:-nella-sync-indexes}"
SA_NAME="nella-deploy"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
GITHUB_ORG="nella-labs"
GITHUB_REPO="nella"
POOL_NAME="github-actions"
PROVIDER_NAME="github"

echo "=== Nella GCP Setup ==="
echo "Project:  $PROJECT_ID"
echo "Region:   $REGION"
echo ""

# Ensure we're using the right project
gcloud config set project "$PROJECT_ID"

# Enable required APIs
echo "--- Enabling APIs ---"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com

# Create Artifact Registry repository
echo "--- Creating Artifact Registry ---"
gcloud artifacts repositories describe nella \
  --location="$REGION" 2>/dev/null || \
gcloud artifacts repositories create nella \
  --repository-format=docker \
  --location="$REGION" \
  --description="Nella container images"

# Create GCS bucket for index sync
echo "--- Creating GCS Bucket ---"
gsutil ls -b "gs://$BUCKET_NAME" 2>/dev/null || \
gsutil mb -p "$PROJECT_ID" -l "$REGION" "gs://$BUCKET_NAME"

# Set lifecycle policy (delete objects older than 90 days)
cat > /tmp/nella-lifecycle.json << 'EOF'
{
  "rule": [
    {
      "action": { "type": "Delete" },
      "condition": { "age": 90 }
    }
  ]
}
EOF
gsutil lifecycle set /tmp/nella-lifecycle.json "gs://$BUCKET_NAME"
rm /tmp/nella-lifecycle.json

# Create service account
echo "--- Creating Service Account ---"
gcloud iam service-accounts describe "$SA_EMAIL" 2>/dev/null || \
gcloud iam service-accounts create "$SA_NAME" \
  --display-name="Nella Deploy Service Account"

# Grant roles to service account
echo "--- Granting IAM Roles ---"
for ROLE in \
  roles/run.admin \
  roles/artifactregistry.writer \
  roles/storage.objectAdmin \
  roles/iam.serviceAccountUser \
  roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="$ROLE" \
    --condition=None \
    --quiet
done

# Create secrets in Secret Manager
echo "--- Setting up Secret Manager ---"
for SECRET_NAME in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY; do
  gcloud secrets describe "$SECRET_NAME" 2>/dev/null || \
  gcloud secrets create "$SECRET_NAME" --replication-policy="automatic"
  echo ""
  echo "  To set $SECRET_NAME:"
  echo "  echo -n 'your-value' | gcloud secrets versions add $SECRET_NAME --data-file=-"
  echo ""
done

# Set up Workload Identity Federation for GitHub Actions
echo "--- Setting up Workload Identity Federation ---"
POOL_ID=$(gcloud iam workload-identity-pools describe "$POOL_NAME" \
  --location=global --format="value(name)" 2>/dev/null || echo "")

if [ -z "$POOL_ID" ]; then
  gcloud iam workload-identity-pools create "$POOL_NAME" \
    --location=global \
    --display-name="GitHub Actions Pool"
  POOL_ID=$(gcloud iam workload-identity-pools describe "$POOL_NAME" \
    --location=global --format="value(name)")
fi

PROVIDER_ID=$(gcloud iam workload-identity-pools providers describe "$PROVIDER_NAME" \
  --workload-identity-pool="$POOL_NAME" \
  --location=global --format="value(name)" 2>/dev/null || echo "")

if [ -z "$PROVIDER_ID" ]; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_NAME" \
    --location=global \
    --workload-identity-pool="$POOL_NAME" \
    --display-name="GitHub" \
    --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
    --issuer-uri="https://token.actions.githubusercontent.com"
  PROVIDER_ID=$(gcloud iam workload-identity-pools providers describe "$PROVIDER_NAME" \
    --workload-identity-pool="$POOL_NAME" \
    --location=global --format="value(name)")
fi

# Allow GitHub Actions to impersonate the service account
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${POOL_ID}/attribute.repository/${GITHUB_ORG}/${GITHUB_REPO}" \
  --quiet

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Add these GitHub repository secrets:"
echo ""
echo "  GCP_WORKLOAD_IDENTITY_PROVIDER:"
echo "    $PROVIDER_ID"
echo ""
echo "  GCP_SERVICE_ACCOUNT:"
echo "    $SA_EMAIL"
echo ""
echo "Set your secrets:"
echo "  echo -n 'https://xxx.supabase.co' | gcloud secrets versions add SUPABASE_URL --data-file=-"
echo "  echo -n 'eyJ...' | gcloud secrets versions add SUPABASE_SERVICE_ROLE_KEY --data-file=-"
echo ""
echo "GCS bucket for index sync: gs://$BUCKET_NAME"
echo "  Set GCP_STORAGE_BUCKET=$BUCKET_NAME in your .env"
echo ""
