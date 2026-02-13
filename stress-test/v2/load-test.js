/**
 * V3 부하 테스트 - 생성/조회 중심
 *
 * 목적: 단일 사용자 토큰으로 VU를 늘려가며 생성/조회 API 부하 검증
 *
 * 특징:
 * - seed.sql, fixtures.json 불필요
 * - POST /api/v1/auth/test 로 토큰 획득
 * - 그룹 생성 → 회식 생성 → 번개 생성 플로우
 * - 조회 API 부하 테스트
 *
 * 실행:
 *   k6 run load-test.js
 *   k6 run load-test.js --env BASE_URL=http://localhost:8080/api/v1
 *
 * 시나리오:
 * - group_stress: 그룹 생성 부하
 * - dining_stress: 회식 생성 부하
 * - lightning_stress: 번개 생성 부하
 * - read_stress: 조회 부하
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// 환경 변수 또는 기본값
const BASE_URL = __ENV.BASE_URL || 'https://dev.damo.today/api/v1';

// Custom metrics
const failRate = new Rate('fail_rate');
const groupCreateDuration = new Trend('group_create_duration', true);
const diningCreateDuration = new Trend('dining_create_duration', true);
const lightningCreateDuration = new Trend('lightning_create_duration', true);
const readDuration = new Trend('read_duration', true);

const groupsCreated = new Counter('groups_created');
const diningsCreated = new Counter('dinings_created');
const lightningsCreated = new Counter('lightnings_created');

// 공유 데이터 (생성된 그룹 ID들)
const createdGroupIds = [];
const createdLightningIds = [];

export const options = {
  scenarios: {
    // 시나리오 1: 그룹 생성 스트레스
    group_stress: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 10 },  // 워밍업
        { duration: '1m', target: 30 },   // 부하 증가
        { duration: '1m', target: 50 },   // 최대 부하
        { duration: '30s', target: 10 },  // 쿨다운
        { duration: '30s', target: 0 },
      ],
      exec: 'groupStress',
    },
    // 시나리오 2: 조회 스트레스 (그룹 생성 후 시작)
    read_stress: {
      executor: 'ramping-vus',
      startVUs: 1,
      startTime: '1m',  // 그룹 생성 후 시작
      stages: [
        { duration: '30s', target: 20 },
        { duration: '1m', target: 50 },
        { duration: '1m', target: 100 },
        { duration: '30s', target: 0 },
      ],
      exec: 'readStress',
    },
    // 시나리오 3: 번개 생성 스트레스
    lightning_stress: {
      executor: 'ramping-vus',
      startVUs: 1,
      startTime: '30s',
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 30 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 0 },
      ],
      exec: 'lightningStress',
    },
  },
  thresholds: {
    'fail_rate': ['rate<0.05'],                                // 실패율 < 5%
    'group_create_duration': ['p(95)<1000', 'p(99)<2000'],     // 그룹 생성: p95 < 1s
    'lightning_create_duration': ['p(95)<1000', 'p(99)<2000'], // 번개 생성: p95 < 1s
    'read_duration': ['p(95)<500', 'p(99)<1000'],              // 조회: p95 < 500ms
    'http_req_failed': ['rate<0.05'],
  },
};

/**
 * Setup: 테스트용 토큰 발급
 */
export function setup() {
  console.log('Setting up: Issuing test access token...');
  console.log(`BASE_URL: ${BASE_URL}`);

  const res = http.post(
    `${BASE_URL}/auth/test`,
    null,
    {
      headers: {
        'Content-Type': 'application/json',
      },
      tags: { name: 'setup-token' },
    }
  );

  let accessToken = null;

  if (res.status === 200 || res.status === 204) {
    // 쿠키에서 access_token 추출
    const cookies = res.cookies;
    if (cookies && cookies.access_token && cookies.access_token.length > 0) {
      accessToken = cookies.access_token[0].value;
    } else {
      // 응답 본문에서 추출 시도
      try {
        const body = JSON.parse(res.body);
        accessToken = body.data?.accessToken || body.accessToken;
      } catch (e) {
        console.error('Failed to parse token from response body');
      }
    }
  } else {
    console.error(`Token request failed: ${res.status} - ${res.body}`);
  }

  if (accessToken) {
    console.log('Setup complete: Token acquired');
  } else {
    console.error('Setup failed: No token acquired');
  }

  return { accessToken };
}

/**
 * 헤더 생성 헬퍼
 */
function getHeaders(accessToken) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  };
}

/**
 * 랜덤 문자열 생성
 */
