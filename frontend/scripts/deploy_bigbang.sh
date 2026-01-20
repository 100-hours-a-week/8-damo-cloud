#!/bin/bash
set -euo pipefail

# =========================
# /opt/fe-prod 구조(옵션 B)
# =========================
# /opt/fe-prod/
#   deploy.sh
#   incoming/              # CD가 next-standalone.tar.gz 업로드하는 곳
#   app/                   # 실제 실행(standalone) 위치
#     server.js            # Next standalone 엔트리
#     package.json         # 포함(선택)
#     node_modules/        # standalone에 포함됨
#     .next/static         # 포함됨
#     public/              # 포함(선택)
#   backup/                # 롤백용 백업 1개만 유지
#     app.prev/            # 이전 app 디렉토리
#
# 호출 예:
#   ./deploy.sh /opt/fe-prod/incoming/next-standalone.tar.gz
# =========================

BASE_DIR="/home/ubuntu/opt/fe-prod"
DEPLOY_DIR="$BASE_DIR/app"
BACKUP_DIR="$BASE_DIR/backup/app.prev"
INCOMING_TAR="${1:-}"                # 인자로 받은 새 tar 경로

APP_NAME="next-app"                  # pm2 프로세스명
PORT="3000"
HEALTH_URL="http://localhost:${PORT}/health"   # 너가 만든 /health 기준

MAX_WAIT=60
SLEEP=2

echo "🚀 FE 배포 시작"
echo "Base: $BASE_DIR"
echo "Incoming: $INCOMING_TAR"

# ---- validate ----
if [ -z "$INCOMING_TAR" ] || [ ! -f "$INCOMING_TAR" ]; then
  echo "Usage: $0 <path-to-incoming-tar.gz>"
  echo "Error: tar not found: $INCOMING_TAR"
  exit 2
fi

# ---- ensure dirs ----
mkdir -p "$BASE_DIR/incoming" "$DEPLOY_DIR" "$BASE_DIR/backup"

# 1) 기존 앱 종료
echo "✅ 1) 기존 Next 앱 종료..."
pm2 stop "$APP_NAME" >/dev/null 2>&1 || echo "실행 중인 앱 없음"

# 2) 기존 앱 백업(1개만 유지)
echo "✅ 2) 기존 앱 백업..."
rm -rf "$BACKUP_DIR" || true
if [ -d "$DEPLOY_DIR" ] && [ -f "$DEPLOY_DIR/server.js" ]; then
  mv "$DEPLOY_DIR" "$BACKUP_DIR"
  echo "백업 완료: $BACKUP_DIR"
  mkdir -p "$DEPLOY_DIR"
else
  # app 디렉토리는 존재하지만 standalone이 아닐 수 있어도, 안전하게 백업 폴더는 비워둠
  echo "백업 대상(standalone)이 없거나 비정상 상태, 스킵"
  rm -rf "$DEPLOY_DIR" || true
  mkdir -p "$DEPLOY_DIR"
fi

# 3) 새 버전 반영 (incoming tar -> app)
echo "✅ 3) 새 버전 반영 (tar extract)..."
rm -rf "$DEPLOY_DIR" || true
mkdir -p "$DEPLOY_DIR"
tar -xzf "$INCOMING_TAR" -C "$DEPLOY_DIR"

# 기본 검증: standalone 엔트리 확인
if [ ! -f "$DEPLOY_DIR/server.js" ]; then
  echo "❌ ERROR: server.js not found after extract. (Next standalone 패키징 확인 필요)"
  exit 1
fi

# 4) PM2로 재기동
echo "✅ 4) PM2로 재기동..."
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true

# Next standalone은 node server.js로 실행 (PORT env로 포트 지정)
# pm2 start node -- server.js 형태가 가장 단순/안정적
pm2 start node --name "$APP_NAME" --cwd "$DEPLOY_DIR" -- server.js --port "$PORT" >/dev/null 2>&1 \
  || PORT="$PORT" pm2 start node --name "$APP_NAME" --cwd "$DEPLOY_DIR" -- server.js >/dev/null 2>&1

# 5) 헬스체크
echo "✅ 5) 헬스체크 대기..."
HEALTH_OK=0
for ((t=0; t<MAX_WAIT; t+=SLEEP)); do
  if curl -sf "$HEALTH_URL" >/dev/null; then
    echo "✅ 헬스체크 성공"
    HEALTH_OK=1
    break
  fi
  echo "...대기 중 (${t}s)"
  sleep "$SLEEP"
done

# 6) 실패 시 롤백
if [ "$HEALTH_OK" -ne 1 ]; then
  echo "❌ 헬스체크 실패. 롤백합니다."

  pm2 delete "$APP_NAME" >/dev/null 2>&1 || true

  if [ -d "$BACKUP_DIR" ] && [ -f "$BACKUP_DIR/server.js" ]; then
    rm -rf "$DEPLOY_DIR" || true
    mv "$BACKUP_DIR" "$DEPLOY_DIR"

    pm2 start node --name "$APP_NAME" --cwd "$DEPLOY_DIR" -- server.js --port "$PORT" >/dev/null 2>&1 \
      || PORT="$PORT" pm2 start node --name "$APP_NAME" --cwd "$DEPLOY_DIR" -- server.js >/dev/null 2>&1

    pm2 save >/dev/null 2>&1 || true
    echo "✅ 롤백 완료"
  else
    echo "⚠️ 백업이 없어 롤백 불가"
  fi

  exit 1
fi

# (선택) incoming 정리: 남겨두고 싶으면 주석 처리
rm -f "$INCOMING_TAR" || true

pm2 save >/dev/null 2>&1 || true
echo "🎉 FE 배포 완료"