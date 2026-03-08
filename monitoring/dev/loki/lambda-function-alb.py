import os, json, gzip, time
import boto3
import urllib.request
from urllib.parse import unquote_plus

s3 = boto3.client("s3")

LOKI_PUSH_URL = os.environ["LOKI_PUSH_URL"]
STREAM_LABELS = json.loads(os.environ.get("STREAM_LABELS", "{}"))

# === 필터 튜닝 포인트 ===
SEND_4XX = True          # 4xx도 보낼지
SLOW_TARGET_SEC = 1.0     # target_processing_time 기준 슬로우 임계값(초)

def _push_lines_to_loki(lines):
    ts = str(int(time.time() * 1e9))
    values = [[ts, line] for line in lines if line.strip()]
    if not values:
        return

    payload = {"streams": [{"stream": STREAM_LABELS, "values": values}]}
    data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(
        LOKI_PUSH_URL,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        resp.read()

def _safe_float(x: str) -> float:
    try:
        return float(x)
    except Exception:
        return -1.0

def should_send_alb_line(line: str) -> bool:
    """
    ALB access log (space-delimited)에서:
    - status(ELB/target) >= 500 이면 전송
    - (옵션) 4xx도 전송
    - target_processing_time >= SLOW_TARGET_SEC 이면 전송
    - 101(websocket upgrade) 같이 정상은 제외
    """
    # 빠른 실패
    if not line or line.startswith("#"):
        return False

    parts = line.split(" ")
    # 최소 길이 가드(형식 깨진 줄 방지)
    if len(parts) < 12:
        return False

    # ALB 포맷 기준 (일반적으로)
    # parts[4]=request_processing_time, [5]=target_processing_time, [6]=response_processing_time
    # parts[8]=elb_status_code, [9]=target_status_code (환경/버전에 따라 다를 수 있어 가드)
    target_time = _safe_float(parts[5]) if len(parts) > 5 else -1.0

    elb_status = int(parts[8]) if len(parts) > 8 and parts[8].isdigit() else -1
    tgt_status = int(parts[9]) if len(parts) > 9 and parts[9].isdigit() else -1

    # 슬로우
    if target_time >= SLOW_TARGET_SEC:
        return True

    # 5xx
    if elb_status >= 500 or tgt_status >= 500:
        return True

    # 4xx (옵션)
    if SEND_4XX and ((400 <= elb_status < 500) or (400 <= tgt_status < 500)):
        return True

    return False

def lambda_handler(event, context):
    for rec in event.get("Records", []):
        b = rec["s3"]["bucket"]["name"]
        k = unquote_plus(rec["s3"]["object"]["key"])  # 중요: 인코딩 해제

        obj = s3.get_object(Bucket=b, Key=k)
        body = obj["Body"].read()

        if body[:2] == b"\x1f\x8b":
            body = gzip.decompress(body)

        text = body.decode("utf-8", errors="replace")
        lines = [ln for ln in text.splitlines() if should_send_alb_line(ln)]

        # 조건에 맞는 라인 없으면 스킵
        if not lines:
            continue

        # Push in chunks
        chunk, size = [], 0
        for line in lines:
            size += len(line) + 1
            chunk.append(line)
            if size >= 200_000:
                _push_lines_to_loki(chunk)
                chunk, size = [], 0
        if chunk:
            _push_lines_to_loki(chunk)

    return {"ok": True}
