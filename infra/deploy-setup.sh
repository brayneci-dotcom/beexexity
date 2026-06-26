#!/bin/bash
# ============================================================================
# AWS Infrastructure Setup for Bedrock Inference Gateway
# Run this ONCE to provision all AWS resources.
# After this, GitHub Actions handles all subsequent deploys.
#
# Prerequisites:
#   - AWS CLI configured with admin credentials for ap-southeast-3
#   - Docker installed (for initial image push)
#   - psql installed (for running migrations)
#
# Architecture:
#   Lambda (VPC) → RDS PostgreSQL (private subnet, no public IP)
#   Lambda Function URL (public HTTPS) → users
#   Lambda → Bedrock (via VPC endpoint or NAT gateway)
# ============================================================================

set -euo pipefail

REGION="ap-southeast-3"
APP_NAME="bedrock-inference-gateway"
DB_INSTANCE_ID="bedrock-gateway-db"
DB_NAME="bedrock_gateway"
DB_USER="postgres"
ECR_REPO="bedrock-inference-gateway"
LAMBDA_ROLE_NAME="bedrock-lambda-role"

# Prompt for DB password
read -sp "Choose a database password: " DB_PASSWORD
echo ""

# Get AWS Account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "AWS Account: $ACCOUNT_ID"
echo "Region: $REGION"

# ============================================================================
# Step 1: VPC Setup (use default VPC or create one)
# ============================================================================
echo "=== Step 1: VPC Setup ==="

