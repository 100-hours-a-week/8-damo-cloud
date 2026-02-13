# V3 부하 테스트

단일 테스트 유저 기반, seed 데이터 없이 실행 가능한 부하 테스트 스크립트.

## 특징

- `POST /api/v1/auth/test`로 토큰 발급 (더미 유저)
- VU 증가에 따른 생성/조회 API 부하 검증
- fixtures.json, seed.sql 불필요

## 테스트 종류

| 파일 | 목적 | 예상 시간 |
|------|------|----------|
| `load-test.js` | 그룹/번개 생성 + 조회 부하 | ~4분 |
| `flow-test.js` | 그룹→회식→번개 전체 플로우 | ~5분 |
| `spike-test.js` | 급격한 트래픽 급증 대응 | ~2분 |
| `soak-test.js` | 장시간 안정성 (메모리 누수 등) | 10분+ |

## 실행 방법

```bash
# 로컬 서버 테스트
k6 run load-test.js --env BASE_URL=http://localhost:8080/api/v1

# 운영 서버 테스트
k6 run load-test.js --env BASE_URL=https://damo.today/api/v1

# 소크 테스트 (30분)
k6 run soak-test.js --env DURATION=30m
```

## 테스트 시나리오

### load-test.js

병렬로 3개 시나리오 실행:
1. **group_stress**: 그룹 생성 (VU 1→50)
2. **read_stress**: 조회 API (VU 1→100)
3. **lightning_stress**: 번개 생성 (VU 1→50)

### flow-test.js

사용자 플로우 순차 실행:
1. 그룹 생성
2. 회식 생성
3. 회식 목록 조회
4. 번개 생성
5. 번개 상세 조회

### spike-test.js

급격한 부하:
- 평소 5 VU → 급격히 100 VU → 유지 → 정상화

### soak-test.js

장시간 일정 부하:
- 20 VU 유지, 10분+ (조정 가능)
- 읽기 70% / 쓰기 30% 비율

## SLO 기준

| 항목 | 목표 |
|------|------|
| 그룹/번개 생성 p95 | < 1000ms |
| 조회 p95 | < 500ms |
| 전체 플로우 p95 | < 5000ms |
| 실패율 | < 5% (스파이크: <10%) |

## 주의사항

- 운영 환경에서 실행 시 DB에 테스트 데이터 생성됨
- 소크 테스트는 장시간 실행되므로 리소스 모니터링 권장
- 스파이크 테스트는 순간 부하가 높으므로 서버 상태 확인 후 실행
