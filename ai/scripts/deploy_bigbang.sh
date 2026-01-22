#!/bin/bash
set -euo pipefail

# =========================
# /opt/ai-prod 구조
# =========================
# /opt/ai-prod/
#   deploy.sh
#   incoming/              # CD가 ai-app.tar.gz 업로드하는 곳
#   backup/                # 롤백용 백업 1개만 유지
#     app.prev/            # 이전 app 디렉토리
#   app/
#     ecosystem.ai.config.js # PM2 ecosystem
#
# 호출 예:
#   ./deploy.sh /home/ubuntu/opt/ai-prod/incoming/ai-app.tar.gz
# =========================

BASE_DIR="/home/ubuntu/opt/ai-prod"
DEPLOY_DIR="$BASE_DIR/app"
BACKUP_DIR="$BASE_DIR/backup/app.prev"
INCOMING_TAR="${1:-}"                # 인자로 받은 새 tar 경로
ECOSYSTEM="$DEPLOY_DIR/ecosystem.ai.config.js"

APP_NAME="fastapi-app"                  # pm2 프로세스명
PORT="8000"
HEALTH_URL="http://localhost:${PORT}/health" 

MAX_WAIT=60
SLEEP=2

echo "AI 배포 시작"
echo "Base: $BASE_DIR"
echo "Incoming: $INCOMING_TAR"
echo "Ecosystem: $ECOSYSTEM"

# ---- validate ----
if [ -z "$INCOMING_TAR" ] || [ ! -f "$INCOMING_TAR" ]; then
  echo "Usage: $0 <path-to-incoming-tar.gz>"
  echo "Error: tar not found: $INCOMING_TAR"
  exit 2
fi

if [ ! -f "$ECOSYSTEM" ]; then
  echo "ERROR: ecosystem file not found: $ECOSYSTEM"
  exit 1
fi

mkdir -p "$BASE_DIR/incoming" "$BASE_DIR/backup"

# 1) 기존 앱 중지
echo "1) 기존 AI 앱 중지..."
pm2 stop "$APP_NAME" >/dev/null 2>&1 || echo "실행 중인 앱 없음"

# 2) 기존 app 백업(1개만 유지)
echo "2) 기존 앱 백업..."
rm -rf "$BACKUP_DIR" || true
if [ -d "$DEPLOY_DIR" ]; then
  mv "$DEPLOY_DIR" "$BACKUP_DIR"
  echo "백업 완료: $BACKUP_DIR"
fi

# 3) 새 버전 반영 (extract)
echo "3) 새 버전 반영 (tar extract)..."
rm -rf "$DEPLOY_DIR" || true
mkdir -p "$DEPLOY_DIR"
tar -xzf "$INCOMING_TAR" -C "$DEPLOY_DIR"

# 3-1) tar가 최상위 폴더 1개로 감싸져 있으면 내용만 꺼내기
TOP_COUNT="$(find "$DEPLOY_DIR" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')"
if [ "$TOP_COUNT" -eq 1 ]; then
  ONLY_ITEM="$(find "$DEPLOY_DIR" -mindepth 1 -maxdepth 1)"
  if [ -d "$ONLY_ITEM" ]; then
    echo "tar 최상위 폴더 감지 → 내용만 app/로 이동"
    shopt -s dotglob
    mv "$ONLY_ITEM"/* "$DEPLOY_DIR"/
    shopt -u dotglob
    rmdir "$ONLY_ITEM" || true
  fi
fi

# 3-2) 최소 검증 
if [ ! -f "$DEPLOY_DIR/requirements.txt" ]; then
  echo "ERROR: requirements.txt not found in $DEPLOY_DIR"
  exit 1
fi

# FastAPI 엔트리 검증
if [ ! -f "$DEPLOY_DIR/main.py" ]; then
  echo "ERROR: main.py not found in $DEPLOY_DIR"
  exit 1
fi

# 4) PM2 재기동 
echo "4) PM2로 재기동..."
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true

# ecosystem가 cwd를 가지고 있어도, 여기서는 DEPLOY_DIR 기준으로 실행하는게 안전
cd "$DEPLOY_DIR"
pm2 start "$ECOSYSTEM" --only "$APP_NAME" --update-env >/dev/null 2>&1
pm2 save >/dev/null 2>&1 || true

# 5) 헬스체크
echo "5) 헬스체크 대기..."
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

# 6) 실패 시 롤백
if [ "$HEALTH_OK" -ne 1 ]; then
  echo "헬스체크 실패. 롤백합니다."
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
  exit 1
fi

# incoming 정리
rm -f "$INCOMING_TAR" || true

echo "AI 배포 완료"