# Get default VPC
VPC_ID=$(aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" \
  --query 'Vpcs[0].VpcId' --output text --region $REGION)

if [ "$VPC_ID" = "None" ]; then
  echo "No default VPC found. Creating one..."
  VPC_ID=$(aws ec2 create-default-vpc --query 'Vpc.VpcId' --output text --region $REGION)
fi
echo "VPC: $VPC_ID"

# Get subnets (need at least 2 for RDS subnet group)
SUBNET_IDS=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" \
  --query 'Subnets[*].SubnetId' --output text --region $REGION)
SUBNET_ARRAY=($SUBNET_IDS)
SUBNET_1=${SUBNET_ARRAY[0]}
SUBNET_2=${SUBNET_ARRAY[1]}
echo "Subnets: $SUBNET_1, $SUBNET_2"

# Get VPC CIDR for security group rules
VPC_CIDR=$(aws ec2 describe-vpcs --vpc-ids $VPC_ID \
  --query 'Vpcs[0].CidrBlock' --output text --region $REGION)

# ============================================================================
# Step 2: Security Groups
# ============================================================================
echo "=== Step 2: Security Groups ==="

# Lambda security group (outbound only)
LAMBDA_SG_ID=$(aws ec2 create-security-group \
  --group-name "${APP_NAME}-lambda-sg" \
  --description "Lambda function security group" \
  --vpc-id $VPC_ID \
  --query 'GroupId' --output text --region $REGION 2>/dev/null || \
  aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=${APP_NAME}-lambda-sg" "Name=vpc-id,Values=$VPC_ID" \
    --query 'SecurityGroups[0].GroupId' --output text --region $REGION)
echo "Lambda SG: $LAMBDA_SG_ID"

# RDS security group (inbound only from Lambda SG on port 5432)
RDS_SG_ID=$(aws ec2 create-security-group \
  --group-name "${APP_NAME}-rds-sg" \
  --description "RDS security group - allows inbound from Lambda only" \
  --vpc-id $VPC_ID \
  --query 'GroupId' --output text --region $REGION 2>/dev/null || \
  aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=${APP_NAME}-rds-sg" "Name=vpc-id,Values=$VPC_ID" \
    --query 'SecurityGroups[0].GroupId' --output text --region $REGION)
echo "RDS SG: $RDS_SG_ID"

# Allow RDS inbound from Lambda SG only (port 5432)
aws ec2 authorize-security-group-ingress \
  --group-id $RDS_SG_ID \
  --protocol tcp \
  --port 5432 \
  --source-group $LAMBDA_SG_ID \
  --region $REGION 2>/dev/null || echo "(RDS ingress rule already exists)"

# ============================================================================
# Step 3: RDS PostgreSQL (Free Tier - db.t3.micro, private)
# ============================================================================
echo "=== Step 3: RDS PostgreSQL ==="

# Create DB subnet group
aws rds create-db-subnet-group \
  --db-subnet-group-name "${APP_NAME}-subnet-group" \
  --db-subnet-group-description "Subnets for ${APP_NAME} RDS" \
  --subnet-ids $SUBNET_1 $SUBNET_2 \
  --region $REGION 2>/dev/null || echo "(Subnet group already exists)"

# Create RDS instance (Free Tier eligible)
aws rds create-db-instance \
  --db-instance-identifier $DB_INSTANCE_ID \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 16.3 \
  --master-username $DB_USER \
  --master-user-password "$DB_PASSWORD" \
  --allocated-storage 20 \
  --db-name $DB_NAME \
  --vpc-security-group-ids $RDS_SG_ID \
  --db-subnet-group-name "${APP_NAME}-subnet-group" \
  --no-publicly-accessible \
  --backup-retention-period 7 \
  --storage-encrypted \
  --region $REGION 2>/dev/null || echo "(RDS instance already exists)"

echo "Waiting for RDS to become available (this takes 5-10 minutes)..."
aws rds wait db-instance-available \
  --db-instance-identifier $DB_INSTANCE_ID --region $REGION

DB_ENDPOINT=$(aws rds describe-db-instances \
  --db-instance-identifier $DB_INSTANCE_ID \
  --query 'DBInstances[0].Endpoint.Address' --output text --region $REGION)
echo "RDS Endpoint: $DB_ENDPOINT"

# ============================================================================
# Step 4: ECR Repository
# ============================================================================
echo "=== Step 4: ECR Repository ==="

aws ecr create-repository \
  --repository-name $ECR_REPO \
  --region $REGION 2>/dev/null || echo "(ECR repo already exists)"

ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPO}"
echo "ECR URI: $ECR_URI"

# ============================================================================
# Step 5: Build and Push Initial Docker Image
# ============================================================================
echo "=== Step 5: Build & Push Docker Image ==="

aws ecr get-login-password --region $REGION | \
  docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

docker build -f Dockerfile.lambda -t "${ECR_URI}:latest" .
docker push "${ECR_URI}:latest"

# ============================================================================
# Step 6: Lambda IAM Role
# ============================================================================
echo "=== Step 6: Lambda IAM Role ==="

# Create role
aws iam create-role \
  --role-name $LAMBDA_ROLE_NAME \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "lambda.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }' 2>/dev/null || echo "(Role already exists)"

# Attach policies
aws iam attach-role-policy --role-name $LAMBDA_ROLE_NAME \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole
aws iam attach-role-policy --role-name $LAMBDA_ROLE_NAME \
  --policy-arn arn:aws:iam::aws:policy/AmazonBedrockFullAccess

echo "Waiting 10s for IAM role to propagate..."
sleep 10

# ============================================================================
# Step 7: Create Lambda Function (in VPC, same subnets as RDS)
# ============================================================================
echo "=== Step 7: Lambda Function ==="

JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')

aws lambda create-function \
  --function-name $APP_NAME \
  --package-type Image \
  --code "ImageUri=${ECR_URI}:latest" \
  --role "arn:aws:iam::${ACCOUNT_ID}:role/${LAMBDA_ROLE_NAME}" \
  --timeout 120 \
  --memory-size 512 \
  --region $REGION \
  --vpc-config "SubnetIds=${SUBNET_1},${SUBNET_2},SecurityGroupIds=${LAMBDA_SG_ID}" \
  --environment "Variables={
    JWT_SECRET=${JWT_SECRET},
    DB_HOST=${DB_ENDPOINT},
    DB_PORT=5432,
    DB_NAME=${DB_NAME},
    DB_USER=${DB_USER},
    DB_PASSWORD=${DB_PASSWORD},
    DB_SSL=true,
    NODE_ENV=production
  }" 2>/dev/null || echo "(Function already exists, updating config...)"

# Update if already exists
aws lambda update-function-configuration \
  --function-name $APP_NAME \
  --timeout 120 \
  --memory-size 512 \
  --vpc-config "SubnetIds=${SUBNET_1},${SUBNET_2},SecurityGroupIds=${LAMBDA_SG_ID}" \
  --environment "Variables={
    JWT_SECRET=${JWT_SECRET},
    DB_HOST=${DB_ENDPOINT},
    DB_PORT=5432,
    DB_NAME=${DB_NAME},
    DB_USER=${DB_USER},
    DB_PASSWORD=${DB_PASSWORD},
    DB_SSL=true,
    NODE_ENV=production
  }" --region $REGION 2>/dev/null || true

