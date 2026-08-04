import { useState, useEffect, useRef, useCallback } from "react";
import { getWeather, WEATHER_PROVIDER } from "./weatherApi";
import juwonLogo from "./assets/juwon-logo-wh.png";
import "./kiosk.css";

/* ============================================================================
   5(충전) — 스테이션 충전 대시보드
   ----------------------------------------------------------------------------
   ★ 보이는 것(색·크기·간격)은 전부 kiosk.css 에 있습니다.
     이 파일은 구조와 동작만 다룹니다. 디자인 수정은 CSS 쪽에서 하세요.

   PPT 슬라이드 11~12 기준. 버튼 번호는 PPT 주석 번호와 동일.
     1번 : 좌/우 스테이션 전환
     2번 : 하단 탭 (1번과 동일 기능)
     3번 : 메인으로 → 1(초기화면)
     4번 : 슬롯별 충전 시작/중지 (CAN ON/OFF)
     5번 : 상세 보기
   ========================================================================== */

const STEPS = ["시작", "인증", "반납", "검사", "충전", "결제", "수령"];
const CURRENT_STEP = 5;

/* CAN 통신 — 충전모드 (PPT 슬라이드 12) */
const MODE_LABEL = {
  IDLE: "OFF(대기)",
  CHARGING: "충전중",
  DONE: "충전완료",
  EMPTY: "미연결",
};

const SKY = {
  CLEAR:    { icon: "☀️", text: "맑음" },
  CLOUDY:   { icon: "⛅", text: "구름많음" },
  OVERCAST: { icon: "☁️", text: "흐림" },
  RAIN:     { icon: "🌧️", text: "비" },
  SNOW:     { icon: "🌨️", text: "눈" },
  SHOWER:   { icon: "🌦️", text: "소나기" },
};

/* ============================================================================
   API 레이어
   ----------------------------------------------------------------------------
   TRANSPORT 로 통신 방식을 고릅니다.
     'mock' : 서버 없이 화면 확인
     'http' : 파이썬 서버에 폴링
     'ws'   : 웹소켓 구독 — CAN 프레임이 올 때마다 즉시 갱신 (권장)

   스테이션·슬롯 개수는 코드에 박혀 있지 않습니다.
   서버가 내려주는 stations 배열을 그대로 그립니다.
   ========================================================================== */
const TRANSPORT = "mock";
const API_BASE = "http://localhost:8000";
const WS_URL = "ws://localhost:8000/ws/stations";
const POLL_MS = 1000;
const WEATHER_POLL_MS = 10 * 60 * 1000;

const initialData = {
  stations: [
    { id: "MASTER", name: "MASTER", slots: [
      { no: 1, present: true,  mode: "CHARGING", soc: 72,  volt: 54.2, curr: 8.6, temp: 31.5 },
      { no: 2, present: true,  mode: "DONE",     soc: 100, volt: 54.6, curr: 0.0, temp: 28.0 },
    ]},
    { id: "STATION1", name: "STATION 1", slots: [
      { no: 1, present: true,  mode: "CHARGING", soc: 45, volt: 51.2, curr: 8.1, temp: 29.8 },
      { no: 2, present: false, mode: "EMPTY",    soc: 0,  volt: 0.0,  curr: 0.0, temp: 0.0  },
    ]},
    { id: "STATION2", name: "STATION 2", slots: [
      { no: 1, present: true,  mode: "IDLE", soc: 88,  volt: 53.4, curr: 0.0, temp: 27.1 },
      { no: 2, present: true,  mode: "DONE", soc: 100, volt: 54.5, curr: 0.0, temp: 26.6 },
    ]},
    { id: "STATION3", name: "STATION 3", slots: [
      { no: 1, present: false, mode: "EMPTY",    soc: 0,  volt: 0.0,  curr: 0.0, temp: 0.0  },
      { no: 2, present: true,  mode: "CHARGING", soc: 33, volt: 50.3, curr: 8.8, temp: 32.4 },
    ]},
  ],
};

