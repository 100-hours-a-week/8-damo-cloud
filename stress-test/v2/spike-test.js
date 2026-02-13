/**
 * V3 스파이크 테스트 - 급격한 부하 증가 대응 검증
 *
 * 목적: 갑작스러운 트래픽 급증 시 서버 안정성 검증
 *
 * 실행:
 *   k6 run spike-test.js
 *   k6 run spike-test.js --env BASE_URL=http://localhost:8080/api/v1
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'https://dev.damo.today/api/v1';

const failRate = new Rate('fail_rate');
const responseDuration = new Trend('response_duration', true);

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 5 },    // 평소 트래픽
        { duration: '10s', target: 100 },  // 급격한 스파이크!
        { duration: '30s', target: 100 },  // 스파이크 유지
        { duration: '10s', target: 5 },    // 정상화
        { duration: '30s', target: 5 },    // 안정화 확인
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    'fail_rate': ['rate<0.10'],            // 스파이크 시 10% 이하 실패 허용
    'response_duration': ['p(95)<3000'],   // p95 < 3s
    'http_req_failed': ['rate<0.10'],
  },
};

export function setup() {
  console.log('Spike Test Setup: Issuing test token...');

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

export default function (data) {
  const { accessToken } = data;
  if (!accessToken) {
    failRate.add(1);
    return;
  }

  // 실제 사용자 시나리오 혼합
  const scenario = Math.random();

  if (scenario < 0.4) {
    // 40%: 그룹 목록 조회
    group('Spike - My Groups', () => {
      const start = Date.now();
      const res = http.get(`${BASE_URL}/users/me/groups`, {
        headers: getHeaders(accessToken),
        tags: { name: 'spike-my-groups' },
      });
      responseDuration.add(Date.now() - start);
      check(res, { 'status 2xx': (r) => r.status >= 200 && r.status < 300 });
      failRate.add(res.status >= 500);
    });
  } else if (scenario < 0.7) {
    // 30%: 번개 목록 조회
    group('Spike - Available Lightning', () => {
      const start = Date.now();
      const res = http.get(`${BASE_URL}/users/me/lightning/available`, {
        headers: getHeaders(accessToken),
        tags: { name: 'spike-available-lightning' },
      });
      responseDuration.add(Date.now() - start);
      check(res, { 'status 2xx': (r) => r.status >= 200 && r.status < 300 });
      failRate.add(res.status >= 500);
    });
  } else if (scenario < 0.9) {
    // 20%: 그룹 생성
    group('Spike - Group Create', () => {
      const payload = JSON.stringify({
        name: `스파이크${__VU}`,
        introduction: 'Spike test',
        latitude: 37.5665,
        longitude: 126.9780,
        imagePath: 'test/spike.jpg',
      });
      const start = Date.now();
      const res = http.post(`${BASE_URL}/groups`, payload, {
        headers: getHeaders(accessToken),
        tags: { name: 'spike-group-create' },
      });
      responseDuration.add(Date.now() - start);
      check(res, { 'status 201': (r) => r.status === 201 });
      failRate.add(res.status >= 500);
    });
  } else {
    // 10%: 번개 생성
    group('Spike - Lightning Create', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);
      const dateStr = futureDate.toISOString().slice(0, 10) + ' 18:00';

      const payload = JSON.stringify({
        restaurantId: `spike-${__VU}-${Date.now()}`,
        maxParticipants: 4,
        description: 'Spike test',
        lightningDate: dateStr,
      });
      const start = Date.now();
      const res = http.post(`${BASE_URL}/lightning`, payload, {
        headers: getHeaders(accessToken),
        tags: { name: 'spike-lightning-create' },
      });
      responseDuration.add(Date.now() - start);
      check(res, { 'status 201': (r) => r.status === 201 });
      failRate.add(res.status >= 500);
    });
  }

  sleep(0.1 + Math.random() * 0.2);
}

export function handleSummary(data) {
  const { metrics } = data;
  let summary = '\n========== V3 스파이크 테스트 결과 ==========\n\n';

  if (metrics.response_duration) {
    summary += `응답시간:\n`;
    summary += `  p50: ${metrics.response_duration.values['p(50)']?.toFixed(0)}ms\n`;
    summary += `  p95: ${metrics.response_duration.values['p(95)']?.toFixed(0)}ms (목표 <3000ms)\n`;
    summary += `  p99: ${metrics.response_duration.values['p(99)']?.toFixed(0)}ms\n`;
    summary += `  max: ${metrics.response_duration.values.max?.toFixed(0)}ms\n\n`;
  }

  if (metrics.fail_rate) {
    summary += `실패율: ${(metrics.fail_rate.values.rate * 100).toFixed(2)}% (목표 <10%)\n`;
  }

  if (metrics.http_reqs) {
    summary += `총 요청: ${metrics.http_reqs.values.count}\n`;
    summary += `RPS: ${metrics.http_reqs.values.rate?.toFixed(2)}\n`;
  }

  summary += '\n=============================================\n';
  return {
    'stdout': summary,
    './v3-spike-test-summary.json': JSON.stringify(data, null, 2),
  };
}
