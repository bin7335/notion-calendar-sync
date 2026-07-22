# notion-calendar-sync

Notion "해야할일" DB(완료/보류/안함 제외, 제목·날짜·장소만)를 매시간 ICS 파일로 만들어
`docs/` 폴더에 커밋하고, GitHub Pages로 공개 URL을 만들어 구글 캘린더가 구독하게 한다.

## 1. Notion 쪼 통합(Integration) 만들기

1. https://www.notion.so/profile/integrations 접속 → "새 통합 만들기"
2. 이름은 자유(예: calendar-sync), 워크스페이스 선택 → 생성
3. 생성된 **Internal Integration Token**을 복사해둔다 (`secret_...`로 시작)
4. Notion에서 "해야할일" 데이터베이스 페이지를 열고, 우측 상단 `...` → "연결 추가" → 방금 만든 통합을 선택해 권한 부여

## 2. 데이터베이스 ID 확인

"해야할일" 데이터베이스 URL에서 32자리 ID를 복사한다.
(이번에 MCP로 확인한 값: `8404b29a5f3c4e48a04bcfd15858334e` — 하이픈 없이 입력해도 된다)

## 3. GitHub 저장소 만들고 푸시

```bash
gh repo create notion-calendar-sync --private --source=. --remote=origin
git push -u origin main
```

(`gh` CLI가 없으면 github.com에서 새 저장소를 만들고 안내에 따라 `git remote add origin ...` 후 push)

## 4. GitHub Secrets 등록

저장소 Settings → Secrets and variables → Actions → New repository secret

| 이름 | 값 |
|---|---|
| `NOTION_TOKEN` | 1단계에서 복사한 토큰 |
| `NOTION_DATABASE_ID` | 2단계에서 복사한 ID |
| `ICS_FILENAME` | `calendar-f8339e145013756e.ics` (추측 불가능한 파일명 — 원하면 다른 랜덤 문자열로 교체 가능) |

## 5. GitHub Pages 활성화

저장소 Settings → Pages → Source: **Deploy from a branch** → Branch: `main` / `docs` 폴더 선택 → Save

저장 후 공개 URL이 생성된다 (보통 `https://<username>.github.io/notion-calendar-sync/`).

## 6. 워크플로우 1회 실행

Actions 탭 → "Sync Notion calendar to ICS" → "Run workflow" 로 수동 실행해서
`docs/calendar-f8339e145013756e.ics` 파일이 생성·커밋되는지 확인한다.

## 7. 구글 캘린더에 구독

구글 캘린더 → 다른 캘린더 추가 → URL로 추가 →

```
https://<username>.github.io/notion-calendar-sync/calendar-f8339e145013756e.ics
```

구글이 이 URL을 보통 8~24시간 주기로 자체 갱신한다(즉시 반영 아님).

## 동작 방식

- 매시간(UTC 기준 정각) GitHub Actions가 Notion API로 "해야할일"을 조회
- 완료/보류/안함이 체크된 항목은 제외
- 제목(Task To Do)·날짜(날짜 속성)·장소만 ICS 이벤트로 변환해 `docs/<ICS_FILENAME>`에 저장
- 변경이 있으면 자동 커밋·푸시 → GitHub Pages가 자동 갱신

## 8. 매일 아침 카카오톡 일정 브리핑

`.github/workflows/morning-briefing.yml`이 매일 07:30(KST)에 실행되어 Notion "해야할일" DB의 앞으로 7일 일정을 짧게 요약하고, 카카오톡 "나에게 보내기"로 전송한다.

GitHub Actions는 로컬 Orca MCP를 직접 호출할 수 없으므로, 카카오 전송은 Kakao Developers REST API를 사용한다. 카카오 공식 문서 기준으로 "나에게 기본 템플릿으로 메시지 발송"은 `POST https://kapi.kakao.com/v2/api/talk/memo/default/send`를 액세스 토큰으로 호출한다. 텍스트 템플릿은 최대 200자이므로 브리핑도 짧게 보낸다.

추가 GitHub Secrets:

| 이름 | 값 |
|---|---|
| `KAKAO_ACCESS_TOKEN` | 선택. 수동으로 발급한 액세스 토큰. 만료가 짧아 장기 운영에는 비추천 |
| `KAKAO_REST_API_KEY` | 권장. Kakao Developers 앱의 REST API 키 |
| `KAKAO_REFRESH_TOKEN` | 권장. `talk_message` 권한에 동의해 발급받은 사용자 refresh token |
| `KAKAO_CLIENT_SECRET` | 선택. 앱에서 Client Secret을 활성화한 경우 필요 |

운영은 `KAKAO_REST_API_KEY` + `KAKAO_REFRESH_TOKEN` 조합을 권장한다. 워크플로우가 실행될 때마다 refresh token으로 access token을 갱신한 뒤 메시지를 보낸다. 카카오가 새 refresh token을 반환하는 경우 GitHub Actions 로그에 경고가 남으므로, 그때 `KAKAO_REFRESH_TOKEN` secret을 새 값으로 교체해야 한다.

선택 GitHub Variables:

| 이름 | 값 |
|---|---|
| `BRIEFING_LINK_URL` | 카카오 메시지 버튼이 열 URL. 기본값은 현재 ICS 공개 URL |

수동 테스트:

```bash
npm run briefing
```

GitHub에서는 Actions 탭 → "Send morning schedule briefing" → "Run workflow"로 수동 실행해 카카오톡 수신 여부를 확인한다.
