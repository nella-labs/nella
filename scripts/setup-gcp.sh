#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# GCP Setup Script for Nella (Full Stack)
# Sets up: Artifact Registry, Cloud Run, GCS bucket, Cloud SQL (pgvector),
#          e2-micro Redis VM, Secret Manager, Workload Identity Federation
# =============================================================================

PROJECT_ID="${GCP_PROJECT_ID:-nella-sync}"
REGION="${GCP_REGION:-us-central1}"
ZONE="${GCP_ZONE:-us-central1-a}"
SERVICE_NAME="nella-mcp"
BUCKET_NAME="${GCP_STORAGE_BUCKET:-nella-sync-indexes}"
SA_NAME="nella-deploy"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
GITHUB_ORG="nella-labs"
GITHUB_REPO="nella"
POOL_NAME="github-actions"
PROVIDER_NAME="github"

# Cloud SQL config
SQL_INSTANCE_NAME="nella-db"
SQL_DB_NAME="nella"
SQL_DB_USER="nella_app"

# Redis VM config
REDIS_VM_NAME="nella-redis-vm"

echo "=== Nella GCP Full Stack Setup ==="
echo "Project:       $PROJECT_ID"
echo "Region:        $REGION"
echo "Zone:          $ZONE"
echo "Cloud SQL:     $SQL_INSTANCE_NAME"
echo "Redis VM:      $REDIS_VM_NAME"
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
  iamcredentials.googleapis.com \
  compute.googleapis.com \
  sqladmin.googleapis.com \
  vpcaccess.googleapis.com

# =============================================================================
# Artifact Registry
# =============================================================================
echo "--- Creating Artifact Registry ---"
gcloud artifacts repositories describe nella \
  --location="$REGION" 2>/dev/null || \
gcloud artifacts repositories create nella \
  --repository-format=docker \
  --location="$REGION" \
  --description="Nella container images"

# =============================================================================
# GCS Bucket (index sync, ONNX models, backups)
# =============================================================================
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

# =============================================================================
# e2-micro Redis VM (free tier eligible)
# =============================================================================
echo "--- Creating Redis VM (e2-micro, free tier) ---"
REDIS_VM_EXISTS=$(gcloud compute instances describe "$REDIS_VM_NAME" \
  --zone="$ZONE" --format="value(name)" 2>/dev/null || echo "")

if [ -z "$REDIS_VM_EXISTS" ]; then
  gcloud compute instances create "$REDIS_VM_NAME" \
    --zone="$ZONE" \
    --machine-type=e2-micro \
    --image-family=debian-12 \
    --image-project=debian-cloud \
    --boot-disk-size=10GB \
    --boot-disk-type=pd-standard \
    --no-address \
    --tags=redis-server \
    --metadata=startup-script='#!/bin/bash
set -e

# Install Docker if not present
if ! command -v docker &> /dev/null; then
  apt-get update -y
  apt-get install -y docker.io
  systemctl enable docker
  systemctl start docker
fi

# Run Redis 7 with persistence
docker rm -f nella-redis 2>/dev/null || true
docker run -d \
  --name nella-redis \
  --restart always \
  -p 6379:6379 \
  -v /var/lib/redis-data:/data \
  redis:7-alpine \
  redis-server \
    --appendonly yes \
    --maxmemory 256mb \
    --maxmemory-policy allkeys-lru \
    --save 60 1000 \
    --save 300 100
'
  echo "  Redis VM created: $REDIS_VM_NAME"
else
  echo "  Redis VM already exists: $REDIS_VM_NAME"
fi

# Create firewall rule to allow Cloud Run → Redis
echo "--- Creating Redis firewall rule ---"
gcloud compute firewall-rules describe allow-redis-from-internal 2>/dev/null || \
gcloud compute firewall-rules create allow-redis-from-internal \
  --direction=INGRESS \
  --priority=1000 \
  --network=default \
  --action=ALLOW \
  --rules=tcp:6379 \
  --source-ranges=10.0.0.0/8 \
  --target-tags=redis-server \
  --description="Allow internal traffic to Redis VM from Cloud Run VPC egress"

