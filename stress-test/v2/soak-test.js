/**
 * V3 소크 테스트 - 장시간 안정성 검증
 *
 * 목적: 장시간 일정 부하에서 메모리 누수, 연결 풀 고갈 등 확인
 *
 * 실행:
 *   k6 run soak-test.js
 *   k6 run soak-test.js --env BASE_URL=http://localhost:8080/api/v1 --env DURATION=30m
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'https://dev.damo.today/api/v1';
const DURATION = __ENV.DURATION || '10m';  // 기본 10분

const failRate = new Rate('fail_rate');
const responseDuration = new Trend('response_duration', true);

export const options = {
  scenarios: {
    soak: {
      executor: 'constant-vus',
      vus: 20,
      duration: DURATION,
    },
  },
  thresholds: {
    'fail_rate': ['rate<0.02'],              // 장시간 2% 이하 유지
    'response_duration': ['p(95)<1000'],     // p95 < 1s
    'http_req_failed': ['rate<0.02'],
  },
};

export function setup() {
  console.log(`Soak Test: Duration=${DURATION}, VUs=20`);
  console.log('Issuing test token...');

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

function futureDate(daysOffset) {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  return date.toISOString().slice(0, 10) + ' 18:00';
}

export default function (data) {
  const { accessToken } = data;
  if (!accessToken) {
    failRate.add(1);
    return;
  }

  // 실제 사용 패턴 시뮬레이션 (읽기 70%, 쓰기 30%)
  const action = Math.random();

  if (action < 0.35) {
    // 35%: 그룹 목록 조회
    const start = Date.now();
    const res = http.get(`${BASE_URL}/users/me/groups`, {
      headers: getHeaders(accessToken),
      tags: { name: 'soak-groups' },
    });
    responseDuration.add(Date.now() - start);
    check(res, { 'groups ok': (r) => r.status < 400 });
    failRate.add(res.status >= 500);

  } else if (action < 0.55) {
    // 20%: 프로필 조회
    const start = Date.now();
    const res = http.get(`${BASE_URL}/users/me/profile`, {
      headers: getHeaders(accessToken),
      tags: { name: 'soak-profile' },
    });
    responseDuration.add(Date.now() - start);
    check(res, { 'profile ok': (r) => r.status < 400 });
    failRate.add(res.status >= 500);

  } else if (action < 0.70) {
    // 15%: 번개 목록 조회
    const start = Date.now();
    const res = http.get(`${BASE_URL}/users/me/lightning/available`, {
      headers: getHeaders(accessToken),
      tags: { name: 'soak-lightning-list' },
    });
    responseDuration.add(Date.now() - start);
    check(res, { 'lightning list ok': (r) => r.status < 400 });
    failRate.add(res.status >= 500);

  } else if (action < 0.85) {
    // 15%: 그룹 생성
    const payload = JSON.stringify({
      name: `소크${__VU % 100}`,
      introduction: 'Soak test',
      latitude: 37.5665,
      longitude: 126.9780,
      imagePath: 'test/soak.jpg',
    });
    const start = Date.now();
    const res = http.post(`${BASE_URL}/groups`, payload, {
      headers: getHeaders(accessToken),
      tags: { name: 'soak-group-create' },
    });
    responseDuration.add(Date.now() - start);
    check(res, { 'group create ok': (r) => r.status === 201 });
    failRate.add(res.status >= 500);

  } else {
    // 15%: 번개 생성
    const payload = JSON.stringify({
      restaurantId: `soak-${__VU}-${__ITER}-${Date.now()}`,
      maxParticipants: 4,
      description: 'Soak test',
      lightningDate: futureDate(1),
    });
    const start = Date.now();
    const res = http.post(`${BASE_URL}/lightning`, payload, {
      headers: getHeaders(accessToken),
      tags: { name: 'soak-lightning-create' },
    });
    responseDuration.add(Date.now() - start);
    check(res, { 'lightning create ok': (r) => r.status === 201 });
    failRate.add(res.status >= 500);
  }

  sleep(1 + Math.random());
}

export function handleSummary(data) {
  const { metrics } = data;

  let summary = '\n========== V3 소크 테스트 결과 ==========\n\n';

  if (metrics.response_duration) {
    summary += `응답시간:\n`;
    summary += `  avg: ${metrics.response_duration.values.avg?.toFixed(0)}ms\n`;
    summary += `  p95: ${metrics.response_duration.values['p(95)']?.toFixed(0)}ms (목표 <1000ms)\n`;
    summary += `  p99: ${metrics.response_duration.values['p(99)']?.toFixed(0)}ms\n`;
    summary += `  max: ${metrics.response_duration.values.max?.toFixed(0)}ms\n\n`;
  }

  if (metrics.fail_rate) {
    summary += `실패율: ${(metrics.fail_rate.values.rate * 100).toFixed(3)}% (목표 <2%)\n`;
  }

  if (metrics.http_reqs) {
    summary += `총 요청: ${metrics.http_reqs.values.count}\n`;
    summary += `평균 RPS: ${metrics.http_reqs.values.rate?.toFixed(2)}\n`;
  }

  summary += '\n=========================================\n';

  return {
    'stdout': summary,
    './v3-soak-test-summary.json': JSON.stringify(data, null, 2),
  };
}
