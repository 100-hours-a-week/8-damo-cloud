#!/usr/bin/env bash
set -euo pipefail

# =========================
# Config
# =========================
DISCORD_WEBHOOK_URL="${DISCORD_WEBHOOK_URL:-}"
HOSTNAME="$(hostname -f 2>/dev/null || hostname)"
STATE_DIR="/home/ubuntu/var/lib/healthcheck"
LOCK_FILE="${STATE_DIR}/healthcheck.lock"

# 3회 연속 실패 -> 장애로 판정 (HTTP/PM2 공통 적용)
FAIL_THRESHOLD=3

# 체크 대상들 (원하면 더 추가)
CHECKS=(
  "be|http://127.0.0.1:8080/api/healthy|200"
  "ai|http://127.0.0.1:8000/ai/api/health|200"
  "fe|http://127.0.0.1:3000/api/health|200"
)

# PM2 프로세스 체크(프로세스명 기준)
PM2_PROCS=(
  "spring-app"
  "next-app"
  "fastapi-app"
)

# 디스크 사용률 경고 임계치(%)
DISK_WARN=85
DISK_CRIT=92

# 디스크 체크 대상 마운트포인트 (추가/삭제 가능)
DISK_MOUNTS=(
  "/"
  "/var/log"
  "/home/ubuntu/opt"
  "/var/lib/docker"
)

# =========================
# Helpers
# =========================
mkdir -p "$STATE_DIR"
exec 200>"$LOCK_FILE"
flock -n 200 || exit 0  # 중복 실행 방지

have_cmd() { command -v "$1" >/dev/null 2>&1; }

# Discord webhook send (never fail the whole script)
send_discord() {
  local title="$1"
  local message="$2"
  local level="${3:-INFO}"  # INFO/WARN/CRIT

  if [[ -z "${DISCORD_WEBHOOK_URL:-}" ]]; then
    echo "[$level] $title - $message"
    return 0
  fi

  # 제목 + 코드블록(본문)
  local content
  content="$(printf '**[%s]** %s\n```\n%s\n```' "$level" "$title" "$message")"

  if have_cmd jq; then
    curl -sS -X POST \
      -H "Content-Type: application/json" \
      -d "$(jq -n --arg content "$content" '{content: $content}')" \
      "$DISCORD_WEBHOOK_URL" >/dev/null 2>&1 || true
  else
    # 최소 이스케이프 (JSON 문자열 안전 처리)
    content="${content//\\/\\\\}"
    content="${content//\"/\\\"}"
    content="${content//$'\n'/\\n}"
    curl -sS -X POST \
      -H "Content-Type: application/json" \
      -d "{\"content\":\"$content\"}" \
      "$DISCORD_WEBHOOK_URL" >/dev/null 2>&1 || true
  fi
}

# 상태 파일: <key>.status (OK/DOWN/WARN/CRIT), <key>.fails (int)
get_status() { cat "$STATE_DIR/$1.status" 2>/dev/null || echo "OK"; }
set_status() { echo "$2" > "$STATE_DIR/$1.status"; }

get_fails() { cat "$STATE_DIR/$1.fails" 2>/dev/null || echo "0"; }
set_fails() { echo "$2" > "$STATE_DIR/$1.fails"; }

inc_fails() {
  local key="$1"
  local cur
  cur="$(get_fails "$key")"
  cur=$((cur + 1))
  set_fails "$key" "$cur"
  echo "$cur"
}

reset_fails() { set_fails "$1" "0"; }

# =========================
# 1) HTTP Health checks (local)
# =========================
check_http() {
  local name="$1"
  local url="$2"
  local expect="$3"
  local key="http_${name}"

  local code
  code="$(curl -sS -o /dev/null -w "%{http_code}" --max-time 3 "$url" 2>/dev/null || echo "000")"

  # 성공: OK로 전환 + (이전이 OK가 아니면) 복구 알림
  if [[ "$code" == "$expect" ]]; then
    local prev
    prev="$(get_status "$key")"

    reset_fails "$key"
    set_status "$key" "OK"

    if [[ "$prev" != "OK" ]]; then
      send_discord "RECOVERY: $name health OK" \
        "$(printf 'host: %s\nurl: %s\ncode: %s' "$HOSTNAME" "$url" "$code")" \
        "INFO"
    fi
    return 0
  fi

  # 실패: fails 누적 → 임계치 도달 시 DOWN + 알림(상태 변화 시 1회)
  local fails
  fails="$(inc_fails "$key")"
  if (( fails >= FAIL_THRESHOLD )); then
    local prev
    prev="$(get_status "$key")"
    set_status "$key" "DOWN"
    if [[ "$prev" != "DOWN" ]]; then
      send_discord "ALERT: $name health DOWN" \
        "$(printf 'host: %s\nurl: %s\ncode: %s\nfails: %s/%s' "$HOSTNAME" "$url" "$code" "$fails" "$FAIL_THRESHOLD")" \
        "CRIT"
    fi
  fi
  return 1
}

