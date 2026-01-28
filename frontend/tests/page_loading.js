import http from "k6/http"
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

export const page_load_failed = new Rate("page_load_failed");

const URL = __ENV.URL;
const TOKEN = __ENV.ACCESS_TOKEN;

export const options = {
    vus: 100,
    duration: "60s",
    thresholds: {
        // 성공률 >= 99.5% == 실패율 <= 0.5%
        page_load_failed: ["rate<=0.005"],
    }
};

export default function () {
    const res = http.get(URL, {
        headers: {
            Authorization: `Bearer ${TOKEN}`,
        }
    });

    // 페이지 로드 성공
    const ok = check(res, {
        "page load: status 2xx/3xx": (r) => r.status >= 200 && r.status < 400
    });

    page_load_failed.add(!ok);

    sleep(1);
}