### [M6] 부하 테스트 시나리오 설계, 구현 및 문서화

---

## 1. 목표

- V1 서비스에서 다음 병목을 조기 탐지
    - 투표 API의 동시성, 집계, 완료 트리거 안정성
    - AI 기반 회식 장소 추천, 재추천 API의 응답 지연(p95/p99)과 실패율
    - 토큰 재발급 - reissue 경로의 안정성

---

## 2. 대상 API

- `/api/v1/groups/{groupId}/dining/{diningId}/attendance-vote`
    - 자신이 속한 그룹의 생성된 회식에 대한 투표
    - 이 API에서 모든 참가자의 투표가 마무리되면 실제 음식점 추천 진행
- `/api/v1/groups/{groupId}/dining/{diningId}/recommend-restaurant/refresh`
    - 투표 결과에 대해 불만족 시 재 추천 진행
- `/api/v1/auth/reissue`
    - 리프레시 토큰으로 AT/RT 재발급

---

## 3. 테스트 데이터

K6가 실제 서비르 플로우를 만들려면 최소 이 3가지 데이터는 필요

(각 엔티티 사이의 데이터도 필요함, ex: dining_participants):

1. User ↔ RefreshToken 목록
    - K6에서 사용자별로 `reissue` 호출해 AT 획득
2. Group
    - 특정 사용자들이 속한 그룹
3. Dining
    - 해당 Group이 생성한 회식
    - 투표 대상 / 추천 대상이 되는 리소스
- 실제 테스트에서 추가해야 하는 테이블

    ```bash
    # 1. 사용자 (users)                                                                                                                                                                      
    INSERT INTO users (id, email, provider_id, is_push_notification_allowed, onboarding_step, is_withdraw, created_at, updated_at)                                                     
    VALUES (1, 'test@test.com', 12345, false, 'DONE', false, NOW(), NOW());                                                                                                            
                                                                                                                                                                                         
    # 2. 그룹 (groups)                                                                                                                                                                        
    INSERT INTO groups (id, name, total_members, latitude, longitude, created_at, updated_at)                                                                                          
    VALUES (1, '테스트그룹', 1, 37.5665, 126.9780, NOW(), NOW());                                                                                                                      
                                                                                                                                                                                         
    # 3. 사용자-그룹 매핑 (users_groups)                                                                                                                                                            
    INSERT INTO users_groups (id, users_id, groups_id, role)                                                                                                                           
    VALUES (1, 1, 1, 'LEADER');                                                                                                                                                        
                                                                                                                                                                                         
    # 4. 회식 (dining)                                                                                                                                                                   
    INSERT INTO dining (id, groups_id, dining_date, vote_due_date, budget, dining_status, created_at, updated_at)                                                                      
    VALUES (1, 1, '2026-02-15 19:00:00', '2026-02-10 23:59:59', 30000, 'VOTING', NOW(), NOW());                                                                                        
                                                                                                                                                                                         
    # 5. 회식 참석자 (dining_participants)                                                                                                                                                            
    INSERT INTO dining_participants (id, dining_id, users_id, voting_status)                                                                                                           
    VALUES (1, 1, 1, 'PENDING');                                                                                                                                                       
                                                                                                                                                                                         
    # 6. 인증용 (Refresh Token)                                                                                                                                               
    INSERT INTO refresh_tokens (id, users_id, token)                                                                                                                                   
    VALUES (1, 1, 'your-refresh-token-here');    
    ```


### 데이터 준비 방식

- Seed SQL + 고정 ID/매핑 JSON 생성
    - 장점:
        - 가장 재현 가능, K6 실행마다 동일 조건
    - 산출물:
        - `seed.sql`
            - 직접 더미 데이터 삽입
        - `fixtures.json`
            - (users, refreshTokens, groupId, diningId, role…)

### fixtures.json 예시 구조

- user별로 속한 그룹/회식을 이미 매핑해두면 K6가 단순해짐

```json
{
  "users": [
    { "userId": 1, "refreshToken": "RT1", "groupId": 100, "diningId": 500, "role": "HOST" },
    { "userId": 2, "refreshToken": "RT2", "groupId": 100, "diningId": 500, "role": "MEMBER" }
  ]
}

```

## **4. 시나리오 설계**

과정

1. Access Token 발급
    - kakako login이 필수이기 때문에 미리 DB에 저장한 User ↔ RefreshToken으로 새로운 AT를 발급받는다
2. 위의 API를 기반으로 K6 진행

---

### 시나리오 2개

- **S1. 투표 동시성**
    - 목적
        - vote 집계/완료 트리거/락 경합/중복투표 방지 등 검증
- **S2. 재추천 부하**
    - 목적
        - AI 추천 처리시간(p95/p99)과 실패율/타임아웃 검증

---

### S1. 그룹원들이 동시 투표

**가정**

- 그룹 크기: 5명
- 회식 1개당 참가자 M명이 짧은 시간 창에 몰려서 투표
- 투표 결과가 모두 채워질 때 추천 트리거가 있다면, 그 트리거까지 포함해서 부하가 걸림

**구성 방법**

- VU를 회식장이 아니라 그룹원으로 본다.
- 같은 groupId/diningId를 공유하는 서로 다른 유저들이 동시에 vote를 호출해야 함.

**부하 형태**

