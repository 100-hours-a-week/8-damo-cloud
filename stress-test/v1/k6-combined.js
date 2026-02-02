/**
 * 통합 부하 테스트 (S1 + S2)
 *
 * 실제 사용자 흐름 시뮬레이션:
 * 1. setup()에서 테스트용 Access Token 발급
 * 2. 그룹원들이 투표 (attendance-vote)
 * 3. 투표 완료 후 추천 결과 확인/재추천 (recommend-restaurant/refresh)
 *
 * 호스트: https://damo.today
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const BASE_URL = 'https://damo.today/api/v1';

// Custom metrics
const failRate = new Rate('fail_rate');
const voteDuration = new Trend('vote_duration', true);
const recommendDuration = new Trend('recommend_duration', true);
const totalRequests = new Counter('total_requests');

// Load test fixtures
const users = new SharedArray('users', function () {
  return JSON.parse(open('./fixtures.json')).users;
});

export const options = {
  scenarios: {
    // S1: 투표 동시성 테스트
    vote_scenario: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 30,
      maxVUs: 100,
      stages: [
        { duration: '1m', target: 10 },   // 워밍업
        { duration: '2m', target: 30 },   // 본구간
        { duration: '1m', target: 50 },   // 스트레스
        { duration: '30s', target: 0 },   // 쿨다운
      ],
      exec: 'voteScenario',
    },
    // S2: 재추천 부하 테스트
    recommend_scenario: {
      executor: 'constant-vus',
      vus: 10,
      duration: '4m30s',
      startTime: '30s', // 투표 시나리오 워밍업 후 시작
      exec: 'recommendScenario',
    },
  },
  thresholds: {
    // 공통
    'fail_rate': ['rate<0.01'],                         // 실패율 < 1%
    'http_req_failed': ['rate<0.01'],

    // 투표 API
    'vote_duration': ['p(95)<400', 'p(99)<800'],        // p95 < 400ms, p99 < 800ms

    // 재추천 API
    'recommend_duration': ['p(95)<3000', 'p(99)<6000'], // p95 < 3s, p99 < 6s
  },
};

/**
 * Setup: 테스트 시작 전 각 사용자별 Access Token 발급
 */
export function setup() {
  console.log('Setting up: Issuing access tokens for all users...');

  const tokenMap = {};

  for (const user of users) {
    const res = http.post(
      `${BASE_URL}/auth/test/${user.userId}`,
      null,
      {
        headers: {
          'Content-Type': 'application/json',
        },
        tags: { name: 'setup-token' },
      }
    );

    if (res.status === 200 || res.status === 204) {
      // 쿠키에서 access_token 추출
      const cookies = res.cookies;
      if (cookies && cookies.access_token && cookies.access_token.length > 0) {
        tokenMap[user.userId] = cookies.access_token[0].value;
        console.log(`Token issued for user ${user.userId}`);
      } else {
        // 응답 본문에서 추출 시도
        try {
          const body = JSON.parse(res.body);
          tokenMap[user.userId] = body.data?.accessToken || body.accessToken;
          console.log(`Token issued for user ${user.userId} (from body)`);
        } catch (e) {
          console.error(`Failed to get token for user ${user.userId}: no token in cookies or body`);
        }
      }
    } else {
      console.error(`Failed to issue token for user ${user.userId}: ${res.status}`);
    }
  }

  console.log(`Setup complete: ${Object.keys(tokenMap).length} tokens issued`);
  return { tokenMap };
}

/**
 * S1: 투표 시나리오 (ATTENDANCE_VOTING 상태인 그룹 100 사용)
 */
export function voteScenario(data) {
  // groupId 100 (diningId 500) 사용자만 사용 - ATTENDANCE_VOTING 상태
  const voteUsers = users.filter(u => u.groupId === 100);
  const user = voteUsers[Math.floor(Math.random() * voteUsers.length)];
  const accessToken = data.tokenMap[user.userId];

  if (!accessToken) {
    console.error(`No token for user ${user.userId}`);
    failRate.add(1);
    return;
  }

  group('vote_flow', function () {
    const url = `${BASE_URL}/groups/${user.groupId}/dining/${user.diningId}/attendance-vote`;

    // 90% 참석, 10% 불참
    const payload = JSON.stringify({
      attendanceVoteStatus: Math.random() > 0.1 ? 'ATTEND' : 'NON_ATTEND',
    });

    const startTime = Date.now();

    const res = http.patch(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      tags: { name: 'attendance-vote' },
    });

    const duration = Date.now() - startTime;
    voteDuration.add(duration);
    totalRequests.add(1);

    check(res, {
      'vote: status 2xx': (r) => r.status >= 200 && r.status < 300,
      'vote: not 5xx': (r) => r.status < 500,
      'vote: p95 < 400ms': () => duration < 400,
    });

    failRate.add(res.status >= 500);
  });

  sleep(0.1);
}

