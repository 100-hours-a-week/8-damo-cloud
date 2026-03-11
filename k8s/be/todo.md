# BE Helm Chart 전환 가이드

## 현재 구조 vs Helm 구조

```
현재                          Helm 전환 후
─────────────────────         ─────────────────────────────
be/                           be/
├── deployment.yaml           ├── Chart.yaml
├── configmap.yaml            ├── values.yaml
└── secret.yaml               └── templates/
                                  ├── deployment.yaml
                                  ├── configmap.yaml
                                  ├── secret.yaml
                                  └── service.yaml
```

---

## 각 파일 역할

### Chart.yaml
Chart의 메타데이터 (이름, 버전 등)

```yaml
apiVersion: v2
name: backend
version: 1.0.0        # Chart 버전 (배포 이력 추적에 사용됨)
appVersion: "1.0.0"   # 실제 앱 버전 (참고용)
```

### values.yaml
템플릿에 주입할 기본값. 여기서 환경별로 바꿀 값들을 정의

```yaml
image:
  repository: 080598576517.dkr.ecr.ap-northeast-2.amazonaws.com/prod/be
  tag: "latest"

replicas: 2

resources:
  requests:
    cpu: "500m"
    memory: "624Mi"
  limits:
    cpu: "2000m"
    memory: "1.5Gi"

config:
  activeProfile: "prod"
  mysqlUrl: "jdbc:mysql://..."
  redisHost: "redis"
  redisPort: "6379"
  kafkaBootstrapServers: "kafka:9092"
  kafkaGroupId: "damo-be-prod"
  # ... 나머지 ConfigMap 값들

service:
  port: 8080
```

### templates/deployment.yaml
values.yaml의 값을 참조하는 템플릿

```yaml
replicas: {{ .Values.replicas }}
image: {{ .Values.image.repository }}:{{ .Values.image.tag }}

resources:
  requests:
    cpu: {{ .Values.resources.requests.cpu }}
    memory: {{ .Values.resources.requests.memory }}
  limits:
    cpu: {{ .Values.resources.limits.cpu }}
    memory: {{ .Values.resources.limits.memory }}
```

### templates/service.yaml
Pod를 클러스터 내부에서 접근 가능하게 노출

```yaml
apiVersion: v1
kind: Service
metadata:
  name: backend
  namespace: prod
spec:
  selector:
    app: backend      # deployment의 pod label과 매칭
  ports:
    - port: 8080
      targetPort: 8080
  type: ClusterIP     # 클러스터 내부 통신용 (Ingress가 외부 트래픽 처리)
```

---

## 실행 방법

### 최초 배포
```bash
helm install backend ./be -n prod
```

### 변경 사항 반영 (이미지 태그, 환경변수 등)
```bash
helm upgrade backend ./be -n prod
```

### 이미지 태그만 빠르게 바꿀 때
```bash
helm upgrade backend ./be -n prod --set image.tag=v1.2.0
```

### 배포 이력 확인
```bash
helm history backend -n prod
```

### 이전 버전으로 롤백
```bash
helm rollback backend 2 -n prod   # 2번째 배포 시점으로
```

### 전체 리소스 삭제
```bash
helm uninstall backend -n prod    # 관련 리소스 전부 한번에 삭제
```

---

## Secret 처리 주의사항

Secret은 Helm Chart에 값을 직접 넣으면 git에 노출되기 때문에 별도로 관리

**방법 1 - Helm 외부에서 Secret만 따로 apply (가장 단순)**
```bash
kubectl apply -f secret.yaml -n prod   # Secret은 별도 관리
helm install backend ./be -n prod      # 나머지는 Helm으로
```

**방법 2 - helm-secrets 플러그인 사용**
```bash
helm plugin install https://github.com/jkroepke/helm-secrets
# secret을 암호화해서 git에 올리고 helm upgrade 시 복호화
helm secrets upgrade backend ./be -f secrets.yaml -n prod
```

현재 단계에서는 방법 1이 단순하고 충분함

---

## ArgoCD 연동 시 Application 리소스

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: backend
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/your-org/damo
    targetRevision: main
    path: k8s/be                  # Chart 위치
    helm:
      valueFiles:
        - values.yaml
  destination:
    server: https://kubernetes.default.svc
    namespace: prod
  syncPolicy:
    automated:
      prune: true                 # Git에서 삭제된 리소스 클러스터에서도 삭제
      selfHeal: true              # 클러스터 수동 변경 시 Git 기준으로 복원
```

---

## TODO

- [ ] Chart.yaml 작성
- [ ] values.yaml 작성 (현재 configmap.yaml 값 이전)
- [ ] templates/deployment.yaml 템플릿으로 변환
- [ ] templates/configmap.yaml 템플릿으로 변환
- [ ] templates/service.yaml 작성
- [ ] secret.yaml 관리 방식 결정 (방법 1 or 2)
- [ ] ArgoCD Application 리소스 작성
