# Aladin → Notion

알라딘에서 책을 검색하고 선택한 책의 상세 정보를 Notion 데이터베이스에 저장하는 웹 앱입니다.

## 로컬 실행

프로젝트 루트의 `.env`에 아래 값을 입력한 뒤 실행합니다.

```text
NOTION_TOKEN=...
NOTION_DATA_SOURCE_ID=...
ALADIN_TTB_KEY=...
```

```powershell
npm start
```

브라우저에서 `http://127.0.0.1:3000`을 엽니다.

## Vercel 배포

Vercel 프로젝트 설정:

- Framework Preset: `Other`
- Root Directory: `.`
- Build Command: 비워두기
- Output Directory: `public`
- Install Command: 기본값

Vercel의 **Settings → Environment Variables**에 다음 값을 추가합니다.

- `NOTION_TOKEN`
- `NOTION_DATA_SOURCE_ID`
- `ALADIN_TTB_KEY`

각 환경 변수는 최소한 `Production`에 적용하고, Preview 배포에서도 테스트하려면 `Preview`에도 적용합니다. 값 변경 후에는 다시 배포해야 합니다.

`/api/search`와 `/api/import`는 Vercel Functions로 실행됩니다. 검색 결과는 서버 메모리에 저장하지 않으며, 저장 요청 시 ISBN 또는 알라딘 상품 ID로 상세 정보를 다시 조회합니다.

> 공개 URL을 아는 사용자는 연결된 Notion 데이터베이스에 책을 추가할 수 있습니다. 개인용이라면 Vercel Deployment Protection 또는 별도 인증을 설정하세요.
