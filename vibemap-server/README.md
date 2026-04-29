# 바이브맵 로컬 백엔드

이 폴더는 배포 전 MVP 검증용 백엔드다. 별도 DB 설치 없이 시작 데이터는 JSON 파일에서 읽는다.

현재 이 PC의 `Documents` 폴더에서 Node 파일 쓰기가 막혀 있어 실행 중 선택값은 메모리에 저장된다. 서버를 끄면 `data/vibemap-db.json`의 시드 데이터로 돌아간다. 배포 단계에서는 Supabase/Postgres 같은 실제 DB로 교체하면 된다.

## 실행

```powershell
cd C:\Users\JS.SHIM\Documents\Codex\2026-04-28\new-chat\vibemap-server
npm start
```

기본 주소:

```text
http://127.0.0.1:8788/minsimp-map-prototype.html
```

## 주요 API

- `GET /api/health`
- `GET /api/questions`
- `GET /api/questions/current`
- `GET /api/summary?questionId=lunch-jjajang-jjamppong&period=7d&scopeRegion=경기`
- `GET /api/map?questionId=lunch-jjajang-jjamppong&period=7d&region=전국`
- `GET /api/me/choice?questionId=lunch-jjajang-jjamppong&participantId=...&region=수원시`
- `POST /api/choices`

`POST /api/choices` 예시:

```json
{
  "questionId": "lunch-jjajang-jjamppong",
  "participantId": "browser-abc",
  "region": "수원시",
  "choiceId": "blue"
}
```

선택은 클릭 누적이 아니라 `participantId + questionId + region` 기준의 마지막 상태로 갱신된다.