/* MOCK: CAN 값 변동 흉내 — 실연동 시 이 객체만 삭제 */
const mockStore = { data: structuredClone(initialData) };
const mock = {
  getStations() {
    const now = Date.now();
    mockStore.data.stations.forEach((s) =>
      s.slots.forEach((sl) => {
        /* 충전 진행 */
        if (sl.mode === "CHARGING") {
          sl.soc = Math.min(100, +(sl.soc + 0.4).toFixed(1));
          sl.volt = +(48 + sl.soc * 0.07 + (Math.random() - 0.5) * 0.2).toFixed(1);
          sl.curr = +(8.6 + (Math.random() - 0.5) * 0.6).toFixed(1);
          sl.temp = +(30 + Math.random() * 2).toFixed(1);
          if (sl.soc >= 100) { sl.mode = "DONE"; sl.curr = 0.0; sl._t = now; }
          return;
        }

        /* [MOCK 전용] 완충 12초 뒤 사용자가 배터리를 수령한 것으로 봅니다.
           그 6초 뒤 방전된 배터리가 들어와 다시 대기 상태가 됩니다.
           이게 없으면 모든 슬롯이 100%로 굳어 데모에서 아무것도 눌리지 않습니다.
           실서버에서는 CAN 이 읽어온 실제 상태가 오므로 이 블록은 필요 없습니다. */
        if (sl.mode === "DONE" && now - (sl._t ?? now) > 12000) {
          Object.assign(sl, { mode: "EMPTY", present: false, soc: 0, volt: 0, curr: 0, temp: 0, _t: now });
          return;
        }
        if (sl.mode === "EMPTY" && now - (sl._t ?? now) > 6000) {
          Object.assign(sl, {
            mode: "IDLE", present: true, _t: now,
            soc: +(12 + Math.random() * 25).toFixed(1),
            volt: +(47 + Math.random() * 2).toFixed(1),
            curr: 0.0,
            temp: +(24 + Math.random() * 3).toFixed(1),
          });
        }
      })
    );
    return structuredClone(mockStore.data);
  },

  setCharge(sid, slot, on) {
    const st = mockStore.data.stations.find((x) => x.id === sid);
    const sl = st?.slots.find((x) => x.no === slot);
    if (!sl?.present) return { ok: false, reason: "NO_BATTERY" };
    if (on && sl.soc >= 100) return { ok: false, reason: "ALREADY_FULL" };
    sl.mode = on ? "CHARGING" : "IDLE";
    if (!on) sl.curr = 0.0;
    return { ok: true, mode: sl.mode };
  },
};

function makeApi(log) {
  return {
    /* GET /api/stations → 스테이션·슬롯 CAN 상태 */
    async getStations() {
      if (TRANSPORT === "mock") {
        const r = mock.getStations();
        log("GET", "/api/stations", null, r);
        return r;
      }
      const r = await fetch(`${API_BASE}/api/stations`).then((x) => x.json());
      log("GET", "/api/stations", null, r);
      return r;
    },

    /* POST /api/stations/:sid/slots/:no/charge { on } → CAN 충전 ON/OFF */
    async setCharge(sid, no, on) {
      const path = `/api/stations/${sid}/slots/${no}/charge`;
      if (TRANSPORT === "mock") {
        const r = mock.setCharge(sid, no, on);
        log("POST", path, { on }, r);
        return r;
      }
      const r = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on }),
      }).then((x) => x.json());
      log("POST", path, { on }, r);
      return r;
    },

    /* 상태 구독. onData(stations) 를 호출하고 해제 함수를 돌려줍니다. */
    subscribe(onData) {
      if (TRANSPORT === "ws") {
        let closed = false;
        let ws;
        let retry;
        const connect = () => {
          ws = new WebSocket(WS_URL);
          ws.onopen = () => log("WS", "open", null, { url: WS_URL });
          ws.onmessage = (ev) => {
            try {
              const d = JSON.parse(ev.data);
              if (d?.stations) onData(d.stations);
            } catch (e) {
              log("WS", "parse-error", null, { error: String(e.message ?? e) });
            }
          };
          ws.onclose = () => {
            if (closed) return;
            log("WS", "closed — 3초 후 재연결", null, {});
            retry = setTimeout(connect, 3000);
          };
          ws.onerror = () => ws.close();
        };
        connect();
        return () => { closed = true; clearTimeout(retry); ws?.close(); };
      }

      let alive = true;
      const tick = async () => {
        try {
          const d = await this.getStations();
          if (alive && d?.stations) onData(d.stations);
        } catch (e) {
          if (alive) log("GET", "/api/stations", null, { error: String(e.message ?? e) });
        }
      };
      tick();
      const t = setInterval(tick, POLL_MS);
      return () => { alive = false; clearInterval(t); };
    },
  };
}