# Get Redis VM internal IP
REDIS_VM_IP=$(gcloud compute instances describe "$REDIS_VM_NAME" \
  --zone="$ZONE" --format="value(networkInterfaces[0].networkIP)" 2>/dev/null || echo "pending")
echo "  Redis VM internal IP: $REDIS_VM_IP"

# =============================================================================
# Cloud SQL (PostgreSQL + pgvector)
# =============================================================================
echo "--- Creating Cloud SQL Instance ---"
SQL_EXISTS=$(gcloud sql instances describe "$SQL_INSTANCE_NAME" \
  --format="value(name)" 2>/dev/null || echo "")

if [ -z "$SQL_EXISTS" ]; then
  gcloud sql instances create "$SQL_INSTANCE_NAME" \
    --database-version=POSTGRES_15 \
    --tier=db-f1-micro \
    --region="$REGION" \
    --storage-type=HDD \
    --storage-size=10GB \
    --no-assign-ip \
    --network=default \
    --database-flags=cloudsql.enable_pgvector=on \
    --availability-type=ZONAL \
    --edition=ENTERPRISE

  # Create database
  gcloud sql databases create "$SQL_DB_NAME" \
    --instance="$SQL_INSTANCE_NAME"

  # Generate a random password for the app user
  SQL_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)

  # Create app user
  gcloud sql users create "$SQL_DB_USER" \
    --instance="$SQL_INSTANCE_NAME" \
    --password="$SQL_PASSWORD"

  echo "  Cloud SQL instance created: $SQL_INSTANCE_NAME"
  echo "  Database: $SQL_DB_NAME"
  echo "  User: $SQL_DB_USER"
  echo "  Password: $SQL_PASSWORD"
  echo ""
  echo "  ⚠️  SAVE THIS PASSWORD — it won't be shown again!"
  echo ""
else
  echo "  Cloud SQL instance already exists: $SQL_INSTANCE_NAME"
  SQL_PASSWORD="<already-set>"
fi

# Get Cloud SQL connection name
SQL_CONNECTION_NAME=$(gcloud sql instances describe "$SQL_INSTANCE_NAME" \
  --format="value(connectionName)" 2>/dev/null || echo "pending")
echo "  Connection name: $SQL_CONNECTION_NAME"

# =============================================================================
# Service Account
# =============================================================================
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
  roles/secretmanager.secretAccessor \
  roles/cloudsql.client; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="$ROLE" \
    --condition=None \
    --quiet
done

# =============================================================================
# Secret Manager
# =============================================================================
echo "--- Setting up Secret Manager ---"

# All secrets needed for the full stack
SECRETS=(
  "SUPABASE_URL"
  "SUPABASE_SERVICE_ROLE_KEY"
  "REDIS_URL"
  "GCP_CLOUD_SQL_INSTANCE"
  "GCP_DB_USER"
  "GCP_DB_PASSWORD"
  "GCP_DB_NAME"
  "VOYAGE_API_KEY"
  "OPENAI_API_KEY"
  "COHERE_API_KEY"
  "NELLA_AUTH_ENCRYPTION_KEY"
  "NELLA_JWT_SECRET"
)

for SECRET_NAME in "${SECRETS[@]}"; do
  gcloud secrets describe "$SECRET_NAME" 2>/dev/null || \
  gcloud secrets create "$SECRET_NAME" --replication-policy="automatic"
done

# Auto-populate secrets we already know
if [ "$REDIS_VM_IP" != "pending" ]; then
  echo -n "redis://${REDIS_VM_IP}:6379" | gcloud secrets versions add REDIS_URL --data-file=- 2>/dev/null || true
  echo "  ✓ REDIS_URL set to redis://${REDIS_VM_IP}:6379"
fi

