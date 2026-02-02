/**
 * S2. 재추천 부하 테스트
 *
 * 목적: AI 추천 처리시간(p95/p99)과 실패율/타임아웃 검증
 *
 * 부하 형태: constant-vus
 * - 투표 완료 후 30% 확률로 refresh 1회
 * - 10% 확률로 2회 추가 refresh
 *
 * SLO:
 * - p95 < 3s (3000ms)
 * - p99 < 6s (6000ms)
 * - fail_rate < 1%
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const BASE_URL = 'https://damo.today/api/v1';

// Custom metrics
const failRate = new Rate('fail_rate');
const recommendDuration = new Trend('recommend_duration', true);
const refreshCount = new Rate('refresh_triggered');

// Load test fixtures
const users = new SharedArray('users', function () {
  return JSON.parse(open('./fixtures.json')).users;
});

export const options = {
  scenarios: {
    recommend_load: {
      executor: 'constant-vus',
      vus: 20,
      duration: '5m',
    },
  },
  thresholds: {
    'fail_rate': ['rate<0.01'],                        // 실패율 < 1%
    'recommend_duration': ['p(95)<3000', 'p(99)<6000'], // p95 < 3s, p99 < 6s
    'http_req_failed': ['rate<0.01'],
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
 * 재추천 API 호출
 */
function refreshRecommendation(user, accessToken) {
  const url = `${BASE_URL}/groups/${user.groupId}/dining/${user.diningId}/recommend-restaurant/refresh`;

  const startTime = Date.now();

  const res = http.post(url, null, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    tags: { name: 'recommend-refresh' },
    timeout: '30s', // AI 추천은 오래 걸릴 수 있음
  });

  const duration = Date.now() - startTime;
  recommendDuration.add(duration);

  const success = check(res, {
    'refresh status is 2xx': (r) => r.status >= 200 && r.status < 300,
    'refresh status is not 5xx': (r) => r.status < 500,
    'response time < 6s': (r) => duration < 6000,
  });

  // 5xx 에러 또는 타임아웃을 실패로 카운트
  failRate.add(res.status >= 500 || duration >= 30000);

  if (res.status >= 500) {
    console.error(`Refresh failed: ${res.status} - ${res.body}`);
  }

  return success;
}

export default function (data) {
  // groupId 101 (diningId 501)의 LEADER만 사용 - RESTAURANT_VOTING 상태
  const leaderUsers = users.filter(u => u.groupId === 101 && u.role === 'LEADER');
  const user = leaderUsers[Math.floor(Math.random() * leaderUsers.length)];
  const accessToken = data.tokenMap[user.userId];

  if (!accessToken) {
    console.error(`No token for user ${user.userId}`);
    failRate.add(1);
    return;
  }

  // 첫 번째 추천 요청 (투표 완료 후 자동 추천 시뮬레이션)
  refreshRecommendation(user, accessToken);
  refreshCount.add(1);

  // 결과 확인 대기
  sleep(1 + Math.random() * 2);

  // 30% 확률로 재추천 1회
  if (Math.random() < 0.3) {
    refreshRecommendation(user, accessToken);
    refreshCount.add(1);
    sleep(1 + Math.random() * 2);

    // 추가로 10% 확률로 재추천 2회 더
    if (Math.random() < 0.1) {
      for (let i = 0; i < 2; i++) {
        refreshRecommendation(user, accessToken);
        refreshCount.add(1);
        sleep(1 + Math.random() * 2);
      }
    }
  }

  // 다음 iteration 전 대기
  sleep(2 + Math.random() * 3);
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    './k6-s2-recommend-summary.json': JSON.stringify(data, null, 2),
  };
}

function textSummary(data, options) {
  const { metrics } = data;

  let summary = '\n========== S2. 재추천 부하 테스트 결과 ==========\n\n';

  if (metrics.recommend_duration) {
    summary += `재추천 응답시간:\n`;
    summary += `  - p95: ${(metrics.recommend_duration.values['p(95)'] / 1000)?.toFixed(2) || 'N/A'}s\n`;
    summary += `  - p99: ${(metrics.recommend_duration.values['p(99)'] / 1000)?.toFixed(2) || 'N/A'}s\n`;
    summary += `  - avg: ${(metrics.recommend_duration.values.avg / 1000)?.toFixed(2) || 'N/A'}s\n\n`;
  }

  if (metrics.fail_rate) {
    summary += `실패율: ${(metrics.fail_rate.values.rate * 100).toFixed(2)}%\n`;
  }

  if (metrics.http_reqs) {
    summary += `총 요청 수: ${metrics.http_reqs.values.count}\n`;
  }

  if (metrics.refresh_triggered) {
    summary += `재추천 트리거 비율: ${(metrics.refresh_triggered.values.rate * 100).toFixed(2)}%\n`;
  }

  summary += '\n================================================\n';

  return summary;
}
