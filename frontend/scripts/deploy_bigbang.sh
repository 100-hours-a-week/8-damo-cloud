#!/bin/bash
set -euo pipefail

# =========================
# /opt/fe-prod 구조 (non-standalone)
# =========================
# /opt/fe-prod/
#   deploy.sh
#   incoming/              # CD가 next-build.tar.gz 업로드하는 곳
#   app/                   # 실제 실행 위치 (Next build 결과)
#     .next/               # 빌드 산출물
#     public/              # (옵션)
#     package.json
#     package-lock.json    # 있으면 npm ci 사용
#     next.config.*        # (옵션)
#     node_modules/        # 서버에서 npm ci로 설치됨
#   backup/
#     app.prev/            # 이전 app 디렉토리
#
# 호출 예:
#   ./deploy.sh /opt/fe-prod/incoming/next-build.tar.gz
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

echo "🚀 FE 배포 시작 (non-standalone)"
echo "Base: $BASE_DIR"
echo "Deploy: $DEPLOY_DIR"
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
if [ -d "$DEPLOY_DIR" ] && [ -d "$DEPLOY_DIR/.next" ]; then
  mv "$DEPLOY_DIR" "$BACKUP_DIR"
  echo "백업 완료: $BACKUP_DIR"
  mkdir -p "$DEPLOY_DIR"
else
  echo "백업 대상(.next)이 없거나 비정상 상태, 스킵"
  rm -rf "$DEPLOY_DIR" || true
  mkdir -p "$DEPLOY_DIR"
fi

# 3) 새 버전 반영 (incoming tar -> app)
echo "✅ 3) 새 버전 반영 (tar extract)..."
rm -rf "$DEPLOY_DIR" || true
mkdir -p "$DEPLOY_DIR"
tar -xzf "$INCOMING_TAR" -C "$DEPLOY_DIR"

# 기본 검증: build 산출물(.next) 확인
if [ ! -d "$DEPLOY_DIR/.next" ]; then
  echo "❌ ERROR: .next not found after extract. (CI 패키징에서 .next 포함 확인 필요)"
  exit 1
fi

# 4) 의존성 설치 + PM2로 재기동
echo "✅ 4) 의존성 설치 + PM2 재기동..."
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true

cd "$DEPLOY_DIR"

# package.json 체크
if [ ! -f "package.json" ]; then
  echo "❌ ERROR: package.json not found. (CI 패키징에 package.json 포함 필요)"
  exit 1
fi

# ---- IMPORTANT: disable husky on server installs ----
export HUSKY=0
export CI=true

# node_modules 설치 (Next non-standalone은 런타임 의존성 필요)
if [ -f "package-lock.json" ]; then
  echo "📦 npm ci --omit=dev (HUSKY=0, CI=true)"
  npm ci --omit=dev --ignore-scripts
else
  echo "📦 npm install --omit=dev (package-lock.json 없음, HUSKY=0, CI=true)"
  npm install --omit=dev --ignore-scripts
fi

# Next 실행: npm start (내부적으로 next start)
NODE20=/home/ubuntu/.nvm/versions/node/v20.20.0/bin/node
pm2 start "$NODE20" --name "$APP_NAME" -- ./node_modules/next/dist/bin/next start -p "$PORT" >/dev/null 2>&1

# 5) 헬스체크
#echo "✅ 5) 헬스체크 대기..."
#HEALTH_OK=0
#for ((t=0; t<MAX_WAIT; t+=SLEEP)); do
#  if curl -sf "$HEALTH_URL" >/dev/null; then
#    echo "✅ 헬스체크 성공"
#    HEALTH_OK=1
#    break
#  fi
#  echo "...대기 중 (${t}s)"
#  sleep "$SLEEP"
#done

# 6) 실패 시 롤백
#if [ "$HEALTH_OK" -ne 1 ]; then
#  echo "❌ 헬스체크 실패. 롤백합니다."
#  pm2 delete "$APP_NAME" >/dev/null 2>&1 || true

#  if [ -d "$BACKUP_DIR" ] && [ -d "$BACKUP_DIR/.next" ]; then
#    rm -rf "$DEPLOY_DIR" || true
#    mv "$BACKUP_DIR" "$DEPLOY_DIR"

#    cd "$DEPLOY_DIR"

#    export HUSKY=0
#    export CI=true

 #   if [ -f "package-lock.json" ]; then
 #     npm ci --omit=dev --ignore-scripts
 #   else
 #     npm install --omit=dev --ignore-scripts
#    fi

#    pm2 start npm --name "$APP_NAME" -- start -- -p "$PORT" >/dev/null 2>&1
#    pm2 save >/dev/null 2>&1 || true
#    echo "✅ 롤백 완료"
#  else
#    echo "⚠️ 백업이 없어 롤백 불가"
#  fi

#  exit 1
#fi

# (선택) incoming 정리: 남겨두고 싶으면 주석 처리
rm -f "$INCOMING_TAR" || true

pm2 save >/dev/null 2>&1 || true
echo "🎉 FE 배포 완료 (non-standalone)"