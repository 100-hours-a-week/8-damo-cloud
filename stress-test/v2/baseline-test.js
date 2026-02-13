/**
 * V3 베이스라인 테스트 - 정확한 한계점 측정
 *
 * 목적: constant-vus로 특정 VU에서의 p95 응답시간 측정
 *
 * 실행:
 *   k6 run baseline-test.js --env VUS=10
 *   k6 run baseline-test.js --env VUS=20
 *   k6 run baseline-test.js --env VUS=30
 *
 * 환경변수:
 *   VUS: Virtual Users 수 (기본값: 10)
 *   DURATION: 테스트 시간 (기본값: 1m)
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'https://dev.damo.today/api/v1';
const VUS = parseInt(__ENV.VUS) || 10;
const DURATION = __ENV.DURATION || '1m';

// Custom metrics
const failRate = new Rate('fail_rate');
const groupCreateDuration = new Trend('group_create_duration', true);
const lightningCreateDuration = new Trend('lightning_create_duration', true);
const readDuration = new Trend('read_duration', true);

const groupsCreated = new Counter('groups_created');
const lightningsCreated = new Counter('lightnings_created');

export const options = {
  scenarios: {
    constant_load: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
    },
  },
  thresholds: {
    'fail_rate': ['rate<0.05'],
    'group_create_duration': ['p(95)<1000', 'p(99)<2000'],
    'lightning_create_duration': ['p(95)<1000', 'p(99)<2000'],
    'read_duration': ['p(95)<500', 'p(99)<1000'],
    'http_req_failed': ['rate<0.05'],
  },
};

export function setup() {
  console.log(`Baseline Test: VUS=${VUS}, DURATION=${DURATION}`);
  console.log(`BASE_URL: ${BASE_URL}`);

  const res = http.post(`${BASE_URL}/auth/test`, null, {
    headers: { 'Content-Type': 'application/json' },
  });

  let accessToken = null;
  if (res.status === 200 || res.status === 204) {
    const cookies = res.cookies;
    if (cookies?.access_token?.length > 0) {
      accessToken = cookies.access_token[0].value;
    } else {
      try {
        const body = JSON.parse(res.body);
        accessToken = body.data?.accessToken;
      } catch {}
    }
  }

  console.log(accessToken ? 'Token acquired' : 'Token acquisition failed');
  return { accessToken };
}

function getHeaders(accessToken) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  };
}

function randomGroupName() {
  const prefixes = ['맛집', '회식', '점심', '저녁', '팀', '동아리', '모임'];
  const suffixes = ['탐방대', '클럽', '스쿼드', '크루', '파티', '모임', '팀'];
  return prefixes[Math.floor(Math.random() * prefixes.length)] +
         suffixes[Math.floor(Math.random() * suffixes.length)];
}

function futureDate(daysOffset) {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day} 18:00`;
}

export default function (data) {
  const { accessToken } = data;
  if (!accessToken) {
    failRate.add(1);
    return;
  }

  // 실제 사용 패턴: 조회 60%, 그룹 생성 20%, 번개 생성 20%
  const action = Math.random();

  if (action < 0.60) {
    // 60%: 조회 작업
    group('Read Operations', () => {
      // 내 그룹 목록
      const start1 = Date.now();
      const res1 = http.get(`${BASE_URL}/users/me/groups`, {
        headers: getHeaders(accessToken),
        tags: { name: 'my-groups-list' },
      });
      readDuration.add(Date.now() - start1);
      check(res1, { 'my groups ok': (r) => r.status < 400 });
      failRate.add(res1.status >= 500);

      // 내 프로필
      const start2 = Date.now();
      const res2 = http.get(`${BASE_URL}/users/me/profile`, {
        headers: getHeaders(accessToken),
        tags: { name: 'my-profile' },
      });
      readDuration.add(Date.now() - start2);
      check(res2, { 'my profile ok': (r) => r.status < 400 });
      failRate.add(res2.status >= 500);

      // 번개 목록
      const start3 = Date.now();
      const res3 = http.get(`${BASE_URL}/users/me/lightning/available`, {
        headers: getHeaders(accessToken),
        tags: { name: 'available-lightning' },
      });
      readDuration.add(Date.now() - start3);
      check(res3, { 'lightning list ok': (r) => r.status < 400 });
      failRate.add(res3.status >= 500);
    });

  } else if (action < 0.80) {
    // 20%: 그룹 생성
    group('Group Create', () => {
      const payload = JSON.stringify({
        name: randomGroupName(),
        introduction: `베이스라인 테스트 ${__VU}-${__ITER}`,
        latitude: 37.5665 + (Math.random() * 0.1 - 0.05),
        longitude: 126.9780 + (Math.random() * 0.1 - 0.05),
        imagePath: 'test/baseline.jpg',
      });

      const start = Date.now();
      const res = http.post(`${BASE_URL}/groups`, payload, {
        headers: getHeaders(accessToken),
        tags: { name: 'group-create' },
      });
      groupCreateDuration.add(Date.now() - start);

      const success = check(res, {
        'group create 201': (r) => r.status === 201,
      });

      if (success) groupsCreated.add(1);
      failRate.add(res.status >= 500);
    });

  } else {
    // 20%: 번개 생성
    group('Lightning Create', () => {
      const payload = JSON.stringify({
        restaurantId: `baseline-${__VU}-${__ITER}-${Date.now()}`,
        maxParticipants: 2 + Math.floor(Math.random() * 7),
        description: `베이스라인 ${__VU}`,
        lightningDate: futureDate(1 + Math.floor(Math.random() * 7)),
      });

      const start = Date.now();
      const res = http.post(`${BASE_URL}/lightning`, payload, {
        headers: getHeaders(accessToken),
        tags: { name: 'lightning-create' },
      });
      lightningCreateDuration.add(Date.now() - start);

      const success = check(res, {
        'lightning create 201': (r) => r.status === 201,
      });

      if (success) lightningsCreated.add(1);
      failRate.add(res.status >= 500);
    });
  }

  sleep(0.5 + Math.random() * 0.5);
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data),
    [`./v3-baseline-vu${VUS}-summary.json`]: JSON.stringify(data, null, 2),
  };
}

function textSummary(data) {
  const { metrics } = data;

  let summary = '\n';
  summary += `╔══════════════════════════════════════════════════════════╗\n`;
  summary += `║  V3 베이스라인 테스트 결과 (VU=${VUS}, ${DURATION})      \n`;
  summary += `╚══════════════════════════════════════════════════════════╝\n\n`;

  summary += '┌─ [응답시간] ──────────────────────────────────────────────┐\n';
  if (metrics.group_create_duration) {
    const p95 = metrics.group_create_duration.values['p(95)']?.toFixed(0) || 'N/A';
    const ok = parseFloat(p95) < 1000 ? '✓' : '✗';
    summary += `│  그룹 생성 p95: ${p95}ms ${ok} (목표 <1000ms)\n`;
  }
  if (metrics.lightning_create_duration) {
    const p95 = metrics.lightning_create_duration.values['p(95)']?.toFixed(0) || 'N/A';
    const ok = parseFloat(p95) < 1000 ? '✓' : '✗';
    summary += `│  번개 생성 p95: ${p95}ms ${ok} (목표 <1000ms)\n`;
  }
  if (metrics.read_duration) {
    const p95 = metrics.read_duration.values['p(95)']?.toFixed(0) || 'N/A';
    const ok = parseFloat(p95) < 500 ? '✓' : '✗';
    summary += `│  조회 p95: ${p95}ms ${ok} (목표 <500ms)\n`;
  }
  summary += '└────────────────────────────────────────────────────────────┘\n\n';

  summary += '┌─ [처리량] ───────────────────────────────────────────────┐\n';
  if (metrics.http_reqs) {
    summary += `│  총 요청: ${metrics.http_reqs.values.count}\n`;
    summary += `│  RPS: ${metrics.http_reqs.values.rate?.toFixed(2)}\n`;
  }
  if (metrics.groups_created) {
    summary += `│  그룹 생성: ${metrics.groups_created.values.count}\n`;
  }
  if (metrics.lightnings_created) {
    summary += `│  번개 생성: ${metrics.lightnings_created.values.count}\n`;
  }
  summary += '└────────────────────────────────────────────────────────────┘\n\n';

  if (metrics.fail_rate) {
    summary += `실패율: ${(metrics.fail_rate.values.rate * 100).toFixed(2)}%\n`;
  }

  // 결론
  const allPassed =
    (metrics.group_create_duration?.values['p(95)'] || 0) < 1000 &&
    (metrics.lightning_create_duration?.values['p(95)'] || 0) < 1000 &&
    (metrics.read_duration?.values['p(95)'] || 0) < 500;

  summary += `\n결론: VU ${VUS}에서 ${allPassed ? 'SLO 충족 ✓' : 'SLO 미충족 ✗'}\n`;

  return summary;
}
