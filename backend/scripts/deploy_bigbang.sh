#!/bin/bash
set -euo pipefail

# =========================
# /opt/be-prod 구조(옵션 B)
# =========================
# /opt/be-prod/
#   deploy.sh
#   incoming/          # CD가 app.jar 업로드하는 곳
#   app/               # 실제 실행 jar 위치
#     app.jar
#   backup/            # 롤백용 백업 1개만 유지
#     app.jar.prev
#
# 호출 예:
#   ./deploy.sh /opt/be-prod/incoming/app.jar
# =========================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/env/prod.env"
BASE_DIR="/home/ubuntu/opt/be-prod"
DEPLOY_DIR="$BASE_DIR/app"
INCOMING_JAR="${1:-}"                 # 인자로 받은 새 jar 경로
BACKUP_JAR="$BASE_DIR/backup/app.jar.prev"
TARGET_JAR="$DEPLOY_DIR/app.jar"

APP_NAME="spring-app"                 # pm2 프로세스명
PORT="8080"
HEALTH_URL="http://localhost:${PORT}/api/healthy"

MAX_WAIT=60
SLEEP=2

# ---- validate ----
if [ -z "$INCOMING_JAR" ] || [ ! -f "$INCOMING_JAR" ]; then
  echo "Usage: $0 <path-to-incoming-jar>"
  echo "Error: jar not found: $INCOMING_JAR"
  exit 2
fi

# ---- ensure dirs ----
mkdir -p "$BASE_DIR/incoming" "$DEPLOY_DIR" "$BASE_DIR/backup"

echo "✅ 1) 기존 앱 중지..."
pm2 stop "$APP_NAME" >/dev/null 2>&1 || echo "실행 중인 앱 없음"

echo "✅ 2) 기존 jar 백업..."
if [ -f "$TARGET_JAR" ]; then
  cp -f "$TARGET_JAR" "$BACKUP_JAR"
  echo "백업 완료: $BACKUP_JAR"
else
  echo "백업 대상 없음, 스킵"
fi

echo "✅ 3) 새 jar 반영 (incoming -> app)..."
cp -f "$INCOMING_JAR" "$TARGET_JAR"
chmod 755 "$TARGET_JAR"

# ✅ env 로드 (주석/빈줄 무시) + export
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: env file not found: $ENV_FILE"
  exit 2
fi

set -a
# shellcheck disable=SC1090
. <(grep -v '^\s*#' "$ENV_FILE" | sed '/^\s*$/d')
set +a

echo "✅ 4) PM2로 재기동..."
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
pm2 start java --name "$APP_NAME" --cwd "$DEPLOY_DIR" -- -jar "$TARGET_JAR"

echo "✅ 5) 헬스체크 대기..."
HEALTH_OK=0
for ((t=0; t<MAX_WAIT; t+=SLEEP)); do
  if curl -sf "$HEALTH_URL" >/dev/null; then
    echo "헬스체크 성공"
    HEALTH_OK=1
    break
  fi
  echo "...대기 중 (${t}s)"
  sleep "$SLEEP"
done

if [ "$HEALTH_OK" -ne 1 ]; then
  echo "❌ 헬스체크 실패. 롤백합니다."

  pm2 delete "$APP_NAME" >/dev/null 2>&1 || true

  if [ -f "$BACKUP_JAR" ]; then
    cp -f "$BACKUP_JAR" "$TARGET_JAR"
    chmod 755 "$TARGET_JAR"
    pm2 start java --name "$APP_NAME" --cwd "$DEPLOY_DIR" -- -jar "$TARGET_JAR"
    pm2 save >/dev/null 2>&1 || true
    echo "✅ 롤백 완료"
  else
    echo "⚠️ 백업 jar가 없어 롤백 불가"
  fi

  exit 1
fi

# (선택) incoming 정리: 남겨두고 싶으면 주석 처리
rm -f "$INCOMING_JAR" || true

pm2 save >/dev/null 2>&1 || true
echo "🎉 배포 완료"