# =========================
# 2) PM2 process checks (with threshold)
# =========================
get_pm2_status() {
  local proc="$1"

  if ! have_cmd pm2; then echo "NO_PM2"; return 0; fi
  if ! have_cmd jq; then echo "NO_JQ"; return 0; fi

  local status
  status="$(
    pm2 jlist 2>/dev/null \
      | jq -r --arg name "$proc" '.[] | select(.name==$name) | .pm2_env.status' 2>/dev/null \
      | head -n 1 || true
  )"

  if [[ -z "$status" || "$status" == "null" ]]; then
    echo "MISSING"
  else
    echo "$status"
  fi
}

check_pm2_proc() {
  local proc="$1"
  local key="pm2_${proc}"

  local status
  status="$(get_pm2_status "$proc")"

  if [[ "$status" == "NO_PM2" ]]; then
    local prev
    prev="$(get_status "$key")"
    set_status "$key" "DOWN"
    if [[ "$prev" != "DOWN" ]]; then
      send_discord "ALERT: pm2 not found" \
        "$(printf 'host: %s\npm2 command missing' "$HOSTNAME")" \
        "CRIT"
    fi
    return 1
  fi

  if [[ "$status" == "NO_JQ" ]]; then
    local prev
    prev="$(get_status "$key")"
    set_status "$key" "DOWN"
    if [[ "$prev" != "DOWN" ]]; then
      send_discord "ALERT: jq not found" \
        "$(printf 'host: %s\njq command missing (required for pm2 parse)' "$HOSTNAME")" \
        "CRIT"
    fi
    return 1
  fi

  # 성공: online → OK 전환 + (이전이 OK가 아니면) 복구 알림
  if [[ "$status" == "online" ]]; then
    local prev
    prev="$(get_status "$key")"

    reset_fails "$key"
    set_status "$key" "OK"

    if [[ "$prev" != "OK" ]]; then
      send_discord "RECOVERY: PM2 proc online" \
        "$(printf 'host: %s\nproc: %s\nstatus: %s' "$HOSTNAME" "$proc" "$status")" \
        "INFO"
    fi
    return 0
  fi

  # 실패: fails 누적 → 임계치 도달 시 DOWN + 알림(상태 변화 시 1회)
  local fails
  fails="$(inc_fails "$key")"
  if (( fails >= FAIL_THRESHOLD )); then
    local prev
    prev="$(get_status "$key")"
    set_status "$key" "DOWN"
    if [[ "$prev" != "DOWN" ]]; then
      send_discord "ALERT: PM2 proc not online" \
        "$(printf 'host: %s\nproc: %s\nstatus: %s\nfails: %s/%s' "$HOSTNAME" "$proc" "$status" "$fails" "$FAIL_THRESHOLD")" \
        "CRIT"
    fi
  fi

  return 1
}

# =========================
# 3) Disk usage checks (multi mounts)
# =========================
mount_exists() {
  local m="$1"
  if have_cmd mountpoint; then
    mountpoint -q "$m"
    return $?
  fi
  df -P "$m" >/dev/null 2>&1
}

check_disk_mount() {
  local mount="$1"
  local safe_key
  safe_key="$(echo "$mount" | sed 's#/#_#g' | sed 's/^_$/root/')"
  local key="disk_${safe_key}"

  if ! mount_exists "$mount"; then
    return 0
  fi

  local usep
  usep="$(df -P "$mount" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"

  local prev
  prev="$(get_status "$key")"

  if (( usep >= DISK_CRIT )); then
    set_status "$key" "CRIT"
    if [[ "$prev" != "CRIT" ]]; then
      send_discord "ALERT: Disk CRIT" \
        "$(printf 'host: %s\nmount: %s\nuse: %s%% (crit>=%s%%)' "$HOSTNAME" "$mount" "$usep" "$DISK_CRIT")" \
        "CRIT"
    fi
  elif (( usep >= DISK_WARN )); then
    set_status "$key" "WARN"
    if [[ "$prev" != "WARN" ]]; then
      send_discord "WARN: Disk high" \
        "$(printf 'host: %s\nmount: %s\nuse: %s%% (warn>=%s%%)' "$HOSTNAME" "$mount" "$usep" "$DISK_WARN")" \
        "WARN"
    fi
  else
    set_status "$key" "OK"
    if [[ "$prev" != "OK" ]]; then
      send_discord "RECOVERY: Disk OK" \
        "$(printf 'host: %s\nmount: %s\nuse: %s%%' "$HOSTNAME" "$mount" "$usep")" \
        "INFO"
    fi
  fi
}

# =========================
# Run
# =========================
if [[ -z "$DISCORD_WEBHOOK_URL" ]]; then
  echo "WARN: DISCORD_WEBHOOK_URL not set. Will only print to stdout."
fi

for item in "${CHECKS[@]}"; do
  IFS="|" read -r name url expect <<< "$item"
  check_http "$name" "$url" "$expect" || true
done

for p in "${PM2_PROCS[@]}"; do
  check_pm2_proc "$p" || true
done

for m in "${DISK_MOUNTS[@]}"; do
  check_disk_mount "$m" || true
done