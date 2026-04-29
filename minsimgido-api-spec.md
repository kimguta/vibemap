# 민심지도 API 명세 초안

이 문서는 MVP 기준 API 흐름을 정리한 초안이다.

목표:

- 프론트 화면이 어떤 데이터를 받아야 하는지 명확히 한다
- 버튼 선택이 어떻게 저장되는지 정리한다
- 지역/기간/선택 상태가 어떤 식으로 연결되는지 정의한다

---

## 1. 기본 원칙

- 이 서비스는 "정확한 여론조사"가 아니라 "전국적인 흐름과 지역별 반응을 보는 참여형 보드"이다.
- 사용자의 선택은 자유롭게 바뀔 수 있다.
- 집계는 클릭 누적이 아니라 "마지막 선택 상태" 기준이다.
- API는 가능한 한 읽기와 쓰기를 단순하게 나눈다.

---

## 2. 공통 규칙

### Base URL 예시

```text
/api
```

### 응답 공통 형태

성공:

```json
{
  "ok": true,
  "data": {}
}
```

실패:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_REGION",
    "message": "유효하지 않은 지역입니다."
  }
}
```

---

## 3. 초기 화면용 API

첫 진입 시 필요한 것은:

1. 내 접속 지역
2. 오늘의 요약
3. 현재 선택 상태
4. 현재 탭의 지도 데이터

---

## 4. 내 접속 지역 조회

### GET `/api/me/location`

설명:

- 현재 사용자의 접속 지역 기본값을 반환
- 실제 서비스에서는 IP 기반 추정 또는 이전 선택 지역 기반으로 정할 수 있음

응답 예시:

```json
{
  "ok": true,
  "data": {
    "nation": {
      "id": 1,
      "name": "전국"
    },
    "province": {
      "id": 11,
      "name": "경기",
      "fullName": "경기도"
    },
    "city": {
      "id": 1101,
      "name": "수원시",
      "fullName": "경기도 수원시"
    }
  }
}
```

---

## 5. 오늘의 요약 조회

### GET `/api/summary`

쿼리:

```text
period=7d
scopeRegionId=11
```

설명:

- `scopeRegionId`는 접속 지역의 광역 단위
- 예: 수원시 사용자는 경기
- 예: 마포구 사용자는 서울

응답 예시:

```json
{
  "ok": true,
  "data": {
    "period": "7d",
    "nationalTotal": 84219,
    "localLabel": "경기 참여",
    "localTotal": 18440,
    "closeRegionsCount": 9,
    "lowVolumeRegionsCount": 4,
    "updatedAt": "2026-04-28T14:10:00+09:00"
  }
}
```

---

## 6. 현재 사용자 선택 상태 조회

### GET `/api/me/choice`

쿼리:

```text
regionId=11
```

설명:

- 현재 사용자가 이 지역에서 어떤 선택 상태를 가지고 있는지 반환
- 선택한 적이 없으면 `choice: null`

응답 예시:

```json
{
  "ok": true,
  "data": {
    "regionId": 11,
    "choice": "blue",
    "updatedAt": "2026-04-28T14:03:00+09:00"
  }
}
```

또는:

```json
{
  "ok": true,
  "data": {
    "regionId": 11,
    "choice": null,
    "updatedAt": null
  }
}
```

---

## 7. 지도 데이터 조회

### GET `/api/map`

쿼리:

```text
region=전국
period=7d
```

또는

```text
regionId=11
period=7d
```

설명:

- 현재 선택한 탭에 맞는 지도 아이템을 반환
- 전국이면 광역단체 목록
- 경기면 시군 목록
- 서울이면 구 목록

응답 예시: 전국

```json
{
  "ok": true,
  "data": {
    "region": {
      "id": 1,
      "name": "전국"
    },
    "period": "7d",
    "items": [
      {
        "regionId": 10,
        "name": "서울",
        "choice": "blue",
        "label": "파란당 우세",
        "gapPercent": 5.4,
        "total": 8200
      },
      {
        "regionId": 11,
        "name": "경기",
        "choice": "red",
        "label": "빨간당 우세",
        "gapPercent": 4.8,
        "total": 18440
      }
    ],
    "updatedAt": "2026-04-28T14:10:00+09:00"
  }
}
```

응답 예시: 경기

```json
{
  "ok": true,
  "data": {
    "region": {
      "id": 11,
      "name": "경기"
    },
    "period": "7d",
    "items": [
      {
        "regionId": 1101,
        "name": "수원시",
        "choice": "blue",
        "label": "파란당 우세",
        "gapPercent": 8.4,
        "total": 2180
      },
      {
        "regionId": 1102,
        "name": "성남시",
        "choice": "red",
        "label": "빨간당 우세",
        "gapPercent": 3.2,
        "total": 1930
      }
    ],
    "updatedAt": "2026-04-28T14:10:00+09:00"
  }
}
```

---

## 8. 지역 상세 한 줄 요약 조회

### GET `/api/regions/:regionId/summary`

쿼리:

```text
period=7d
```

설명:

- 타일 클릭 시 상단 요약 문구를 만들 때 사용 가능

응답 예시:

```json
{
  "ok": true,
  "data": {
    "regionId": 1101,
    "name": "수원시",
    "choice": "blue",
    "label": "파란당 우세",
    "gapPercent": 8.4,
    "total": 2180
  }
}
```

---

## 9. 사용자 선택 저장

### POST `/api/me/choice`

설명:

- 사용자가 버튼을 눌렀을 때 현재 선택 상태를 저장
- 기존 값이 있으면 업데이트
- 선택 해제도 허용 가능

요청 예시:

```json
{
  "regionId": 11,
  "choice": "blue"
}
```

`choice` 값:

- `blue`
- `red`
- `undecided`
- `null` 또는 별도 delete API로 해제 가능

응답 예시:

```json
{
  "ok": true,
  "data": {
    "regionId": 11,
    "choice": "blue",
    "updatedAt": "2026-04-28T14:22:00+09:00"
  }
}
```

처리 원칙:

- 기존 선택이 없으면 새로 생성
- 기존 선택이 있으면 변경
- 집계는 누적이 아니라 상태 이동 기준으로 반영

---

## 10. 선택 해제

### DELETE `/api/me/choice`

쿼리:

```text
regionId=11
```

응답 예시:

```json
{
  "ok": true,
  "data": {
    "regionId": 11,
    "choice": null
  }
}
```

설명:

- 현재 지역에서 선택을 제거
- 집계에서는 마지막 선택을 1 감소시켜야 함

---

## 11. 지역 탭 목록 조회

### GET `/api/regions/tabs`

설명:

- 상단 지역 탭을 서버에서 내려줄 수도 있음
- MVP에서는 프론트 하드코딩도 가능

응답 예시:

```json
{
  "ok": true,
  "data": [
    { "id": 1, "name": "전국", "level": "nation" },
    { "id": 10, "name": "서울", "level": "province" },
    { "id": 11, "name": "경기", "level": "province" },
    { "id": 12, "name": "부산", "level": "province" }
  ]
}
```

---

## 12. 기간 탭 처리 방식

프론트의 `1일 / 7일 / 30일 / 1년`은 전부 같은 API를 period만 바꿔서 호출하면 된다.

예:

```text
/api/summary?period=1d&scopeRegionId=11
/api/map?regionId=11&period=1d
```

```text
/api/summary?period=30d&scopeRegionId=11
/api/map?regionId=11&period=30d
```

---

## 13. 추천 프론트 초기 로드 순서

1. `/api/me/location`
2. `/api/summary`
3. `/api/me/choice`
4. `/api/map`

이렇게 불러오면 지금 프로토타입 화면을 거의 그대로 채울 수 있다.

---

## 14. 선택 변경 시 서버 처리 순서

버튼을 눌렀을 때 서버는 보통 이렇게 처리하면 된다.

1. participant 식별 또는 생성
2. 기존 choice 조회
3. 새 choice와 비교
4. `participant_choices` upsert
5. `choice_events` insert
6. `region_snapshots` 재계산 또는 큐 적재
7. 최신 상태 반환

---

## 15. 실제 집계 반영 원칙

예:

- 기존: `blue`
- 변경: `red`

그러면:

- `blue_count -1`
- `red_count +1`

예:

- 기존: `red`
- 변경: `undecided`

그러면:

- `red_count -1`
- `undecided_count +1`

즉 버튼 클릭 횟수를 세는 게 아니라, **현재 상태 이동**을 세는 것이다.

---

## 16. MVP에서 꼭 필요한 API만 뽑으면

최소 세트:

1. `GET /api/me/location`
2. `GET /api/summary`
3. `GET /api/map`
4. `GET /api/me/choice`
5. `POST /api/me/choice`
6. `DELETE /api/me/choice`

이 정도면 현재 화면은 충분히 살아난다.

---

## 17. 한 줄 정리

민심지도 API의 핵심은:

> **읽기 API는 요약/지도/현재선택을 내려주고, 쓰기 API는 마지막 선택 상태를 갱신하는 구조**

