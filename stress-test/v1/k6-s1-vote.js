/**
 * S1. 투표 동시성 테스트
 *
 * 목적: vote 집계/완료 트리거/락 경합/중복투표 방지 등 검증
 *
 * 부하 형태: ramping-arrival-rate
 * - 워밍업 1분: 10 rps
 * - 본구간 3분: 50 rps
 * - 스트레스 1분: 100 rps
 *
 * SLO:
 * - p95 < 400ms
 * - p99 < 800ms
 * - fail_rate < 1%
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const BASE_URL = 'https://damo.today';

// Custom metrics
const failRate = new Rate('fail_rate');
const voteDuration = new Trend('vote_duration', true);

// Load test fixtures
const users = new SharedArray('users', function () {
  return JSON.parse(open('./fixtures.json')).users;
});

export const options = {
  scenarios: {
    vote_load: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 200,
      stages: [
        { duration: '1m', target: 10 },   // 워밍업: 10 rps
        { duration: '3m', target: 50 },   // 본구간: 50 rps
        { duration: '1m', target: 100 },  // 스트레스: 100 rps
        { duration: '30s', target: 0 },   // 쿨다운
      ],
    },
  },
  thresholds: {
    'fail_rate': ['rate<0.01'],                    // 실패율 < 1%
    'vote_duration': ['p(95)<400', 'p(99)<800'],   // p95 < 400ms, p99 < 800ms
    'http_req_failed': ['rate<0.01'],
  },
};

// 사용자별 Access Token 캐시
const accessTokens = {};

/**
 * Refresh Token으로 Access Token 발급
 */
function getAccessToken(user) {
  if (accessTokens[user.userId]) {
    return accessTokens[user.userId];
  }

  const res = http.post(
    `${BASE_URL}/auth/reissue`,
    null,
    {
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `refreshToken=${user.refreshToken}`,
      },
      tags: { name: 'reissue' },
    }
  );

  if (res.status === 200) {
    try {
      const body = JSON.parse(res.body);
      accessTokens[user.userId] = body.data?.accessToken || body.accessToken;
      return accessTokens[user.userId];
    } catch (e) {
      console.error(`Failed to parse reissue response: ${e}`);
    }
  }

  console.error(`Reissue failed for user ${user.userId}: ${res.status}`);
  return null;
}

/**
 * 투표 API 호출
 */
function vote(user, accessToken) {
  const url = `${BASE_URL}/groups/${user.groupId}/dining/${user.diningId}/attendance-vote`;

  const payload = JSON.stringify({
    isAttending: true,
    preferredFood: ['한식', '중식', '일식'][Math.floor(Math.random() * 3)],
  });

  const startTime = Date.now();

  const res = http.post(url, payload, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    tags: { name: 'attendance-vote' },
  });

  const duration = Date.now() - startTime;
  voteDuration.add(duration);

  const success = check(res, {
    'vote status is 2xx': (r) => r.status >= 200 && r.status < 300,
    'vote status is not 5xx': (r) => r.status < 500,
  });

  // 5xx 에러만 실패로 카운트 (409 중복투표 등은 정상 동작)
  failRate.add(res.status >= 500);

  if (res.status >= 500) {
    console.error(`Vote failed: ${res.status} - ${res.body}`);
  }

  return success;
}

export default function () {
  // 랜덤 사용자 선택
  const user = users[Math.floor(Math.random() * users.length)];

  // Access Token 획득
  const accessToken = getAccessToken(user);
  if (!accessToken) {
    failRate.add(1);
    return;
  }

  // 투표 실행
  vote(user, accessToken);

  // 요청 간 짧은 대기
  sleep(0.1);
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    './k6-s1-vote-summary.json': JSON.stringify(data, null, 2),
  };
}

function textSummary(data, options) {
  const { metrics } = data;

  let summary = '\n========== S1. 투표 동시성 테스트 결과 ==========\n\n';

  if (metrics.vote_duration) {
    summary += `투표 응답시간:\n`;
    summary += `  - p95: ${metrics.vote_duration.values['p(95)']?.toFixed(2) || 'N/A'}ms\n`;
    summary += `  - p99: ${metrics.vote_duration.values['p(99)']?.toFixed(2) || 'N/A'}ms\n`;
    summary += `  - avg: ${metrics.vote_duration.values.avg?.toFixed(2) || 'N/A'}ms\n\n`;
  }

  if (metrics.fail_rate) {
    summary += `실패율: ${(metrics.fail_rate.values.rate * 100).toFixed(2)}%\n`;
  }

  if (metrics.http_reqs) {
    summary += `총 요청 수: ${metrics.http_reqs.values.count}\n`;
  }

  summary += '\n================================================\n';

  return summary;
}