/* ============================================================================
   아이콘 — 원본 화면과 동일한 모양 (외부 패키지 불필요)
   크기와 색은 CSS 가 정합니다 (width/height 100%, currentColor)
   ========================================================================== */
const Svg = ({ children, filled }) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"
    fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"}
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);

const Ico = {
  /* 전압 — 온도계 아웃라인 */
  volt: <Svg><path d="M12 3a2.4 2.4 0 0 1 2.4 2.4v8.1a4.4 4.4 0 1 1-4.8 0V5.4A2.4 2.4 0 0 1 12 3z" /></Svg>,
  /* 전류 — 아치형 게이지 + 상향 바늘 */
  curr: <Svg><path d="M5 19a7 7 0 1 1 14 0" /><path d="M12 19v-8" /><path d="m9.6 13.2 2.4-2.4 2.4 2.4" /></Svg>,
  /* 온도 — 온도계 (구부 채움) */
  temp: <Svg>
    <path d="M12 3a2.4 2.4 0 0 1 2.4 2.4v8.1a4.4 4.4 0 1 1-4.8 0V5.4A2.4 2.4 0 0 1 12 3z" />
    <path d="M12 8.5v6.5" strokeWidth="2.6" />
    <circle cx="12" cy="17.4" r="2.2" fill="currentColor" stroke="none" />
  </Svg>,
  /* 운영 슬롯 — 클립보드 목록 */
  slots: <Svg>
    <rect x="4.5" y="4" width="14" height="17" rx="2.5" /><rect x="8.5" y="2" width="6" height="4" rx="1.4" />
    <path d="M8.5 10.5h6M8.5 14h6M8.5 17.5h3.5" />
  </Svg>,
  /* 충전중 — 세로 배터리 + 번개 */
  bolt: <Svg>
    <rect x="7" y="5" width="10" height="16" rx="2.5" /><path d="M10 3h4" /><path d="M12.6 8.6 10 13h4l-2.6 4.4" />
  </Svg>,
  /* 완료 — 원형 체크 */
  check: <Svg><circle cx="12" cy="12" r="8.6" /><path d="m8.2 12 2.8 2.8 5-5.6" /></Svg>,
  /* 알람 — 종 */
  bell: <Svg>
    <path d="M18 9.5a6 6 0 1 0-12 0c0 5.5-2.2 7.5-2.2 7.5h16.4S18 15 18 9.5" />
    <path d="M13.6 20a1.9 1.9 0 0 1-3.2 0" />
  </Svg>,
  /* 스와이프 안내 — 손 위에 좌우 화살표 */
  swipe: (
    <svg viewBox="0 0 34 30" width="1em" height="1em" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {/* 좌우 화살표 */}
      <path d="M6 5h22" />
      <path d="m9 2-3 3 3 3" />
      <path d="m25 2 3 3-3 3" />
      {/* 손 */}
      <g transform="translate(6.5 8.5) scale(0.88)">
        <path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v7M10 10.5V6a2 2 0 0 0-4 0v8" />
        <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2a8 8 0 0 1-8-8v-1a2 2 0 1 1 4 0" />
      </g>
    </svg>
  ),
  /* 메인으로 — 집 */
  home: <Svg><path d="M4 10.8 12 4l8 6.8V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" /></Svg>,
  /* 상세 보기 — 클립보드 */
  detail: <Svg>
    <rect x="5.5" y="4" width="13" height="17" rx="2.5" /><rect x="9" y="2" width="6" height="4" rx="1.4" />
    <path d="M9 10.5h6M9 14h6M9 17.5h6" />
  </Svg>,
  /* 네트워크 — 와이파이 */
  wifi: <Svg>
    <path d="M2.6 9.2a14 14 0 0 1 18.8 0" strokeWidth="2.4" />
    <path d="M6.2 13.1a9 9 0 0 1 11.6 0" strokeWidth="2.4" />
    <path d="M9.7 16.9a4 4 0 0 1 4.6 0" strokeWidth="2.4" />
    <circle cx="12" cy="20" r="1.1" fill="currentColor" stroke="none" />
  </Svg>,
  /* CAN 통신 — 계층형 노드 */
  can: <Svg>
    <rect x="9.2" y="2.5" width="5.6" height="4.6" rx="1.2" />
    <rect x="2" y="16.9" width="5.2" height="4.6" rx="1.2" />
    <rect x="9.4" y="16.9" width="5.2" height="4.6" rx="1.2" />
    <rect x="16.8" y="16.9" width="5.2" height="4.6" rx="1.2" />
    <path d="M12 7.1v4.6M4.6 16.9v-5.2h14.8v5.2M12 11.7v5.2" />
  </Svg>,
  /* 배터리 내부 — 충전중 번개 / 완료 체크 */
  boltFill: <Svg filled><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></Svg>,
  checkBig: <Svg><circle cx="12" cy="12" r="9" fill="rgba(0,0,0,.25)" /><path d="m8 12 3 3 5-6" /></Svg>,
  /* 충전 버튼 */
  boltSmall: <Svg filled><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></Svg>,
  pause: <Svg filled><rect x="7" y="4" width="3.5" height="16" rx="1" /><rect x="13.5" y="4" width="3.5" height="16" rx="1" /></Svg>,
};

