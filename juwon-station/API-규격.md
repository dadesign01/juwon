# 충전 대시보드 ↔ 파이썬 백엔드 연동 규격

프론트(React)는 화면만 그립니다. CAN 버스를 읽고 값을 정규화하는 일은 전부 파이썬 쪽 몫입니다.
아래 형식만 맞춰주면 스테이션이 2대든 10대든 화면이 알아서 따라갑니다.

---

## 1. 상태 전달

### 권장: 웹소켓 push

```
ws://<호스트>:8000/ws/stations
```

파이썬이 CAN 프레임을 받을 때마다 아래 JSON을 그대로 밀어주면 됩니다.
프론트는 받은 즉시 화면을 갱신합니다. 폴링보다 지연이 없고 부하도 적습니다.

### 대안: HTTP 폴링

```
GET /api/stations      → 아래 JSON 반환 (프론트가 1초마다 호출)
```

프론트 파일 상단에서 `TRANSPORT` 값을 `"ws"` 또는 `"http"`로 바꾸면 전환됩니다.

---

## 2. 상태 JSON

```json
{
  "stations": [
    {
      "id": "MASTER",
      "name": "MASTER",
      "slots": [
        { "no": 1, "present": true,  "mode": "CHARGING", "soc": 72.0, "volt": 54.2, "curr": 8.6, "temp": 31.5 },
        { "no": 2, "present": true,  "mode": "DONE",     "soc": 100.0,"volt": 54.6, "curr": 0.0, "temp": 28.0 }
      ]
    },
    {
      "id": "STATION1",
      "name": "STATION 1",
      "slots": [ ... ]
    }
  ]
}
```

### 필드

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 스테이션 고유값. 제어 요청 시 이 값을 씁니다 |
| `name` | string | 탭에 표시될 이름 |
| `slots[].no` | int | 슬롯 번호 (1부터) |
| `slots[].present` | bool | 배터리 삽입 여부 |
| `slots[].mode` | string | 충전모드 — 아래 표 참조 |
| `slots[].soc` | number | 배터리 잔량 % (0~100) |
| `slots[].volt` | number | 충전 전압 V |
| `slots[].curr` | number | 충전 전류 A |
| `slots[].temp` | number | 내부 온도 ℃ |

### CAN 통신 — 충전모드 (`mode`)

PPT 슬라이드 12에 정의된 3가지 + 빈 슬롯 상태입니다.

| 보낼 값 | 화면 표시 | 배지 색 |
|---|---|---|
| `IDLE` | OFF(대기) | 회색 |
| `CHARGING` | 충전중 | 파랑 |
| `DONE` | 충전완료 | 초록 |
| `EMPTY` | 미연결 | 어두운 회색 |

CAN 원본 코드값(0x00, 0x01 …)을 쓰신다면 파이썬 쪽에서 위 문자열로 변환해 주세요.
그쪽 코드 체계를 알려주시면 프론트 매핑 테이블을 맞추는 것도 가능합니다.

### CAN 통신 — 충전상태 표시 형식

화면에 찍히는 자릿수입니다. 서버는 숫자로만 보내면 되고 반올림은 프론트가 합니다.

| 항목 | 형식 | 예 |
|---|---|---|
| 충전 전압 | XX.X V | 54.2 V |
| 충전 전류 | X.X A | 8.6 A |
| 내부 온도 | XX.X ℃ | 31.5 ℃ |
| 배터리 잔량 | 정수 % | 72 % |

**주의할 점 세 가지**

1. **숫자는 숫자로 보내주세요.** `"54.2"` 같은 문자열이면 소수점 자리 맞추기(`toFixed`)에서 깨집니다.
2. **`mode`는 위 네 값 중 하나로 정규화해서** 보내주세요. CAN 원본 코드값(0x01 등)을 그대로 보내면 프론트에서 다시 매핑해야 합니다. 파이썬 쪽 코드값이 다르면 알려주시면 프론트 매핑 테이블을 맞추겠습니다.
3. **`stations` 배열 순서가 곧 탭 순서**입니다. 좌우 스와이프도 이 순서를 따릅니다.

---

## 3. CAN 통신 — 충전 ON/OFF (4번 버튼)

슬라이드 12의 동작 명세입니다.

- "충전 시작" 클릭 → 충전 **ON**
- ON 되면 버튼이 "충전 중지"로 전환
- "충전 중지" 클릭 → 충전 **OFF** → 다시 "충전 시작"으로 전환

```
POST /api/stations/{station_id}/slots/{slot_no}/charge
Content-Type: application/json

{ "on": true }
```

응답

```json
{ "ok": true, "mode": "CHARGING" }
```

실패 시 — 프론트가 화면을 이전 상태로 되돌립니다.

```json
{ "ok": false, "reason": "NO_BATTERY" }
```

**프론트 쪽 처리** — 버튼을 누르면 CAN 왕복을 기다리지 않고 즉시 표시가 바뀝니다.
응답이 `ok: false`면 서버 상태를 다시 읽어 되돌립니다.
요청이 진행 중인 동안 같은 슬롯의 버튼은 잠기므로, 연타로 ON/OFF가 꼬일 일은 없습니다.

---

## 4. CORS

키오스크 브라우저에서 직접 호출하므로 파이썬 서버에 CORS 허용이 필요합니다.
FastAPI 기준:

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],        # 운영 시엔 키오스크 주소로 좁히기
    allow_methods=["*"],
    allow_headers=["*"],
)
```

웹소켓은 CORS 대상이 아니라 이 설정이 필요 없습니다.

---

## 5. 확인 방법

키오스크 화면에서 `Ctrl+Shift+L`을 누르면 로그 패널이 열립니다.
어떤 호출이 언제 나갔고 무엇이 돌아왔는지 그대로 보이니, 연동 확인할 때 이걸 보시면 됩니다.
