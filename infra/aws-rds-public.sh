#!/usr/bin/env bash
#
# aws-rds-public.sh — Make RDS publicly accessible for cross-cloud (GCP → AWS) connectivity.
#
# Prerequisites:
#   1. AWS CLI installed and configured (aws configure)
#   2. DB_INSTANCE_IDENTIFIER set to the RDS instance name
#
# Usage:
#   export DB_INSTANCE_IDENTIFIER="bedrock-gateway-db"
#   bash infra/aws-rds-public.sh
#
# This script:
#   1. Enables public accessibility on the RDS instance
#   2. Updates the RDS security group to allow inbound PostgreSQL from ANY IP
#      (relies on SSL + strong password for security)
#   3. Outputs the public endpoint for use as DB_HOST in Cloud Run
#
# SECURITY NOTE:
#   This opens port 5432 to 0.0.0.0/0. The database connection uses SSL
#   (rejectUnauthorized: false) and a strong password. For production,
#   consider restricting to Cloud Run's static egress IPs via Cloud NAT.

set -euo pipefail

: "${DB_INSTANCE_IDENTIFIER:?Set DB_INSTANCE_IDENTIFIER to your RDS instance name}"
: "${AWS_REGION:?Set AWS_REGION (e.g., ap-southeast-3)}"

echo "=== RDS Public Access Setup ==="
echo "Instance: $DB_INSTANCE_IDENTIFIER"
echo "Region:   $AWS_REGION"
echo ""

# ── 1. Get current RDS info ─────────────────────────────────────────────────

echo "[1/3] Fetching RDS instance details..."
RDS_INFO=$(aws rds describe-db-instances \
  --db-instance-identifier "$DB_INSTANCE_IDENTIFIER" \
  --region "$AWS_REGION" \
  --query 'DBInstances[0].{PubliclyAccessible:PubliclyAccessible,Endpoint:Endpoint.Address,SecurityGroups:VpcSecurityGroups}' \
  --output json)

PUBLICLY_ACCESSIBLE=$(echo "$RDS_INFO" | jq -r '.PubliclyAccessible')
ENDPOINT=$(echo "$RDS_INFO" | jq -r '.Endpoint')
SG_IDS=$(echo "$RDS_INFO" | jq -r '.SecurityGroups[].VpcSecurityGroupId')

echo "  Current state:"
echo "    PubliclyAccessible: $PUBLICLY_ACCESSIBLE"
echo "    Endpoint:           $ENDPOINT"
echo "    Security Groups:    $SG_IDS"
echo ""

# ── 2. Enable public accessibility ──────────────────────────────────────────

if [ "$PUBLICLY_ACCESSIBLE" = "true" ]; then
  echo "[2/3] RDS is already publicly accessible. Skipping."
else
  echo "[2/3] Enabling public accessibility on RDS..."
  aws rds modify-db-instance \
    --db-instance-identifier "$DB_INSTANCE_IDENTIFIER" \
    --publicly-accessible \
    --apply-immediately \
    --region "$AWS_REGION" \
    --no-cli-pager

  echo "  Waiting for RDS modification to complete (this takes a few minutes)..."
  aws rds wait db-instance-available \
    --db-instance-identifier "$DB_INSTANCE_IDENTIFIER" \
    --region "$AWS_REGION"
  echo "  RDS is now publicly accessible."
fi

# ── 3. Update security group ────────────────────────────────────────────────

echo "[3/3] Updating security group inbound rules..."

for SG_ID in $SG_IDS; do
  SG_NAME=$(aws ec2 describe-security-groups \
    --group-ids "$SG_ID" \
    --region "$AWS_REGION" \
    --query 'SecurityGroups[0].GroupName' --output text)

  echo "  Updating SG: $SG_NAME ($SG_ID)..."

  # Check if PostgreSQL rule from 0.0.0.0/0 already exists
  EXISTING_RULE=$(aws ec2 describe-security-groups \
    --group-ids "$SG_ID" \
    --region "$AWS_REGION" \
    --query "SecurityGroups[0].IpPermissions[?FromPort==\`5432\` && ToPort==\`5432\` && IpRanges[?CidrIp=='0.0.0.0/0']]" \
    --output text)

  if [ -n "$EXISTING_RULE" ]; then
    echo "    Port 5432 from 0.0.0.0/0 already allowed. Skipping."
  else
    aws ec2 authorize-security-group-ingress \
      --group-id "$SG_ID" \
      --protocol tcp \
      --port 5432 \
      --cidr 0.0.0.0/0 \
      --region "$AWS_REGION" \
      --no-cli-pager
    echo "    Added inbound rule: TCP 5432 from 0.0.0.0/0"
  fi
done

# ── Done ────────────────────────────────────────────────────────────────────

echo ""
echo "=== RDS Public Access Enabled ==="
echo ""
echo "Add this to GitHub repository secrets and Cloud Run env vars:"
echo ""
echo "  DB_HOST: $ENDPOINT"
echo ""
echo "The database is now reachable from Cloud Run via SSL on port 5432."
echo "Connection is encrypted (SSL with rejectUnauthorized: false)."
