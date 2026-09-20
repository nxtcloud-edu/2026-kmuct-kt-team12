# 프론트엔드 배포 (S3 + CloudFront, 콘솔만)

_리전: us-east-1 · CLI 불필요, 전부 콘솔 클릭 · 대상: `frontend/dist/`_

Vite React SPA 를 S3 정적 호스팅 + CloudFront 로 배포한다. Lambda(백엔드)와 독립이라 지금 바로 가능.

---

## 0. 빌드 (로컬, 1회)

```bash
cd frontend
npm install
npm run build      # dist/ 생성 (index.html + assets/)
```

> API 아직 없으면 그대로 빌드하면 목 데이터로 동작. API 나오면:
> `VITE_USE_MOCK=false VITE_API_BASE=<API_URL> npm run build` 로 다시 빌드.

업로드할 것: `frontend/dist/` 안의 `index.html` 과 `assets/` 폴더.

## 1. S3 버킷 만들기 (콘솔)

1. 콘솔 검색 **S3** → **Create bucket**.
2. 이름: 예 `kiroton-team12-web` (전역 유일해야 함).
3. 리전: **us-east-1**.
4. **Block all public access**: CloudFront 로만 노출할 거면 **켜둔 채로** 둬도 됨(권장, 3-B 방식). 빠르게 하려면 꺼서 S3 웹사이트로 직접 공개(3-A).
5. Create.

## 2. 파일 업로드 (콘솔 드래그)

1. 버킷 → **Upload** → `dist/` 안의 `index.html` 과 `assets/` 폴더를 드래그.
2. **Upload**.

> 파일이 바뀔 때마다 이 업로드를 반복. (CLI 되면 `aws s3 sync dist/ s3://버킷` 한 줄)

## 3. 공개 방법 — 둘 중 하나

### 3-A. 빠른 방법: S3 정적 웹사이트 호스팅 (데모용)

1. 버킷 → **Properties** → 맨 아래 **Static website hosting** → **Enable**.
2. Index document: `index.html`
3. **Error document: `index.html`** ← ⚠ SPA 라우팅 때문에 필수 (없는 경로도 index.html 이 받아 react-router 가 처리).
4. 저장 후 나오는 **버킷 웹사이트 엔드포인트** URL 이 접속 주소.
5. Block public access 를 끄고, 버킷 정책으로 `s3:GetObject` public 허용.
   - Permissions → Bucket policy → `"Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::버킷명/*"`

### 3-B. 권장: CloudFront (HTTPS + 캐싱)

1. 콘솔 검색 **CloudFront** → **Create distribution**.
2. **Origin domain**: 위 S3 버킷 선택.
   - "Origin access": **Origin access control (OAC)** 사용 → 버킷은 비공개 유지, CloudFront 만 접근. (콘솔이 버킷 정책 자동 제안 → 복사해 적용)
3. **Default root object**: `index.html`.
4. **SPA 라우팅 (필수)**: 배포 생성 후 → **Error pages** 탭 → **Create custom error response**:
   - HTTP error code **403** → Response page path **`/index.html`** → HTTP Response code **200**
   - 같은 방식으로 **404** → **`/index.html`** → **200**
   - (react-router BrowserRouter 라 새로고침·직접 URL 접근 시 이게 없으면 깨짐)
5. 배포되면 **Distribution domain name** (`xxxx.cloudfront.net`) 이 접속 주소.

## 4. API 연결 (백엔드 나온 뒤)

1. `VITE_USE_MOCK=false VITE_API_BASE=<API_Gateway_URL> npm run build`
2. `dist/` 다시 업로드.
3. CloudFront 쓰면 → **Invalidations** 탭 → **Create invalidation** → `/*` (캐시 비우기).
4. ⚠ 백엔드 API Gateway 에서 **CORS 허용 도메인**에 이 CloudFront 도메인 추가 (팀원과 공유).

## 확인

- CloudFront/S3 URL 접속 → 등록 화면이 뜨는지.
- 활동 카드 클릭 → 펼침, 문장 클릭 → 원문 근거 패널.
- 새로고침해도 안 깨지는지 (= 404→index.html 설정 확인).

## 팀원에게 공유할 값

- 프론트 접속 URL (CloudFront 도메인)
- 이 도메인을 API CORS 에 넣어달라고 요청
- 반대로 팀원에게서 받을 것: **API Gateway URL** (→ `VITE_API_BASE`)
