# AWS Infrastructure Setup

## Architecture

```
Users → Lambda Function URL (HTTPS, response streaming)
              ↓
        Lambda (VPC, private subnets)
              ↓                    ↓
    RDS PostgreSQL           AWS Bedrock
    (private, no public IP)  (via VPC Endpoint or NAT Gateway)
```

## Security

- **RDS is NOT publicly accessible** — no public IP, private subnet only
- **RDS security group** allows inbound port 5432 only from the Lambda security group
- **Lambda in VPC** — same subnets as RDS for private connectivity
- **Function URL** provides the public HTTPS endpoint with response streaming (for SSE)
- **Secrets** stored in Lambda environment variables, not in code
- **Storage encrypted** at rest (RDS)

## Deploying

### First Time (one-time setup)

```bash
cd infra
./deploy-setup.sh
```

This creates: VPC security groups, RDS (db.t3.micro free tier), ECR repo, Lambda function, Function URL.

### Subsequent Deploys (automatic via GitHub Actions)

Push to `main` branch → GitHub Actions builds Docker image → pushes to ECR → updates Lambda.

### GitHub Secrets Required

| Secret | Description |
|--------|-------------|
| `AWS_ACCESS_KEY_ID` | IAM user with ECR push + Lambda update permissions |
| `AWS_SECRET_ACCESS_KEY` | Corresponding secret key |

## Important: Lambda VPC Internet Access

When Lambda is in a VPC, it **loses internet access** by default. This affects:
- Calls to **AWS Bedrock** (needs internet or VPC endpoint)
- Calls to **api.budjet.org** (IDR rate fetch from frontend — this is client-side, not affected)

### Option A: VPC Endpoint for Bedrock (recommended, no extra cost for the endpoint itself)

```bash
aws ec2 create-vpc-endpoint \
  --vpc-id <vpc-id> \
  --service-name com.amazonaws.ap-southeast-3.bedrock-runtime \
  --vpc-endpoint-type Interface \
  --subnet-ids <subnet-1> <subnet-2> \
  --security-group-ids <lambda-sg-id> \
  --region ap-southeast-3
```

### Option B: NAT Gateway (adds ~$32/month)

If you need general internet access from Lambda (not just Bedrock):

1. Create an Elastic IP
2. Create a NAT Gateway in a **public** subnet
3. Update the **private** subnet route table to route `0.0.0.0/0` through the NAT Gateway
4. Lambda uses the private subnets

## Cost Estimate (Free Tier Eligible)

| Resource | Monthly Cost |
|----------|-------------|
| RDS db.t3.micro (free tier year 1) | $0 (then ~$13/mo) |
| Lambda (free tier: 1M requests) | $0 for light use |
| ECR (500MB free) | $0 |
| VPC Endpoint for Bedrock | ~$7/mo (per interface) |
| **Year 1 Total** | **~$7/month** |
| **After free tier** | **~$20/month** |

## Running Migrations

Since RDS is private, you can't connect directly. Options:

1. **Temporarily make RDS public** (for initial setup only):
   ```bash
   aws rds modify-db-instance --db-instance-identifier bedrock-gateway-db --publicly-accessible
   # Run migrations...
   aws rds modify-db-instance --db-instance-identifier bedrock-gateway-db --no-publicly-accessible
   ```

2. **Use AWS Session Manager** (SSM) to tunnel through an EC2 bastion

3. **Add a migration Lambda** that runs migrations on deploy (advanced)
