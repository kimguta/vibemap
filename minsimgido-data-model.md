# 민심지도 데이터 구조 초안

## 1. 핵심 원칙

- 이 서비스는 "정확한 여론조사"가 아니라 "전국적인 흐름과 지역별 반응을 보는 참여형 보드"이다.
- 사용자는 자유롭게 선택을 바꿀 수 있다.
- 집계는 누를 때마다 누적하는 방식이 아니라, 마지막 선택 상태를 기준으로 계산한다.
- 지역은 `전국 -> 광역단체 -> 기초단체` 구조를 기본으로 한다.
- 기간은 `1일 / 7일 / 30일 / 1년` 기준으로 집계한다.

---

## 2. 필요한 데이터 단위

화면을 실제로 돌리려면 크게 5개가 필요하다.

1. 지역 정보
2. 사용자/브라우저 식별 정보
3. 사용자 선택 상태
4. 집계 결과
5. 기간별 요약 캐시

---

## 3. 지역 테이블

### regions

```text
id
parent_id
level
name
name_full
sort_order
is_active
```

예시:

```text
1   null   nation     전국        전국
10  1      province   서울        서울특별시
11  1      province   경기        경기도
1101 11    city       수원시      경기도 수원시
1102 11    city       성남시      경기도 성남시
```

설명:

- `level`: `nation | province | city`
- `parent_id`: 상위 지역
- `name`: 화면에 짧게 보여줄 이름
- `name_full`: 전체 이름

---

## 4. 사용자 식별 테이블

로그인 없이 시작한다면 사람 자체를 정확히 아는 게 아니라, "이 브라우저에서 온 참여" 정도만 약하게 관리한다.

### participants

```text
id
fingerprint_key
first_seen_at
last_seen_at
last_ip_hash
user_agent
```

설명:

- `fingerprint_key`: 브라우저/기기 기준의 약한 식별값
- `last_ip_hash`: IP 원문 저장 대신 해시 권장
- `user_agent`: 브라우저 종류 파악용

주의:

- 이 값은 완전한 1인 식별이 아니다.
- 중복 참여 억제용 보조 값이다.

---

## 5. 현재 선택 상태 테이블

이게 제일 중요하다.  
버튼을 여러 번 눌러도 "마지막에 무엇을 선택했는가"만 저장해야 한다.

### participant_choices

```text
id
participant_id
region_id
choice
selected_at
updated_at
period_scope
```

예시:

```text
1001   p_abc123   1101   blue   2026-04-28 13:20   2026-04-28 14:03   active
```

설명:

- `choice`: `blue | red | undecided`
- `region_id`: 사용자가 참여한 지역
- `participant_id + region_id`는 사실상 유니크하게 관리
- 같은 사용자가 같은 지역에서 선택을 바꾸면 `update`

핵심:

- `insert`를 계속 쌓는 게 아니라
- **upsert**처럼 마지막 상태를 갱신해야 함

---

## 6. 선택 이력 테이블

운영상 흐름을 보려면 상태만 있으면 부족하고, "언제 바뀌었는지"도 남겨야 한다.

### choice_events

```text
id
participant_id
region_id
previous_choice
new_choice
created_at
source
```

설명:

- `previous_choice`: 이전 값
- `new_choice`: 새 값
- `source`: `web`, `mobile_web` 등

용도:

- 기간별 변화 계산
- 하루 동안 어떤 방향으로 많이 움직였는지 분석
- 이상 패턴 탐지

---

## 7. 집계 테이블

화면에서 매번 실시간 계산하면 느려질 수 있으니, 집계 결과를 따로 캐시하는 게 좋다.

### region_snapshots

```text
id
region_id
period
blue_count
red_count
undecided_count
total_count
blue_ratio
red_ratio
undecided_ratio
leading_choice
gap_percent
updated_at
```

설명:

- `period`: `1d | 7d | 30d | 1y`
- `leading_choice`: `blue | red | tie | undecided`
- `gap_percent`: 1위와 2위 차이

예시:

```text
region_id: 11
period: 7d
blue_count: 8120
red_count: 9560
undecided_count: 760
total_count: 18440
leading_choice: red
gap_percent: 4.8
```

---

## 8. 오늘의 요약용 데이터

왼쪽 패널은 빠르게 뽑히는 숫자여서 별도 요약 캐시가 있으면 편하다.

### summary_metrics

```text
id
scope_region_id
period
total_participants
local_participants
close_regions_count
low_volume_regions_count
updated_at
```

설명:

- `scope_region_id`: 접속자의 기준 지역 상위 단위
- 예: 수원시 사용자는 `경기`
- 예: 마포구 사용자는 `서울`

예시:

```text
scope_region_id: 경기
period: 7d
total_participants: 84219
local_participants: 18440
close_regions_count: 9
low_volume_regions_count: 4
```

---

## 9. 화면에 필요한 API 구조

### 1) 내 접속 지역 정보

```json
{
  "province": "경기",
  "city": "수원시"
}
```

### 2) 오늘의 요약

```json
{
  "period": "7d",
  "national_total": 84219,
  "local_label": "경기 참여",
  "local_total": 18440,
  "close_regions_count": 9,
  "low_volume_regions_count": 4
}
```

### 3) 지도 데이터

```json
{
  "region": "경기",
  "period": "7d",
  "items": [
    {
      "name": "수원시",
      "choice": "blue",
      "gap_percent": 8.4,
      "total": 2180
    },
    {
      "name": "성남시",
      "choice": "red",
      "gap_percent": 3.2,
      "total": 1930
    }
  ]
}
```

### 4) 내 현재 선택 상태

```json
{
  "region": "경기",
  "choice": "blue",
  "updated_at": "2026-04-28T14:03:00+09:00"
}
```

### 5) 선택 변경 요청

```json
{
  "region_id": 11,
  "choice": "red"
}
```

---

## 10. 선택 변경 시 집계 원칙

### 잘못된 방식

- 빨간당 누를 때마다 `red_count +1`

이렇게 하면 한 사람이 계속 바꾸면서 숫자를 부풀릴 수 있다.

### 맞는 방식

예:

- 기존 선택: `blue`
- 새 선택: `red`

처리:

- `blue_count -1`
- `red_count +1`
- 현재 선택 상태 업데이트
- 이력 1건 추가

즉 "새 클릭 수"가 아니라 "현재 상태 이동"으로 봐야 한다.

---

## 11. MVP에서 꼭 필요한 최소 필드

처음엔 이 정도만 있어도 된다.

### 최소 regions

```text
id / parent_id / level / name
```

### 최소 participants

```text
id / fingerprint_key / last_seen_at
```

### 최소 participant_choices

```text
participant_id / region_id / choice / updated_at
```

### 최소 region_snapshots

```text
region_id / period / blue_count / red_count / undecided_count / total_count / leading_choice / gap_percent
```

---

## 12. 추천 구현 순서

1. `regions` 만든다
2. `participant_choices` 만든다
3. 버튼 클릭 시 현재 선택을 `upsert` 한다
4. `choice_events`를 쌓는다
5. 배치나 트리거로 `region_snapshots`를 계산한다
6. 화면은 `region_snapshots`를 읽는다

---

## 13. 한 줄 정리

민심지도의 핵심 데이터 구조는:

> **지역 정보 + 참가자 식별 + 마지막 선택 상태 + 선택 이력 + 기간별 집계 캐시**

이 다섯 개로 보면 된다.
