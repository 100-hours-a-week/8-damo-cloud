#!/bin/bash
set -euo pipefail

BASE_DIR="/home/ubuntu/opt/ai-prod"
DEPLOY_DIR="$BASE_DIR/app"
BACKUP_DIR="$BASE_DIR/backup/app.prev"
ECOSYSTEM="$DEPLOY_DIR/ecosystem.ai.config.js"

APP_NAME="fastapi-app"                  # pm2 프로세스명

echo "롤백합니다."
  pm2 delete "$APP_NAME" >/dev/null 2>&1 || true

  if [ -d "$BACKUP_DIR" ]; then
    rm -rf "$DEPLOY_DIR" || true
    mv "$BACKUP_DIR" "$DEPLOY_DIR"
    cd "$DEPLOY_DIR"
    pm2 start "$ECOSYSTEM" --only "$APP_NAME" --update-env >/dev/null 2>&1
    pm2 save >/dev/null 2>&1 || true
    echo "롤백 완료"
  else
    echo "백업이 없어 롤백 불가"
  fi