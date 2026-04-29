# 바이브맵

지역별 선택 흐름을 보여주는 참여형 질문 지도 프로토타입이다.

현재 최초 버전의 질문은 `오늘 점심은 짜장 vs 짬뽕?`이며, 사용자는 `짜장면`, `짬뽕`, `아직 못 정함` 중 하나를 선택할 수 있다.

## 현재 구성

- `minsimp-map-prototype.html`: 바이브맵 상세 화면
- `vibemap-server/`: 로컬 API 서버
- `vibemap-server/data/vibemap-db.json`: 질문, 지역, 샘플 집계 데이터
- `minsimgido-*.md`, `minsimgido-db-schema.sql`: 초기 데이터/API 설계 문서

## 로컬 실행

Node.js가 설치되어 있으면 별도 패키지 설치 없이 실행할 수 있다.

```powershell
cd C:\Users\JS.SHIM\Documents\Codex\2026-04-28\new-chat\vibemap-server
npm start
```

브라우저에서 아래 주소를 연다.

```text
http://127.0.0.1:8788/minsimp-map-prototype.html
```

## API

주요 엔드포인트:

- `GET /api/health`
- `GET /api/questions`
- `GET /api/questions/current`
- `GET /api/summary?questionId=lunch-jjajang-jjamppong&period=7d&scopeRegion=경기`
- `GET /api/map?questionId=lunch-jjajang-jjamppong&period=7d&region=전국`
- `GET /api/me/choice?questionId=lunch-jjajang-jjamppong&participantId=...&region=수원시`
- `POST /api/choices`

선택 저장은 클릭 누적이 아니라 `participantId + questionId + region + period` 기준의 마지막 상태를 갱신하는 방식이다.

## 서비스 방향

지금 화면은 질문 하나의 상세 페이지다. 이후 목표는 다음 구조다.

1. 질문 카드형 인덱스 페이지
2. 질문 상세 지도 페이지
3. 운영자 질문 등록
4. 사용자 질문 제안
5. 사용자 직접 질문 생성
6. 지역별 트렌드 리포트와 제휴/광고 영역

## 배포 전 메모

현재 로컬 서버는 JSON 시드 데이터를 읽고 실행 중 선택값은 메모리에 반영한다. 실제 서비스 배포 전에는 Supabase/Postgres 같은 DB로 교체하는 것이 좋다.