/**
 * S2: 재추천 시나리오 (RESTAURANT_VOTING 상태인 그룹 101 사용)
 */
export function recommendScenario(data) {
  // groupId 101 (diningId 501)의 LEADER만 사용 - RESTAURANT_VOTING 상태
  const leaderUsers = users.filter(u => u.groupId === 101 && u.role === 'LEADER');
  const user = leaderUsers[Math.floor(Math.random() * leaderUsers.length)];
  const accessToken = data.tokenMap[user.userId];

  if (!accessToken) {
    console.error(`No token for user ${user.userId}`);
    failRate.add(1);
    return;
  }

  group('recommend_flow', function () {
    const url = `${BASE_URL}/groups/${user.groupId}/dining/${user.diningId}/recommend-restaurant/refresh`;

    const startTime = Date.now();

    const res = http.post(url, null, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      tags: { name: 'recommend-refresh' },
      timeout: '30s',
    });

    const duration = Date.now() - startTime;
    recommendDuration.add(duration);
    totalRequests.add(1);

    check(res, {
      'refresh: status 2xx': (r) => r.status >= 200 && r.status < 300,
      'refresh: not 5xx': (r) => r.status < 500,
      'refresh: p95 < 3s': () => duration < 3000,
    });

    failRate.add(res.status >= 500 || duration >= 30000);

    // 결과 확인 대기
    sleep(1 + Math.random() * 2);

    // 30% 확률로 재추천
    if (Math.random() < 0.3) {
      const retryStart = Date.now();
      const retryRes = http.post(url, null, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        tags: { name: 'recommend-refresh-retry' },
        timeout: '30s',
      });

      recommendDuration.add(Date.now() - retryStart);
      totalRequests.add(1);
      failRate.add(retryRes.status >= 500);
    }
  });

  sleep(2 + Math.random() * 3);
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data),
    './k6-combined-summary.json': JSON.stringify(data, null, 2),
  };
}

function textSummary(data) {
  const { metrics } = data;

  let summary = '\n';
  summary += '╔══════════════════════════════════════════════════════════════╗\n';
  summary += '║           V1 부하 테스트 결과 (S1 + S2 통합)                  ║\n';
  summary += '╠══════════════════════════════════════════════════════════════╣\n';

  // 투표 결과
  summary += '║ [S1] 투표 동시성 테스트                                      ║\n';
  if (metrics.vote_duration) {
    const p95 = metrics.vote_duration.values['p(95)']?.toFixed(0) || 'N/A';
    const p99 = metrics.vote_duration.values['p(99)']?.toFixed(0) || 'N/A';
    const avg = metrics.vote_duration.values.avg?.toFixed(0) || 'N/A';
    const p95Pass = parseFloat(p95) < 400 ? '✓' : '✗';
    const p99Pass = parseFloat(p99) < 800 ? '✓' : '✗';
    summary += `║   p95: ${p95}ms (목표 <400ms) ${p95Pass}                           ║\n`;
    summary += `║   p99: ${p99}ms (목표 <800ms) ${p99Pass}                           ║\n`;
    summary += `║   avg: ${avg}ms                                             ║\n`;
  }

  summary += '╠══════════════════════════════════════════════════════════════╣\n';

  // 재추천 결과
  summary += '║ [S2] 재추천 부하 테스트                                      ║\n';
  if (metrics.recommend_duration) {
    const p95 = (metrics.recommend_duration.values['p(95)'] / 1000)?.toFixed(2) || 'N/A';
    const p99 = (metrics.recommend_duration.values['p(99)'] / 1000)?.toFixed(2) || 'N/A';
    const avg = (metrics.recommend_duration.values.avg / 1000)?.toFixed(2) || 'N/A';
    const p95Pass = parseFloat(p95) < 3 ? '✓' : '✗';
    const p99Pass = parseFloat(p99) < 6 ? '✓' : '✗';
    summary += `║   p95: ${p95}s (목표 <3s) ${p95Pass}                              ║\n`;
    summary += `║   p99: ${p99}s (목표 <6s) ${p99Pass}                              ║\n`;
    summary += `║   avg: ${avg}s                                              ║\n`;
  }

  summary += '╠══════════════════════════════════════════════════════════════╣\n';

  // 공통 메트릭
  summary += '║ [공통] 전체 요청                                             ║\n';
  if (metrics.fail_rate) {
    const rate = (metrics.fail_rate.values.rate * 100).toFixed(2);
    const pass = parseFloat(rate) < 1 ? '✓' : '✗';
    summary += `║   실패율: ${rate}% (목표 <1%) ${pass}                            ║\n`;
  }
  if (metrics.total_requests) {
    summary += `║   총 요청: ${metrics.total_requests.values.count}                                        ║\n`;
  }

  summary += '╚══════════════════════════════════════════════════════════════╝\n';

  return summary;
}
