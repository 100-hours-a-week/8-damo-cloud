import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL;
const AUTH_TOKEN = __ENV.AUTH_TOKEN;

const failRate = new Rate("fail_rate");
const tBasic = new Trend("latency_me_basic", true);
const tGroups = new Trend("latency_me_groups", true);

export const options = {
  discardResponseBodies: true,
  scenarios: {
    gate: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || 5),
      duration: __ENV.DURATION || "30s",
    },
  },
  thresholds: {
    fail_rate: ["rate<0.02"],
    latency_me_basic: ["p(95)<900", "p(99)<1800"],
    latency_me_groups: ["p(95)<1500", "p(99)<3000"],
  },
};

function mustEnv(name, value) {
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

export function setup() {
  mustEnv("BASE_URL", BASE_URL);
  return {
    baseUrl: BASE_URL.replace(/\/$/, ""),
    token: AUTH_TOKEN,
  };
}

export default function (data) {
  const base = data.baseUrl;

  const headers = {
    "User-Agent": "k6-sli-gate",
    Accept: "application/json",
  };

  if (data.token) {
    headers["Authorization"] = data.token.startsWith("Bearer ")
      ? data.token
      : `Bearer ${data.token}`;
  }

  // ---- 1) /api/v1/users/me/basic ----
  {
    const res = http.get(`${base}/api/v1/users/me/basic`, {
      headers,
      tags: { name: "GET me basic" },
    });
    tBasic.add(res.timings.duration);

    const ok = check(res, {
      "me/basic status is 2xx": (r) => r.status >= 200 && r.status < 300,
    });
    failRate.add(!ok);
  }

  // ---- 2) /api/v1/users/me/groups ----
  {
    const res = http.get(`${base}/api/v1/users/me/groups`, {
      headers,
      tags: { name: "GET me groups" },
    });
    tGroups.add(res.timings.duration);

    const ok = check(res, {
      "me/groups status is 2xx": (r) => r.status >= 200 && r.status < 300,
    });
    failRate.add(!ok);
  }

  sleep(1);
}