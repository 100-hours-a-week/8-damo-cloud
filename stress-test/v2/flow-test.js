/**
 * V3 플로우 테스트 - 그룹 생성 → 회식 생성 → 조회 전체 플로우
 *
 * 목적: 실제 사용자 플로우를 시뮬레이션하며 부하 검증
 *
 * 플로우:
 * 1. 그룹 생성
 * 2. 생성된 그룹에 회식 생성
 * 3. 회식 목록 조회
 * 4. 번개 생성
 * 5. 번개 상세 조회
 *
 * 실행:
 *   k6 run flow-test.js
 *   k6 run flow-test.js --env BASE_URL=http://localhost:8080/api/v1
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'https://dev.damo.today/api/v1';

// Metrics
const failRate = new Rate('fail_rate');
const flowDuration = new Trend('flow_duration', true);
const groupCreateDuration = new Trend('group_create_duration', true);
const diningCreateDuration = new Trend('dining_create_duration', true);
const diningListDuration = new Trend('dining_list_duration', true);
const lightningCreateDuration = new Trend('lightning_create_duration', true);
const lightningDetailDuration = new Trend('lightning_detail_duration', true);

const successfulFlows = new Counter('successful_flows');
const failedFlows = new Counter('failed_flows');

export const options = {
  scenarios: {
    user_flow: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 5 },   // 워밍업
        { duration: '1m', target: 15 },   // 부하 증가
        { duration: '2m', target: 25 },   // 유지
        { duration: '30s', target: 5 },   // 쿨다운
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    'fail_rate': ['rate<0.05'],
    'flow_duration': ['p(95)<5000'],              // 전체 플로우: p95 < 5s
    'group_create_duration': ['p(95)<1000'],
    'dining_create_duration': ['p(95)<1000'],
    'dining_list_duration': ['p(95)<500'],
    'lightning_create_duration': ['p(95)<1000'],
    'lightning_detail_duration': ['p(95)<500'],
  },
};

export function setup() {
  console.log('Flow Test Setup: Issuing test token...');

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
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day} 18:00`;
}

export default function (data) {
  const { accessToken } = data;
  if (!accessToken) {
    failRate.add(1);
    failedFlows.add(1);
    return;
  }

  const flowStart = Date.now();
  let flowSuccess = true;
  let groupId = null;
  let diningId = null;
  let lightningId = null;

  // Step 1: 그룹 생성
  group('Step 1: Group Create', () => {
    const payload = JSON.stringify({
      name: `플로우${__VU}`,
      introduction: `Flow test ${__VU}-${__ITER}`,
      latitude: 37.5665 + (Math.random() * 0.02 - 0.01),
      longitude: 126.9780 + (Math.random() * 0.02 - 0.01),
      imagePath: 'test/flow-group.jpg',
    });

    const start = Date.now();
    const res = http.post(`${BASE_URL}/groups`, payload, {
      headers: getHeaders(accessToken),
      tags: { name: 'flow-group-create' },
    });
    groupCreateDuration.add(Date.now() - start);

    const success = check(res, {
      'group created': (r) => r.status === 201,
    });

    if (success) {
      try {
        const body = JSON.parse(res.body);
        groupId = body.data;
      } catch {}
    } else {
      flowSuccess = false;
      failRate.add(1);
      if (res.status >= 500) {
        console.error(`Group create failed: ${res.status}`);
      }
    }
  });

  sleep(0.3);

  // Step 2: 회식 생성 (그룹이 있으면)
  if (groupId) {
    group('Step 2: Dining Create', () => {
      const diningDate = futureDate(7);
      const voteDueDate = futureDate(5);

      const payload = JSON.stringify({
        diningDate: diningDate,
        voteDueDate: voteDueDate,
        budget: 30000 + Math.floor(Math.random() * 20000),
      });

      const start = Date.now();
      const res = http.post(`${BASE_URL}/groups/${groupId}/dining`, payload, {
        headers: getHeaders(accessToken),
        tags: { name: 'flow-dining-create' },
      });
      diningCreateDuration.add(Date.now() - start);

      const success = check(res, {
        'dining created': (r) => r.status === 201,
      });

      if (success) {
        try {
          const body = JSON.parse(res.body);
          diningId = body.data;
        } catch {}
      } else {
        flowSuccess = false;
        failRate.add(1);
        if (res.status >= 500) {
          console.error(`Dining create failed: ${res.status}`);
        }
      }
    });

    sleep(0.3);

    // Step 3: 회식 목록 조회
    group('Step 3: Dining List', () => {
      const start = Date.now();
      const res = http.get(
        `${BASE_URL}/groups/${groupId}/dining?status=ATTENDANCE_VOTING`,
        {
          headers: getHeaders(accessToken),
          tags: { name: 'flow-dining-list' },
        }
      );
      diningListDuration.add(Date.now() - start);

      const success = check(res, {
        'dining list ok': (r) => r.status >= 200 && r.status < 300,
      });

      if (!success) {
        flowSuccess = false;
        failRate.add(res.status >= 500);
      }
    });
  }

  sleep(0.3);

  // Step 4: 번개 생성
  group('Step 4: Lightning Create', () => {
    const payload = JSON.stringify({
      restaurantId: `flow-restaurant-${__VU}-${__ITER}-${Date.now()}`,
      maxParticipants: 4,
      description: `Flow test lightning ${__VU}`,
      lightningDate: futureDate(2),
    });

    const start = Date.now();
    const res = http.post(`${BASE_URL}/lightning`, payload, {
      headers: getHeaders(accessToken),
      tags: { name: 'flow-lightning-create' },
    });
    lightningCreateDuration.add(Date.now() - start);

    const success = check(res, {
      'lightning created': (r) => r.status === 201,
    });

    if (success) {
      try {
        const body = JSON.parse(res.body);
        lightningId = body.data;
      } catch {}
    } else {
      flowSuccess = false;
      failRate.add(1);
      if (res.status >= 500) {
        console.error(`Lightning create failed: ${res.status}`);
      }
    }
  });

  sleep(0.3);

  // Step 5: 번개 상세 조회 (번개가 있으면)
  if (lightningId) {
    group('Step 5: Lightning Detail', () => {
      const start = Date.now();
      const res = http.get(`${BASE_URL}/lightning/${lightningId}`, {
        headers: getHeaders(accessToken),
        tags: { name: 'flow-lightning-detail' },
      });
      lightningDetailDuration.add(Date.now() - start);

      const success = check(res, {
        'lightning detail ok': (r) => r.status >= 200 && r.status < 300,
      });

      if (!success) {
        flowSuccess = false;
        failRate.add(res.status >= 500);
      }
    });
  }

  // 플로우 완료
  flowDuration.add(Date.now() - flowStart);

  if (flowSuccess) {
    successfulFlows.add(1);
  } else {
    failedFlows.add(1);
  }

  sleep(1 + Math.random());
}

export function handleSummary(data) {
  const { metrics } = data;

  let summary = '\n';
  summary += '╔══════════════════════════════════════════════════════════╗\n';
  summary += '║         V3 플로우 테스트 결과                            ║\n';
  summary += '║   그룹 생성 → 회식 생성 → 조회 → 번개 생성               ║\n';
  summary += '╚══════════════════════════════════════════════════════════╝\n\n';

  summary += '┌─ [단계별 응답시간 p95] ────────────────────────────────────┐\n';
  if (metrics.group_create_duration) {
    summary += `│  1. 그룹 생성:    ${metrics.group_create_duration.values['p(95)']?.toFixed(0) || 'N/A'}ms (목표 <1000ms)\n`;
  }
  if (metrics.dining_create_duration) {
    summary += `│  2. 회식 생성:    ${metrics.dining_create_duration.values['p(95)']?.toFixed(0) || 'N/A'}ms (목표 <1000ms)\n`;
  }
  if (metrics.dining_list_duration) {
    summary += `│  3. 회식 목록:    ${metrics.dining_list_duration.values['p(95)']?.toFixed(0) || 'N/A'}ms (목표 <500ms)\n`;
  }
  if (metrics.lightning_create_duration) {
    summary += `│  4. 번개 생성:    ${metrics.lightning_create_duration.values['p(95)']?.toFixed(0) || 'N/A'}ms (목표 <1000ms)\n`;
  }
  if (metrics.lightning_detail_duration) {
    summary += `│  5. 번개 상세:    ${metrics.lightning_detail_duration.values['p(95)']?.toFixed(0) || 'N/A'}ms (목표 <500ms)\n`;
  }
  summary += '└────────────────────────────────────────────────────────────┘\n\n';

  summary += '┌─ [전체 플로우] ────────────────────────────────────────────┐\n';
  if (metrics.flow_duration) {
    summary += `│  전체 플로우 p95: ${metrics.flow_duration.values['p(95)']?.toFixed(0)}ms (목표 <5000ms)\n`;
    summary += `│  전체 플로우 avg: ${metrics.flow_duration.values.avg?.toFixed(0)}ms\n`;
  }
  if (metrics.successful_flows && metrics.failed_flows) {
    const total = metrics.successful_flows.values.count + metrics.failed_flows.values.count;
    const rate = (metrics.successful_flows.values.count / total * 100).toFixed(1);
    summary += `│  성공률: ${rate}% (${metrics.successful_flows.values.count}/${total})\n`;
  }
  summary += '└────────────────────────────────────────────────────────────┘\n\n';

  summary += '┌─ [전체 요약] ───────────────────────────────────────────────┐\n';
  if (metrics.fail_rate) {
    summary += `│  실패율: ${(metrics.fail_rate.values.rate * 100).toFixed(2)}%\n`;
  }
  if (metrics.http_reqs) {
    summary += `│  총 요청: ${metrics.http_reqs.values.count}\n`;
    summary += `│  RPS: ${metrics.http_reqs.values.rate?.toFixed(2)}\n`;
  }
  summary += '└────────────────────────────────────────────────────────────┘\n';

  return {
    'stdout': summary,
    './v3-flow-test-summary.json': JSON.stringify(data, null, 2),
  };
}