if [ "$SQL_CONNECTION_NAME" != "pending" ]; then
  echo -n "$SQL_CONNECTION_NAME" | gcloud secrets versions add GCP_CLOUD_SQL_INSTANCE --data-file=- 2>/dev/null || true
  echo "  ✓ GCP_CLOUD_SQL_INSTANCE set to $SQL_CONNECTION_NAME"
fi

echo -n "$SQL_DB_USER" | gcloud secrets versions add GCP_DB_USER --data-file=- 2>/dev/null || true
echo "  ✓ GCP_DB_USER set to $SQL_DB_USER"

echo -n "$SQL_DB_NAME" | gcloud secrets versions add GCP_DB_NAME --data-file=- 2>/dev/null || true
echo "  ✓ GCP_DB_NAME set to $SQL_DB_NAME"

if [ "$SQL_PASSWORD" != "<already-set>" ]; then
  echo -n "$SQL_PASSWORD" | gcloud secrets versions add GCP_DB_PASSWORD --data-file=- 2>/dev/null || true
  echo "  ✓ GCP_DB_PASSWORD set"
fi

# =============================================================================
# Workload Identity Federation (for GitHub Actions keyless auth)
# =============================================================================
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

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "============================================="
echo "         Nella GCP Setup Complete"
echo "============================================="
echo ""
echo "Infrastructure provisioned:"
echo "  ✓ Artifact Registry:  ${REGION}-docker.pkg.dev/${PROJECT_ID}/nella"
echo "  ✓ GCS Bucket:         gs://${BUCKET_NAME}"
echo "  ✓ Redis VM:           ${REDIS_VM_NAME} (${REDIS_VM_IP}:6379)"
echo "  ✓ Cloud SQL:          ${SQL_INSTANCE_NAME} (${SQL_CONNECTION_NAME})"
echo "  ✓ Secret Manager:     ${#SECRETS[@]} secrets created"
echo "  ✓ Service Account:    ${SA_EMAIL}"
echo "  ✓ WIF Provider:       GitHub Actions (keyless)"
echo ""
echo "GitHub repository secrets to set:"
echo ""
echo "  GCP_WORKLOAD_IDENTITY_PROVIDER:"
echo "    $PROVIDER_ID"
echo ""
echo "  GCP_SERVICE_ACCOUNT:"
echo "    $SA_EMAIL"
echo ""
echo "GitHub repository variables to set:"
echo ""
echo "  GCP_PROJECT_ID: $PROJECT_ID"
echo ""
echo "Secrets still needed (set manually):"
echo "  echo -n 'https://xxx.supabase.co' | gcloud secrets versions add SUPABASE_URL --data-file=-"
echo "  echo -n 'eyJ...' | gcloud secrets versions add SUPABASE_SERVICE_ROLE_KEY --data-file=-"
echo "  echo -n 'voy-xxx' | gcloud secrets versions add VOYAGE_API_KEY --data-file=-"
echo "  echo -n 'sk-xxx' | gcloud secrets versions add OPENAI_API_KEY --data-file=-"
echo "  echo -n 'xxx' | gcloud secrets versions add COHERE_API_KEY --data-file=-"
echo "  echo -n \"\$(openssl rand -hex 32)\" | gcloud secrets versions add NELLA_AUTH_ENCRYPTION_KEY --data-file=-"
echo "  echo -n \"\$(openssl rand -hex 32)\" | gcloud secrets versions add NELLA_JWT_SECRET --data-file=-"
echo ""
echo "Apply Cloud SQL schema:"
echo "  gcloud sql connect $SQL_INSTANCE_NAME --user=$SQL_DB_USER --database=$SQL_DB_NAME < packages/core/src/gcp/schema.sql"
echo ""
echo "Estimated monthly cost: ~\$7-11 (Cloud SQL db-f1-micro)"
echo "  Cloud Run, Redis VM, GCS, Secrets — all in free tier"
echo ""