function randomString(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 랜덤 한글 그룹명 생성
 */
function randomGroupName() {
  const prefixes = ['맛집', '회식', '점심', '저녁', '팀', '동아리', '모임'];
  const suffixes = ['탐방대', '클럽', '스쿼드', '크루', '파티', '모임', '팀'];
  return prefixes[Math.floor(Math.random() * prefixes.length)] +
         suffixes[Math.floor(Math.random() * suffixes.length)];
}

/**
 * 미래 날짜 생성 (일 단위 오프셋)
 */
function futureDate(daysOffset) {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day} 18:00`;
}

// ========== 시나리오 함수들 ==========

/**
 * 그룹 생성 스트레스 테스트
 */
export function groupStress(data) {
  const { accessToken } = data;

  if (!accessToken) {
    failRate.add(1);
    return;
  }

  group('Group Create', () => {
    const payload = JSON.stringify({
      name: randomGroupName(),
      introduction: `테스트 그룹 ${__VU}-${__ITER}`,
      latitude: 37.5665 + (Math.random() * 0.1 - 0.05),
      longitude: 126.9780 + (Math.random() * 0.1 - 0.05),
      imagePath: 'test/group-image.jpg',
    });

    const startTime = Date.now();

    const res = http.post(`${BASE_URL}/groups`, payload, {
      headers: getHeaders(accessToken),
      tags: { name: 'group-create' },
    });

    const duration = Date.now() - startTime;
    groupCreateDuration.add(duration);

    const success = check(res, {
      'group create status 201': (r) => r.status === 201,
      'group create has data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.data !== undefined;
        } catch {
          return false;
        }
      },
    });

    if (success) {
      groupsCreated.add(1);
      try {
        const body = JSON.parse(res.body);
        if (body.data) {
          createdGroupIds.push(body.data);
        }
      } catch {}
    }

    failRate.add(res.status >= 500);

    if (res.status >= 500) {
      console.error(`Group create failed: ${res.status} - ${res.body}`);
    }
  });

  sleep(0.5 + Math.random() * 0.5);
}

/**
 * 조회 스트레스 테스트
 */
export function readStress(data) {
  const { accessToken } = data;

  if (!accessToken) {
    failRate.add(1);
    return;
  }

  group('Read Operations', () => {
    // 1. 내 그룹 목록 조회
    const startTime1 = Date.now();
    const res1 = http.get(`${BASE_URL}/users/me/groups`, {
      headers: getHeaders(accessToken),
      tags: { name: 'my-groups-list' },
    });
    readDuration.add(Date.now() - startTime1);

    check(res1, {
      'my groups list status 2xx': (r) => r.status >= 200 && r.status < 300,
    });
    failRate.add(res1.status >= 500);

    // 2. 내 프로필 조회
    const startTime2 = Date.now();
    const res2 = http.get(`${BASE_URL}/users/me/profile`, {
      headers: getHeaders(accessToken),
      tags: { name: 'my-profile' },
    });
    readDuration.add(Date.now() - startTime2);

    check(res2, {
      'my profile status 2xx': (r) => r.status >= 200 && r.status < 300,
    });
    failRate.add(res2.status >= 500);

    // 3. 사용 가능한 번개 목록 조회
    const startTime3 = Date.now();
    const res3 = http.get(`${BASE_URL}/users/me/lightning/available`, {
      headers: getHeaders(accessToken),
      tags: { name: 'available-lightning' },
    });
    readDuration.add(Date.now() - startTime3);

    check(res3, {
      'available lightning status 2xx': (r) => r.status >= 200 && r.status < 300,
    });
    failRate.add(res3.status >= 500);

    // 4. 내 번개 목록 조회
    const startTime4 = Date.now();
    const res4 = http.get(`${BASE_URL}/users/me/lightning`, {
      headers: getHeaders(accessToken),
      tags: { name: 'my-lightning' },
    });
    readDuration.add(Date.now() - startTime4);

    check(res4, {
      'my lightning status 2xx': (r) => r.status >= 200 && r.status < 300,
    });
    failRate.add(res4.status >= 500);
  });

  sleep(0.2 + Math.random() * 0.3);
}

/**
 * 번개 생성 스트레스 테스트
 */
export function lightningStress(data) {
  const { accessToken } = data;

  if (!accessToken) {
    failRate.add(1);
    return;
  }

  group('Lightning Create', () => {
    const payload = JSON.stringify({
      restaurantId: `test-restaurant-${__VU}-${__ITER}-${Date.now()}`,
      maxParticipants: 2 + Math.floor(Math.random() * 7), // 2~8
      description: `테스트 번개 ${__VU}`,
      lightningDate: futureDate(1 + Math.floor(Math.random() * 7)),
    });

    const startTime = Date.now();

    const res = http.post(`${BASE_URL}/lightning`, payload, {
      headers: getHeaders(accessToken),
      tags: { name: 'lightning-create' },
    });

    const duration = Date.now() - startTime;
    lightningCreateDuration.add(duration);

    const success = check(res, {
      'lightning create status 201': (r) => r.status === 201,
      'lightning create has data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.data !== undefined;
        } catch {
          return false;
        }
      },
    });

    if (success) {
      lightningsCreated.add(1);
      try {
        const body = JSON.parse(res.body);
        if (body.data) {
          createdLightningIds.push(body.data);
        }
      } catch {}
    }

    failRate.add(res.status >= 500);

    if (res.status >= 500) {
      console.error(`Lightning create failed: ${res.status} - ${res.body}`);
    }
  });

  sleep(0.5 + Math.random() * 0.5);
}

/**
 * 테스트 결과 요약
 */
export function handleSummary(data) {
  return {
    'stdout': textSummary(data),
    './v3-load-test-summary.json': JSON.stringify(data, null, 2),
  };
}

function textSummary(data) {
  const { metrics } = data;

  let summary = '\n';
  summary += '╔══════════════════════════════════════════════════════════╗\n';
  summary += '║       V3 부하 테스트 결과 - 생성/조회 중심               ║\n';
  summary += '╚══════════════════════════════════════════════════════════╝\n\n';

  // 그룹 생성
  if (metrics.group_create_duration) {
    summary += '┌─ [그룹 생성] ─────────────────────────────────────────────┐\n';
    summary += `│  p95: ${metrics.group_create_duration.values['p(95)']?.toFixed(0) || 'N/A'}ms (목표 <1000ms)\n`;
    summary += `│  p99: ${metrics.group_create_duration.values['p(99)']?.toFixed(0) || 'N/A'}ms (목표 <2000ms)\n`;
    summary += `│  avg: ${metrics.group_create_duration.values.avg?.toFixed(0) || 'N/A'}ms\n`;
    summary += `│  생성 수: ${metrics.groups_created?.values.count || 0}\n`;
    summary += '└───────────────────────────────────────────────────────────┘\n\n';
  }

  // 번개 생성
  if (metrics.lightning_create_duration) {
    summary += '┌─ [번개 생성] ─────────────────────────────────────────────┐\n';
    summary += `│  p95: ${metrics.lightning_create_duration.values['p(95)']?.toFixed(0) || 'N/A'}ms (목표 <1000ms)\n`;
    summary += `│  p99: ${metrics.lightning_create_duration.values['p(99)']?.toFixed(0) || 'N/A'}ms (목표 <2000ms)\n`;
    summary += `│  avg: ${metrics.lightning_create_duration.values.avg?.toFixed(0) || 'N/A'}ms\n`;
    summary += `│  생성 수: ${metrics.lightnings_created?.values.count || 0}\n`;
    summary += '└───────────────────────────────────────────────────────────┘\n\n';
  }

  // 조회
  if (metrics.read_duration) {
    summary += '┌─ [조회] ──────────────────────────────────────────────────┐\n';
    summary += `│  p95: ${metrics.read_duration.values['p(95)']?.toFixed(0) || 'N/A'}ms (목표 <500ms)\n`;
    summary += `│  p99: ${metrics.read_duration.values['p(99)']?.toFixed(0) || 'N/A'}ms (목표 <1000ms)\n`;
    summary += `│  avg: ${metrics.read_duration.values.avg?.toFixed(0) || 'N/A'}ms\n`;
    summary += '└───────────────────────────────────────────────────────────┘\n\n';
  }

  // 전체 요약
  summary += '┌─ [전체 요약] ─────────────────────────────────────────────┐\n';
  if (metrics.fail_rate) {
    summary += `│  실패율: ${(metrics.fail_rate.values.rate * 100).toFixed(2)}% (목표 <5%)\n`;
  }
  if (metrics.http_reqs) {
    summary += `│  총 요청 수: ${metrics.http_reqs.values.count}\n`;
    summary += `│  RPS: ${metrics.http_reqs.values.rate?.toFixed(2) || 'N/A'}\n`;
  }
  summary += '└───────────────────────────────────────────────────────────┘\n';

  return summary;
}
