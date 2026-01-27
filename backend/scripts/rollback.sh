#!/bin/bash
set -euo pipefail

# =========================
# /opt/be-prod 구조(옵션 B)
# =========================
# /home/ubuntu/opt/be-prod/
#   rollback.sh
#   app/
#     app.jar               # 현재 실행 jar
#   backup/
#     app.jar.prev          # 직전 배포 백업 jar (1개)
#   env/
#     prod.env              # Spring이 반영해야 하는 env 파일
# =========================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/env/prod.env"

BASE_DIR="/home/ubuntu/opt/be-prod"
DEPLOY_DIR="$BASE_DIR/app"
BACKUP_JAR="$BASE_DIR/backup/app.jar.prev"
TARGET_JAR="$DEPLOY_DIR/app.jar"

APP_NAME="spring-app"

echo "🧯 BE 롤백 시작"
echo "Base:   $BASE_DIR"
echo "Deploy: $DEPLOY_DIR"
echo "Backup: $BACKUP_JAR"
echo "Env:    $ENV_FILE"

# ---- validate ----
if [ ! -f "$BACKUP_JAR" ]; then
  echo "❌ ERROR: 백업 jar가 없어 롤백 불가: $BACKUP_JAR"
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ ERROR: env file not found: $ENV_FILE"
  exit 2
fi

mkdir -p "$DEPLOY_DIR" "$BASE_DIR/backup"

# 1) 현재 앱 중지
echo "✅ 1) 현재 Spring 앱 종료..."
pm2 stop "$APP_NAME" >/dev/null 2>&1 || echo "실행 중인 앱 없음"
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true

# 2) 백업 복원: backup/app.jar.prev -> app/app.jar
echo "✅ 2) 백업 jar 복원..."
cp -f "$BACKUP_JAR" "$TARGET_JAR"
chmod 755 "$TARGET_JAR"
echo "복원 완료: $TARGET_JAR (source was $BACKUP_JAR)"

# 3) env 로드 (주석/빈줄 무시) + export
echo "✅ 3) env 로드..."
set -a
# shellcheck disable=SC1090
. <(grep -v '^\s*#' "$ENV_FILE" | sed '/^\s*$/d')
set +a

# 4) PM2로 재기동
echo "✅ 4) PM2로 재기동..."
pm2 start java --name "$APP_NAME" --cwd "$DEPLOY_DIR" -- -jar "$TARGET_JAR"

pm2 save >/dev/null 2>&1 || true
echo "🎉 BE 롤백 완료"