- `constant-arrival-rate` 또는 `ramping-arrival-rate`
    - 이유
        - 투표는 짧은 시간에 몰리는 이벤트성 트래픽이 더 적합
- 예시:
    - 워밍업 1분: 10 rps
    - 본구간 3분: 50 rps
    - 스트레스 1분: 100 rps

**검증 포인트**

- 2xx 비율, 409/400(중복투표/검증 실패) 비율이 기대 범위인지
- 투표 완료 시점에 DB/락 경합으로 p99 급증/에러가 터지지 않는지

---

### S2. 추천, 재 추천 반복

**가정**

- 실제 사용자는 경우에 따라 마음에 안 들면 1~3회 정도 refresh를 누를 가능성이 있음
- 따라서 VU가 refresh만 무한 반복하는 건 비현실적 → 확률/상한을 둔다

**부하 형태 추천**

- `constant-vus` + iteration에서 refresh를 확률적으로 수행
    - 예: 투표 완료 후 30% 확률로 refresh 1회, 10% 확률로 2회 추가

**p95/p99는 여유 있게**

- AI 추천은 계산 + 외부 호출 + 캐시 미스 여부에 따라 tail latency가 커짐
- 그래서 V1에선 기준을 높게 잡기보다,
    - fail_rate 낮게(안정성)
    - p99는 넉넉히(현실성)
    - 그리고 실제 운영/측정으로 점점 tighten 하게

---

## 5. SLI/SLO 기준 - V1 예상치

> 지금은 예상치. 게이트는 회귀 탐지용으로만 먼저 잡고 운영 지표로 추후에 보정
>

### 공통 - 전체 요청

- 실패율(`fail_rate`): **< 1%** (초기), 목표는 0.1%(임시) 이하로 점진 강화
    - fail 정의
        - 네트워크 오류 + HTTP status 500/502/503/504
        - (API 계약상 실패로 보는 4xx 제외/포함 여부를 문서에 명시)

### /attendance-vote

- p95: < 400ms
- p99: < 800ms
- 이유
    - DB write + 집계 로직이 있어도 사용자 클릭 응답 성격이라 너무 길면 UX 별로

### /recommend-restaurant/refresh

- p95: **< 3s**
- p99: **< 6s**
- 이유
    - AI 추천은 긴 작업일 수 있음
    - 대신 실패율을 더 엄격히 봄 → 타임아웃/오류가 UX에 치명적

> 숫자는 시작점이야. 실제 한 번 돌려서 “현재치(p95/p99)”를 측정하고, ‘현재치 + 여유*로 1차 게이트를 고정하는 방식이 가장 안전해
>

---

## 6. 고민했던 부분

- 실제 서비스 흐름을 생각하면 그룹내의 회식장이 회식 생성 → 나머지 그룹원들이 투표 → 최종 추천
    - 그룹원들의 투표를 부하테스트에서 설정해야할지 고민.
    - 만약 vu 전체가 개별 그룹의 회식장이라고 가정한다면 사실 많은 사람을 가정할 수 있다고 생각.
        - (10명이 5/5 그룹 → 최대 생성되는 회식은 2개)
        - (10명이 모두 그룹의 회식장 → 최대 생성되는 회식은 10개)
        - 물론 `/groups/{groupId}/dining/{diningId}/attendance-vote` 로직에서 투표 수를 체크하는 과정이 없어지지만 서비스 특성상 “회식 장소 추천”이 메인.
- 사용자 데이터 정보
    - K6 테스트는 결국 부하테스트인데, 사용자 정보를 더미 데이터라도 어느 정도는 책정해야 할지.
        - 선호 음식, 나이, 비선호 음식 등등..
        - 이 여부가 AI 추천 과정 처리 속도에 영향을 준다면 넣는 것도 좋아 보임
        - 조금 더 실 서비스에 가까운 부하테스트 가능
            - 아무 정도도 안 넣으면 실제 서비스보다 추천 서비스가 많이 빨리 나올 수 있음.
- 사용자, 그룹 수에 따라 게이트 기준을 다르게 해야할까?
    - 정확하게 진행하려면 맞는 접근 방식이긴 함
    - 근데 적정 max치를 넘지 않으면 괜찮다 → 라고 판단하면 애매한가?

---

## **7. 결론**

### 그룹원 투표를 부하테스트에서 설정해야 할지?

- 해야 한다고 결론
- 이유
    - /attendance-vote가 단순 API가 아니라 “집계/완료 트리거”가 걸리는 곳이라, 여기서 장애가 가장 잘 터짐(락/경합/레이스).

### VU를 전부 회식장으로 두면 사람을 많이 가정할 수 있지 않나?

- 가능. 하지만 이 방식은 추천 엔진 부하만 보는 테스트가 됨.
- 그래서 S2 - 추천 부하에서 그 가정을 사용해도 됨
- S1 - 투표 부하는 그룹원 모델로 가져가면 둘 다 잡힘.

### 더미 사용자 정보를 어느 정도 채울까?

- AI 팀원
    - 사용자, 그룹의 상세 데이터 여부가 “추천 처리 속도” 영향을 주지는 않는다.
    - 추천의 랜덤성이 커질뿐.
    - 회식원 수는 “추천 처리 속도”에 영향을 준다
- 따라서 데이터는 최소한의 데이터만
    - Nullable은 그냥 NULL로