echo "Waiting for Lambda to be ready..."
aws lambda wait function-active-v2 --function-name $APP_NAME --region $REGION

# ============================================================================
# Step 8: Lambda Function URL (public HTTPS with response streaming)
# ============================================================================
echo "=== Step 8: Function URL ==="

FUNCTION_URL=$(aws lambda create-function-url-config \
  --function-name $APP_NAME \
  --auth-type NONE \
  --invoke-mode RESPONSE_STREAM \
  --region $REGION \
  --query 'FunctionUrl' --output text 2>/dev/null || \
  aws lambda get-function-url-config \
    --function-name $APP_NAME \
    --region $REGION \
    --query 'FunctionUrl' --output text)

# Allow public invocation
aws lambda add-permission \
  --function-name $APP_NAME \
  --statement-id public-url-access \
  --action lambda:InvokeFunctionUrl \
  --principal '*' \
  --function-url-auth-type NONE \
  --region $REGION 2>/dev/null || echo "(Permission already exists)"

# ============================================================================
# Step 9: Run Migrations (via Lambda invoke since RDS is private)
# ============================================================================
echo "=== Step 9: Run Migrations ==="
echo ""
echo "⚠️  RDS is in a private subnet — you cannot connect directly from your machine."
echo "    Options to run migrations:"
echo ""
echo "  Option A: Use a bastion/jump host in the same VPC"
echo "  Option B: Temporarily make RDS publicly accessible, run migrations, then disable"
echo "  Option C: Add a migration endpoint to Lambda (recommended for future deploys)"
echo ""
echo "For initial setup, using Option B:"
echo ""
echo "  aws rds modify-db-instance --db-instance-identifier $DB_INSTANCE_ID \\"
echo "    --publicly-accessible --region $REGION"
echo "  aws rds wait db-instance-available --db-instance-identifier $DB_INSTANCE_ID --region $REGION"
echo ""
echo "  for f in migrations/*.sql; do"
echo "    psql \"postgres://${DB_USER}:${DB_PASSWORD}@${DB_ENDPOINT}:5432/${DB_NAME}?sslmode=require\" -f \"\$f\""
echo "  done"
echo ""
echo "  # Then disable public access:"
echo "  aws rds modify-db-instance --db-instance-identifier $DB_INSTANCE_ID \\"
echo "    --no-publicly-accessible --region $REGION"
echo ""
echo "  # Seed admin user:"
echo "  DB_HOST=${DB_ENDPOINT} DB_PORT=5432 DB_USER=${DB_USER} DB_PASSWORD=${DB_PASSWORD} \\"
echo "    DB_NAME=${DB_NAME} npx tsx scripts/seed-admin.ts"

# ============================================================================
# Done!
# ============================================================================
echo ""
echo "============================================"
echo "✅ Deployment complete!"
echo "============================================"
echo ""
echo "App URL: $FUNCTION_URL"
echo "RDS Endpoint: $DB_ENDPOINT (private, Lambda-only access)"
echo ""
echo "GitHub Actions will auto-deploy on push to main."
echo "Add these GitHub Secrets:"
echo "  AWS_ACCESS_KEY_ID = <your deploy IAM user key>"
echo "  AWS_SECRET_ACCESS_KEY = <your deploy IAM user secret>"
echo ""
echo "Security Summary:"
echo "  ✅ RDS is NOT publicly accessible"
echo "  ✅ RDS accepts connections only from Lambda security group"
echo "  ✅ Lambda is in VPC with RDS access"
echo "  ✅ Function URL provides HTTPS with response streaming"
echo "  ✅ Secrets are in Lambda environment variables (not in code)"
echo "  ✅ Storage encrypted at rest"
echo "============================================"
