#!/bin/bash
set -euo pipefail

# =========================
# /opt/fe-prod 구조 (non-standalone)
# =========================
# /home/ubuntu/opt/fe-prod/
#   rollback.sh
#   app/                   # 현재 실행 위치
#   backup/
#     app.prev/            # 직전 배포 백업(디렉토리)
#   env/
#     prod.env
# =========================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/env/prod.env"

BASE_DIR="/home/ubuntu/opt/fe-prod"
DEPLOY_DIR="$BASE_DIR/app"
BACKUP_DIR="$BASE_DIR/backup/app.prev"

APP_NAME="next-app"
PORT="3000"

echo "🧯 FE 롤백 시작"
echo "Base:   $BASE_DIR"
echo "Deploy: $DEPLOY_DIR"
echo "Backup: $BACKUP_DIR"
echo "Env:    $ENV_FILE"

# ---- validate ----
if [ ! -d "$BACKUP_DIR" ] || [ ! -d "$BACKUP_DIR/.next" ]; then
  echo "❌ ERROR: 롤백 백업이 없거나(.next 없음) 비정상입니다: $BACKUP_DIR"
  exit 1
fi

# 1) 현재 앱 중지
echo "✅ 1) 현재 Next 앱 종료..."
pm2 stop "$APP_NAME" >/dev/null 2>&1 || echo "실행 중인 앱 없음"
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true

# 2) (선택) 현재 app을 임시로 치워두기 (문제 생기면 수동 복구용)
#    - 원하면 아래 2줄 주석 해제해서 "app.bad.TIMESTAMP"로 보관 가능
# BAD_DIR="$BASE_DIR/backup/app.bad.$(date +%Y%m%d%H%M%S)"
# [ -d "$DEPLOY_DIR" ] && mv "$DEPLOY_DIR" "$BAD_DIR" || true

# 2) 백업 복원: backup/app.prev -> app
echo "✅ 2) 백업 복원..."
rm -rf "$DEPLOY_DIR" || true
mv "$BACKUP_DIR" "$DEPLOY_DIR"
echo "복원 완료: $DEPLOY_DIR (source was $BACKUP_DIR)"

# 3) 의존성 설치 + 재기동
echo "✅ 3) 의존성 설치 + PM2 재기동..."
cd "$DEPLOY_DIR"

if [ ! -f "package.json" ]; then
  echo "❌ ERROR: package.json not found in restored app"
  exit 1
fi

export HUSKY=0
export CI=true

if [ -f "package-lock.json" ]; then
  echo "📦 npm ci --omit=dev (HUSKY=0, CI=true)"
  npm ci --omit=dev --ignore-scripts
else
  echo "📦 npm install --omit=dev (package-lock.json 없음)"
  npm install --omit=dev --ignore-scripts
fi

# env 로드
set -a
. <(grep -v '^\s*#' "$ENV_FILE" | sed '/^\s*$/d')
set +a

echo "✅ env loaded. (example) NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL:-<unset>}"

NODE20=/home/ubuntu/.nvm/versions/node/v20.20.0/bin/node
pm2 start "$NODE20" --name "$APP_NAME" --update-env -- ./node_modules/next/dist/bin/next start -p "$PORT"

pm2 save >/dev/null 2>&1 || true
echo "🎉 FE 롤백 완료"