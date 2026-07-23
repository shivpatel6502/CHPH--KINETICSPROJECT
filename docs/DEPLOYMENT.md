# WBB CHPH Dashboard — Deployment Guide

## Architecture Overview

```
Browser
  │
  ├─► CloudFront (HTTPS) ──► S3 (frontend: HTML/CSS/JS)
  │
  └─► API Gateway / ALB ──► ECS Fargate (Node/Express)
                                   │
                          ┌────────┼────────┐
                          │        │        │
                       RDS PG  Secrets   Anthropic
                       (data)  Manager  Claude API
                                (key)
```

## Prerequisites
- AWS CLI configured
- Docker installed
- Node.js 20+
- A registered domain in Route 53
- ACM certificate for your domain (us-east-1 for CloudFront)

---

## Step 1 — Clone & Configure

```bash
git clone <your-repo>
cd wbb-dashboard
cp backend/.env.example backend/.env
# Edit backend/.env with your local DB and dev API key
```

---

## Step 2 — Local Development

```bash
# Start PostgreSQL locally (Docker)
docker run -d --name wbb-pg \
  -e POSTGRES_DB=wbb_dashboard \
  -e POSTGRES_USER=wbb_admin \
  -e POSTGRES_PASSWORD=localpass \
  -p 5432:5432 postgres:16-alpine

# Install dependencies
cd backend && npm install

# Run migrations
DB_PASSWORD=localpass npm run migrate

# Seed data
DB_PASSWORD=localpass npm run seed

# Start dev server
npm run dev
# API at http://localhost:3001

# Open frontend
open frontend/public/index.html
# Or serve with: npx serve frontend/public
```

---

## Step 3 — Deploy AWS Infrastructure

```bash
# Deploy CloudFormation stack
aws cloudformation deploy \
  --template-file infrastructure/cloudformation/stack.yml \
  --stack-name wbb-dashboard \
  --parameter-overrides \
    DBPassword=YOUR_SECURE_PASSWORD \
    DomainName=wbb.yourdomain.com \
    CertificateArn=arn:aws:acm:us-east-1:...:certificate/... \
  --capabilities CAPABILITY_IAM \
  --region us-east-1
```

---

## Step 4 — Store API Key in Secrets Manager

```bash
aws secretsmanager put-secret-value \
  --secret-id wbb-dashboard/anthropic-api-key \
  --secret-string '{"ANTHROPIC_API_KEY":"sk-ant-YOUR_KEY_HERE"}' \
  --region us-east-1
```
**Never put the key in .env, code, or GitHub.**

---

## Step 5 — Run Migrations on RDS

```bash
# Get RDS endpoint from CloudFormation outputs
DB_HOST=$(aws cloudformation describe-stacks \
  --stack-name wbb-dashboard \
  --query "Stacks[0].Outputs[?OutputKey=='DatabaseEndpoint'].OutputValue" \
  --output text)

DB_HOST=$DB_HOST DB_PASSWORD=YOUR_PASS npm run migrate --prefix backend
DB_HOST=$DB_HOST DB_PASSWORD=YOUR_PASS npm run seed   --prefix backend
```

---

## Step 6 — Build & Push Docker Image

```bash
# Get ECR URI
ECR_URI=$(aws cloudformation describe-stacks \
  --stack-name wbb-dashboard \
  --query "Stacks[0].Outputs[?OutputKey=='ECRRepository'].OutputValue" \
  --output text)

aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin $ECR_URI

docker build -t $ECR_URI:latest ./backend
docker push $ECR_URI:latest

# Force ECS to pick up new image
aws ecs update-service \
  --cluster wbb-dashboard-cluster \
  --service wbb-api \
  --force-new-deployment
```

---

## Step 7 — Deploy Frontend to S3

```bash
S3_BUCKET=wbb-dashboard-frontend-production

aws s3 sync frontend/public/ s3://$S3_BUCKET/ --delete
aws cloudfront create-invalidation \
  --distribution-id YOUR_CF_DIST_ID \
  --paths "/*"
```

---

## Step 8 — Set Up GitHub Actions CI/CD

Add these secrets to your GitHub repo (`Settings → Secrets`):
| Secret | Value |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | IAM role ARN with ECR/ECS/S3/CloudFront permissions |
| `CLOUDFRONT_DIST_ID`  | CloudFront distribution ID |

Push to `main` → GitHub Actions auto-deploys backend + frontend.

---

## Cost Estimate (monthly, low traffic)

| Service | Est. Cost |
|---|---|
| ECS Fargate (0.25 vCPU, 0.5 GB, ~720 hrs) | ~$9 |
| RDS db.t3.micro | ~$15 |
| S3 + CloudFront | ~$1–3 |
| Anthropic API (cached, ~50 calls/day) | ~$5–15 |
| **Total** | **~$30–42/month** |

CloudWatch billing alarm set at $50/month.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/athletes?season=` | All athletes + latest metrics |
| GET | `/api/athletes/:id` | Single athlete full history |
| GET | `/api/BIOPOD?season=&phase=` | BIOPOD records |
| GET | `/api/BIOPOD/latest` | Latest per athlete |
| GET | `/api/biodex?season=&phase=` | Biodex records |
| GET | `/api/biodex/latest` | Latest per athlete |
| GET | `/api/ai/anomalies?season=` | AI anomaly detection (cached 12h) |
| GET | `/api/ai/forecasts?season=` | AI trend forecasts (cached 12h) |
| GET | `/api/ai/risks?season=` | AI risk scores (cached 12h) |
| GET | `/api/ai/summary/:athleteId` | AI athlete summary (cached 12h) |
| GET | `/api/ai/team?season=` | AI team overview (cached 12h) |
