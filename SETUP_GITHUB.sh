#!/bin/bash
# ── One-time GitHub setup script ──────────────────────────────────────────────
# Run this once in your terminal to create the repo and push everything.
# After this, every git push to main auto-deploys via GitHub Actions.
#
# Usage:
#   chmod +x SETUP_GITHUB.sh
#   ./SETUP_GITHUB.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

REPO_NAME="wbb-dashboard"
GITHUB_USER="shivpatel6502"

echo ""
echo "🏀 CHPH Performance Analytics — GitHub Setup"
echo "============================================="
echo ""

# ── Step 1: Authenticate GitHub CLI ──────────────────────────────────────────
echo "Step 1: Authenticating with GitHub..."
if ! gh auth status &>/dev/null; then
  gh auth login --web --git-protocol https
fi
echo "✅ Authenticated as $(gh api user --jq .login)"
echo ""

# ── Step 2: Create the GitHub repository ─────────────────────────────────────
echo "Step 2: Creating repository $GITHUB_USER/$REPO_NAME..."
if gh repo view "$GITHUB_USER/$REPO_NAME" &>/dev/null; then
  echo "   ℹ️  Repository already exists — skipping creation"
else
  gh repo create "$REPO_NAME" \
    --public \
    --description "CHPH Performance Analytics — Multi-Sport Athlete Dashboard (University of Windsor)" \
    --homepage "https://$GITHUB_USER.github.io/$REPO_NAME" \
    --source=. \
    --remote=origin \
    --push
  echo "✅ Repository created: https://github.com/$GITHUB_USER/$REPO_NAME"
fi
echo ""

# ── Step 3: Push code ─────────────────────────────────────────────────────────
echo "Step 3: Pushing code to main branch..."
git remote set-url origin "https://github.com/$GITHUB_USER/$REPO_NAME.git"
git push -u origin main
echo "✅ Code pushed"
echo ""

# ── Step 4: Enable GitHub Pages ───────────────────────────────────────────────
echo "Step 4: Enabling GitHub Pages (GitHub Actions source)..."
gh api \
  --method POST \
  -H "Accept: application/vnd.github+json" \
  "/repos/$GITHUB_USER/$REPO_NAME/pages" \
  -f source='{"branch":"main","path":"/"}' \
  --silent 2>/dev/null || true  # silently ignore if already enabled

# Switch to GitHub Actions source
gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  "/repos/$GITHUB_USER/$REPO_NAME/pages" \
  -f build_type="workflow" \
  --silent 2>/dev/null || true

echo "✅ GitHub Pages configured"
echo ""

# ── Done ──────────────────────────────────────────────────────────────────────
echo "============================================="
echo "✅ ALL DONE!"
echo ""
echo "📦 Repository:  https://github.com/$GITHUB_USER/$REPO_NAME"
echo "🌐 Live site:   https://$GITHUB_USER.github.io/$REPO_NAME"
echo "   (GitHub Pages takes ~2 minutes to go live after the Actions workflow completes)"
echo ""
echo "📋 Next steps for full backend:"
echo "   1. Sign up at https://neon.tech  (free PostgreSQL)"
echo "   2. Sign up at https://render.com (free Node.js hosting)"
echo "   3. See README.md for full instructions"
echo ""
