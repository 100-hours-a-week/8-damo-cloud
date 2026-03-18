# Nginx Ingress Controller

## 트래픽 흐름

```
사용자
  │
  ▼
Route53 (damo.today)
  │
  ▼
CloudFront
  │
  ▼
ALB
  │  Host: damo.today
  ▼
Worker Node :30080 (NodePort)
  │  kube-proxy가 nginx pod로 포워딩
  ▼
Nginx Ingress Controller (DaemonSet, 워커노드마다 1개)
  │
  ├─ /api  →  backend  Service :8080
  ├─ /ai   →  ai       Service :8000
  └─ /     →  frontend Service :3000
```

## 설치

```bash
# 1. manifest 다운로드 후 DaemonSet으로 변경 (이미 반영된 ingress-deploy.yaml 사용 시 생략)
curl -o ingress-deploy.yaml https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.10.1/deploy/static/provider/baremetal/deploy.yaml
sed -i '' 's/kind: Deployment/kind: DaemonSet/' ingress-deploy.yaml
sed -i '' '/^\s*replicas:/d' ingress-deploy.yaml
# ingress-deploy.yaml Service 포트 항목에 nodePort: 30080 / nodePort: 30443 추가

# 2. 설치
kubectl apply -f k8s/ingress/ingress-deploy.yaml

# 3. Controller 준비 대기
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=120s

# 4. 라우팅 규칙 적용
kubectl apply -f k8s/ingress/ingress.yaml
```

## 구성 요소

| 구성 | 내용 |
|------|------|
| Controller 방식 | DaemonSet (워커노드마다 1개) |
| 진입 포트 | NodePort 30080 (HTTP), 30443 (HTTPS) |
| 도메인 | damo.today |
| 라우팅 기준 | Host 헤더 + Path |