/* 사이드 패널의 미니 스테이션 — 실물 형태 + 슬롯별 충전 상태 표시 */
const StationGlyph = ({ slots = [] }) => (
  <svg className="sg" viewBox="0 0 62 74" aria-hidden="true">
    <path className="sg__top" d="M9 12 14 5.5h34L53 12Z" />
    <rect className="sg__body" x="9" y="12" width="44" height="56" rx="4" />
    <rect className="sg__label" x="14" y="15.5" width="34" height="5" rx="2" />
    <rect className="sg__bay" x="13.5" y="25" width="15" height="35" rx="3" />
    <rect className="sg__bay" x="33.5" y="25" width="15" height="35" rx="3" />
    {[18.5, 38.5].map((x, i) => (
      <g className="sg__batt" data-mode={slots[i]?.mode ?? "EMPTY"} key={x}>
        <rect x={x} y="31" width="5" height="21.5" rx="1.6" />
        <rect x={x + 1.3} y="28.8" width="2.4" height="2.8" rx=".8" />
      </g>
    ))}
  </svg>
);

/* ============================================================================
   작은 컴포넌트들
   ========================================================================== */

const Marker = ({ n, style }) => <span className="marker" style={style}>{n}</span>;

function StepBar() {
  return (
    <nav className="steps" aria-label="진행 단계">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n === CURRENT_STEP ? "on" : n < CURRENT_STEP ? "done" : "todo";
        return (
          <div key={label} style={{ display: "contents" }}>
            {i > 0 && <span className="step__bar" data-done={n <= CURRENT_STEP} />}
            <div className="step" data-state={state}>
              <span className="step__num">{state === "done" ? "✓" : n}</span>
              <span className="step__label">{label}</span>
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function SlotCard({ slot, onToggle, showMarkers, busy }) {
  const charging = slot.mode === "CHARGING";
  const full = slot.mode === "DONE";
  /* 완충(100%) 상태에서는 충전 시작을 잠급니다. 과충전 방지.
     배터리를 빼고 방전된 것을 넣으면 잔량이 내려가면서 다시 눌립니다. */
  const disabled = !slot.present || full || busy;

  /* CAN 통신 — 충전상태 : 충전 전압 XX.X V / 충전 전류 X.X A / 내부 온도 XX.X ℃ */
  const rows = [
    ["전압", Ico.volt, slot.volt.toFixed(1), "V"],
    ["전류", Ico.curr, slot.curr.toFixed(1), "A"],
    ["온도", Ico.temp, slot.temp.toFixed(1), "℃"],
  ];

  return (
    <article className="slot" data-mode={slot.mode}>
      <header className="slot__head">
        <h3 className="slot__name">SLOT {slot.no}</h3>
        <span className="badge">{MODE_LABEL[slot.mode] ?? MODE_LABEL.IDLE}</span>
      </header>

      <div className="slot__mid">
        <div className="batt">
          <span className="batt__cap" />
          <div className="batt__body">
            <div className="batt__fill" style={{ height: `${slot.soc}%` }} />
            <span className="batt__gloss" />
            <div className="batt__icon">
              {charging && <span className="batt__glyph pulse">{Ico.boltFill}</span>}
              {full && <span className="batt__glyph">{Ico.checkBig}</span>}
            </div>
            <div className="batt__pct">
              {Math.round(slot.soc)}<span>%</span>
            </div>
          </div>
        </div>

        <dl className="can">
          {rows.map(([key, icon, val, unit]) => (
            <div className="can__row" key={key}>
              <dt className="can__key">{icon}{key}</dt>
              <dd className="can__val">{val}<span className="can__unit">{unit}</span></dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="progress">
        <div className="progress__track">
          <div className="progress__fill" style={{ width: `${slot.soc}%` }} />
        </div>
        <span className="progress__pct">{Math.round(slot.soc)}%</span>
      </div>

      {/* 4번 — 슬롯별 충전 시작/중지 */}
      <div className="slot__action">
        {showMarkers && <Marker n={4} style={{ top: "-6px", right: "12%" }} />}
        <button
          className="kbtn chargebtn"
          data-state={charging ? "stop" : "start"}
          onClick={() => onToggle(slot.no, !charging)}
          disabled={disabled}
        >
          {charging ? Ico.pause : Ico.boltSmall}
          {charging ? "충전 중지" : "충전 시작"}
        </button>
      </div>
    </article>
  );
}

function WeatherBadge({ weather, stale }) {
  if (!weather) return <div className="weather__loading">날씨 불러오는 중…</div>;
  const s = SKY[weather.sky] ?? SKY.CLEAR;
  return (
    <div className={`weather${stale ? " weather--stale" : ""}`}>
      <span className="weather__ico">{s.icon}</span>
      <div className="weather__now">
        <div className="weather__sky">{stale ? "갱신 실패" : s.text}</div>
        <div className="weather__temp">{weather.temp.toFixed(0)}°C</div>
      </div>
      <div className="weather__mm">
        최고 <b className="weather__hi">{weather.high}°</b><br />
        최저 <b className="weather__lo">{weather.low}°</b>
      </div>
    </div>
  );
}

const Summary = ({ icon, label, value, tone }) => (
  <div className="sum" style={{ "--tone": tone }}>
    {icon}
    <div>
      <div className="sum__k">{label}</div>
      <div className="sum__v">{value}</div>
    </div>
  </div>
);

/* ============================================================================
   메인
   ========================================================================== */
export default function ChargeDashboard({ onGoDetail, onGoMain }) {
  const [stations, setStations] = useState(initialData.stations);
  const [idx, setIdx] = useState(0);
  const [pending, setPending] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logOpen, setLogOpen] = useState(false);
  const [showMarkers, setShowMarkers] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [weather, setWeather] = useState(null);
  const [weatherStale, setWeatherStale] = useState(false);
  const stripRef = useRef(null);
  const dragX = useRef(null);

  const log = useCallback((method, path, payload, res) => {
    setLogs((prev) => [{
      id: `${Date.now()}-${Math.random()}`,
      method, path,
      payload: payload ? JSON.stringify(payload) : null,
      res: JSON.stringify(res).slice(0, 200),
      at: new Date().toLocaleTimeString("ko-KR", { hour12: false }),
    }, ...prev].slice(0, 60));
  }, []);

  const [api] = useState(() => makeApi(log));

  /* CAN 상태 구독 (ws면 push, 아니면 폴링) */
  useEffect(() => api.subscribe(setStations), [api]);

  /* 시계 */
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /* 날씨 — 프론트에서 외부 API 직접 호출 (10분 주기) */
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const t0 = performance.now();
      try {
        const d = await getWeather();
        if (!alive) return;
        setWeather(d);
        setWeatherStale(false);
        log("GET", `weather(${WEATHER_PROVIDER}) ${Math.round(performance.now() - t0)}ms`, null, d);
      } catch (e) {
        if (!alive) return;
        setWeatherStale(true);
        log("GET", `weather(${WEATHER_PROVIDER})`, null, { error: String(e.message ?? e) });
      }
    };
    tick();
    const t = setInterval(tick, WEATHER_POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [log]);

  const station = stations[idx] ?? stations[0];
  const move = useCallback(
    (d) => setIdx((i) => (i + d + stations.length) % stations.length),
    [stations.length]
  );

  /* 방향키로 스테이션 이동 + 검토용 단축키
     Ctrl+Shift+L : API 로그 / Ctrl+Shift+M : 버튼 번호 */
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === "l") { e.preventDefault(); setLogOpen((v) => !v); }
        if (k === "m") { e.preventDefault(); setShowMarkers((v) => !v); }
        return;
      }
      if (e.key === "ArrowLeft") move(-1);
      if (e.key === "ArrowRight") move(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move]);

  /* 사이드 스트립에서 현재 스테이션이 항상 보이도록 자동 스크롤 */
  useEffect(() => {
    const el = stripRef.current?.querySelector('[aria-current="true"]');
    el?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [idx]);

  /* 좌우 스와이프 (터치·마우스 공통) */
  const onPointerDown = (e) => { dragX.current = e.clientX; };
  const onPointerUp = (e) => {
    if (dragX.current === null) return;
    const dx = e.clientX - dragX.current;
    dragX.current = null;
    if (Math.abs(dx) > 60) move(dx < 0 ? 1 : -1);
  };

  /* 4번 버튼 — CAN 충전 ON/OFF.
     왕복 지연 중 연타로 ON/OFF가 꼬이지 않게 요청 중에는 잠급니다. */
  const handleToggle = async (slotNo, on) => {
    if (pending) return;
    setPending(`${station.id}:${slotNo}`);

    /* 낙관적 반영 — 버튼이 즉시 바뀝니다.
       실제 잔량은 곧 도착하는 CAN 값으로 덮어써집니다. */
    setStations((prev) => prev.map((s) =>
      s.id !== station.id ? s : {
        ...s,
        slots: s.slots.map((sl) =>
          sl.no !== slotNo ? sl : { ...sl, mode: on ? "CHARGING" : "IDLE", curr: on ? sl.curr : 0 }
        ),
      }
    ));

    try {
      const r = await api.setCharge(station.id, slotNo, on);
      if (r?.ok === false) {
        const d = await api.getStations();
        if (d?.stations) setStations(d.stations);
      }
    } finally {
      setPending(null);
    }
  };

  const present  = station.slots.filter((s) => s.present).length;
  const charging = station.slots.filter((s) => s.mode === "CHARGING").length;
  const done     = station.slots.filter((s) => s.mode === "DONE").length;

  const w = "일월화수목금토"[clock.getDay()];
  const hh = clock.getHours();
  const time = `${((hh + 11) % 12) + 1}:${String(clock.getMinutes()).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;

  return (
    <div className="kiosk">
      <div className="kiosk__glow" />

      {/* ── 헤더 ── */}
      <header className="hdr">
        <img className="hdr__logo" src={juwonLogo} alt="JUWON 주원" />
        <div className="hdr__center">
          <div className="hdr__title">전기이륜차 공유배터리 스테이션</div>
          <div className="hdr__sub">현재 화면: {station.name}</div>
        </div>
        <WeatherBadge weather={weather} stale={weatherStale} />
        <div className="hdr__clock">
          <div className="hdr__date">
            {clock.getFullYear()}. {clock.getMonth() + 1}. {clock.getDate()} ({w})
          </div>
          <div className="hdr__time">{time}</div>
        </div>
        <div className="hdr__status">
          <span className="pill">{Ico.wifi}<span className="pill__text">네트워크 정상</span></span>
          <span className="pill">{Ico.can}<span className="pill__text">CAN 통신 정상</span></span>
        </div>
      </header>

      <StepBar />

      {/* ── 본문 ── */}
      <div className="kiosk__body" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
        {/* 1번 — 이전 스테이션 */}
        <button className="arrow" onClick={() => move(-1)} aria-label="이전 스테이션">
          {showMarkers && <Marker n={1} style={{ bottom: 0, left: "-6px" }} />}‹
        </button>

        <section className="dash">
          <h2 className="dash__title">{station.name}</h2>

          <div className="slots">
            {station.slots.map((s) => (
              <SlotCard
                key={s.no}
                slot={s}
                onToggle={handleToggle}
                showMarkers={showMarkers}
                busy={pending === `${station.id}:${s.no}`}
              />
            ))}
          </div>

          <div className="summary">
            <Summary icon={Ico.slots} label="운영 슬롯" value={`${present} / ${station.slots.length}`} tone="var(--cyan)" />
            <Summary icon={Ico.bolt}  label="충전중"    value={charging} tone="var(--cyan)" />
            <Summary icon={Ico.check} label="완료"      value={done}     tone="var(--green)" />
            <Summary icon={Ico.bell}  label="알람"      value={0}        tone="var(--red)" />
          </div>
        </section>

        {/* 1번 — 다음 스테이션 */}
        <button className="arrow" onClick={() => move(1)} aria-label="다음 스테이션">
          {showMarkers && <Marker n={1} style={{ bottom: 0, right: "-6px" }} />}›
        </button>

        {/* ── 사이드 패널 ── */}
        <aside className="side">
          <div className="side__card">
            <h3 className="side__title">2구 스테이션 단위<br />확장형 UI</h3>
            <p className="side__desc">
              각 스테이션은 2개의<br />충전 슬롯을 가지며,<br />모듈 단위로 확장됩니다.
            </p>

            <div className="side__strip" ref={stripRef}>
              {stations.map((s, i) => (
                <button
                  key={s.id}
                  className="kbtn ministation"
                  aria-current={i === idx}
                  onClick={() => setIdx(i)}
                  title={`${s.name} 보기`}
                >
                  <span className="ministation__box"><StationGlyph slots={s.slots} /></span>
                  <span className="ministation__name">{s.name}</span>
                </button>
              ))}
            </div>

            <div className="side__hint">
              {Ico.swipe}
              <div>
                좌우로 밀어<br />다른 스테이션 보기
                <div className="side__count">{idx + 1} / {stations.length}</div>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* ── 2번 — 탭 ── */}
      <div className="tabs" role="tablist">
        {showMarkers && <Marker n={2} style={{ top: "8px", right: "40px" }} />}
        {stations.map((s, i) => (
          <button
            key={s.id}
            className="kbtn tab"
            role="tab"
            aria-selected={i === idx}
            onClick={() => setIdx(i)}
          >{s.name}</button>
        ))}
        {/* 확장 자리 — 서버가 스테이션을 추가하면 실제 탭이 늘어납니다 */}
        <button className="kbtn tab tab--add" disabled aria-hidden="true">+</button>
      </div>

      {/* ── 하단 액션 (5번 / 3번) ── */}
      <div className="actions">
        <div>
          {showMarkers && <Marker n={5} style={{ bottom: "-8px", left: "-12px" }} />}
          <button className="kbtn btn btn--primary" onClick={onGoDetail}>
            <span className="btn__label">{Ico.detail} 상세 보기</span>
            <span className="btn__chev">›</span>
          </button>
        </div>
        <div>
          {showMarkers && <Marker n={3} style={{ bottom: "-8px", right: "-12px" }} />}
          <button className="kbtn btn btn--ghost" onClick={onGoMain}>
            <span className="btn__label">{Ico.home} 메인으로</span>
            <span className="btn__chev">›</span>
          </button>
        </div>
      </div>

      {/* ── API 로그 (검토용, Ctrl+Shift+L) ── */}
      {logOpen && (
        <div className="log">
          {logs.length === 0 && <div className="log__empty">호출 대기 중…</div>}
          {logs.map((l) => (
            <div className="log__row" key={l.id}>
              <span className="log__at">{l.at}</span>{" "}
              <b className="log__method">{l.method}</b> {l.path}
              {l.payload && <div>&nbsp;&nbsp;→ {l.payload}</div>}
              <div className="log__res">&nbsp;&nbsp;← {l.res}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
