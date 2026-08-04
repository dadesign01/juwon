import { useState, useEffect, useRef, useCallback } from "react";
import { getWeather, WEATHER_PROVIDER } from "./weatherApi";

/* ============================================================================
   5(충전) — 스테이션 충전 대시보드
   ----------------------------------------------------------------------------
   PPT 슬라이드 11~12 기준. 버튼 번호는 PPT 주석 번호와 동일.
     1번 : 좌/우 스테이션 전환
     2번 : 하단 탭 (1번과 동일 기능)
     3번 : 메인으로 → 1(초기화면)
     4번 : 슬롯별 충전 시작/중지 (CAN ON/OFF)
     5번 : 결제하기 → 6-1(결제-선택)
   ========================================================================== */

/* ★ 키오스크 실제 해상도 — 기기에 맞춰 이 값만 바꾸면 전체가 따라갑니다.
      내부는 이 크기로 그린 뒤 화면 크기에 맞춰 통째로 축소됩니다.       */
const KIOSK = { w: 1920, h: 1080 };

/* ── 색상 토큰 ─────────────────────────────────────────────────────────── */
const C = {
  bg: "#03070f", panel: "#0a1524", line: "#1b3358", line2: "#2a4f80",
  cyan: "#37a9ff", cyanDim: "#1c6fb8", glow: "rgba(55,169,255,.35)",
  green: "#2fd67f", amber: "#ffb020", red: "#ff5b5b",
  text: "#e9f2ff", muted: "#7e9cc4", muted2: "#55749b",
};

const STEPS = ["시작", "인증", "반납", "검사", "충전", "결제", "수령"];
const CURRENT_STEP = 5;

const MODE = {
  IDLE:     { label: "OFF (대기)",  color: C.muted,  border: C.line2 },
  CHARGING: { label: "충전중",      color: C.cyan,   border: C.cyan  },
  DONE:     { label: "충전완료",    color: C.green,  border: C.green },
  EMPTY:    { label: "배터리 없음", color: C.muted2, border: C.line  },
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
   API 레이어 — 실서버 붙일 때 USE_MOCK=false 로 바꾸고 fetch 부분만 채우기
   ========================================================================== */
const USE_MOCK = true;
const API_BASE = "http://localhost:8000";
const POLL_MS = 1000;
const WEATHER_POLL_MS = 10 * 60 * 1000;

const initialData = {
  stations: [
    { id: "MASTER", name: "MASTER", slots: [
      { no: 1, present: true,  mode: "CHARGING", soc: 72,  volt: 54.2, curr: 8.6, temp: 31.5 },
      { no: 2, present: true,  mode: "DONE",     soc: 100, volt: 54.6, curr: 0.0, temp: 28.0 },
    ]},
    { id: "STATION1", name: "STATION 1", slots: [
      { no: 1, present: true,  mode: "IDLE",  soc: 45, volt: 50.1, curr: 0.0, temp: 26.4 },
      { no: 2, present: false, mode: "EMPTY", soc: 0,  volt: 0.0,  curr: 0.0, temp: 0.0  },
    ]},
  ],
};

/* MOCK: CAN 값 변동 흉내 — 실연동 시 이 객체만 삭제 */
const mockStore = { data: structuredClone(initialData) };
const mock = {
  getStations() {
    mockStore.data.stations.forEach((s) =>
      s.slots.forEach((sl) => {
        if (sl.mode !== "CHARGING") return;
        sl.soc = Math.min(100, +(sl.soc + 0.4).toFixed(1));
        sl.volt = +(48 + sl.soc * 0.07 + (Math.random() - 0.5) * 0.2).toFixed(1);
        sl.curr = +(8.6 + (Math.random() - 0.5) * 0.6).toFixed(1);
        sl.temp = +(30 + Math.random() * 2).toFixed(1);
        if (sl.soc >= 100) { sl.mode = "DONE"; sl.curr = 0.0; }
      })
    );
    return structuredClone(mockStore.data);
  },
  setCharge(sid, slot, on) {
    const st = mockStore.data.stations.find((x) => x.id === sid);
    const sl = st?.slots.find((x) => x.no === slot);
    if (!sl?.present) return { ok: false, reason: "NO_BATTERY" };
    sl.mode = on ? "CHARGING" : "IDLE";
    if (!on) sl.curr = 0.0;
    return { ok: true, mode: sl.mode };
  },
};

function makeApi(log) {
  return {
    /* GET /api/stations → 스테이션·슬롯 CAN 상태 */
    async getStations() {
      if (USE_MOCK) {
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
      if (USE_MOCK) {
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
  };
}

/* ============================================================================
   인라인 아이콘 (외부 패키지 불필요)
   ========================================================================== */
const Ico = {
  volt: (c, s = 18) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
    </svg>
  ),
  curr: (c, s = 18) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="13" r="8" /><path d="M12 13V9M9 2h6" />
    </svg>
  ),
  temp: (c, s = 18) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 14.76V4a2 2 0 1 0-4 0v10.76a4 4 0 1 0 4 0z" />
    </svg>
  ),
  slots: (c, s = 26) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h4" />
    </svg>
  ),
  bolt: (c, s = 26) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 2h6" /><path d="M13 9l-3 4h4l-3 4" />
    </svg>
  ),
  check: (c, s = 26) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" />
    </svg>
  ),
  bell: (c, s = 26) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  ),
  hand: (c, s = 32) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v7M10 10.5V6a2 2 0 0 0-4 0v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2a8 8 0 0 1-8-8v-1a2 2 0 1 1 4 0" />
    </svg>
  ),
  home: (c, s = 22) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 21v-7h6v7" />
    </svg>
  ),
};

/* ============================================================================
   작은 컴포넌트들
   ========================================================================== */

function Marker({ n, style }) {
  return (
    <div style={{
      position: "absolute", zIndex: 20, width: 28, height: 28, borderRadius: "50%",
      background: "#ffd400", color: "#000", fontSize: 16, fontWeight: 900,
      display: "flex", alignItems: "center", justifyContent: "center",
      border: "2px solid #b38f00", ...style,
    }}>{n}</div>
  );
}

function StepBar() {
  return (
    <div style={{
      flex: "0 0 100px", display: "flex", alignItems: "center",
      justifyContent: "center", padding: "0 60px", zIndex: 2,
    }}>
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < CURRENT_STEP;
        const on = n === CURRENT_STEP;
        return (
          <div key={label} style={{ display: "contents" }}>
            {i > 0 && (
              <div style={{
                height: 3, flex: 1, minWidth: 20, marginBottom: 26,
                background: n <= CURRENT_STEP ? C.cyanDim : C.line,
                boxShadow: n <= CURRENT_STEP ? `0 0 8px ${C.cyan}66` : "none",
              }} />
            )}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, width: 96 }}>
              <div style={{
                width: 44, height: 44, borderRadius: "50%", display: "flex",
                alignItems: "center", justifyContent: "center", fontSize: 19, fontWeight: 700,
                border: `2.5px solid ${on ? C.cyan : done ? C.cyanDim : C.line2}`,
                color: on ? "#fff" : done ? C.cyan : C.muted2,
                background: on ? C.cyan : done ? "rgba(55,169,255,.08)" : C.panel,
                boxShadow: on ? `0 0 20px ${C.cyan}` : "none",
              }}>{done ? "✓" : n}</div>
              <div style={{
                fontSize: 15, fontWeight: on ? 700 : 400,
                color: on ? C.cyan : done ? C.cyanDim : C.muted2,
              }}>{label}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Battery({ soc, mode }) {
  const full = mode === "DONE";
  const charging = mode === "CHARGING";
  const empty = mode === "EMPTY";
  const on = full ? C.green : C.cyan;

  return (
    <div style={{ flex: "0 0 118px", position: "relative" }}>
      <div style={{
        width: 42, height: 10, margin: "0 auto",
        background: empty ? C.line2 : on, borderRadius: "5px 5px 0 0",
        boxShadow: empty ? "none" : `0 0 14px ${on}`,
      }} />
      <div style={{
        height: 160, position: "relative", borderRadius: 16, overflow: "hidden",
        background: "linear-gradient(180deg,#0a1830,#040b16)",
        border: `3px solid ${empty ? C.line2 : on}`,
        boxShadow: empty ? "none" : `0 0 26px ${on}44, inset 0 0 24px ${on}22`,
      }}>
        <div style={{
          position: "absolute", left: 0, right: 0, bottom: 0, height: `${soc}%`,
          background: full
            ? "linear-gradient(180deg,#5cf0a4,#1ba95f)"
            : "linear-gradient(180deg,#6cc4ff,#1a6fc4)",
          boxShadow: `0 0 30px ${on}88`, transition: "height .6s ease",
        }}>
          <div style={{ height: 3, background: "rgba(255,255,255,.55)" }} />
        </div>

        {/* 유리 반사광 */}
        <div style={{
          position: "absolute", top: 10, left: 12, width: 18, bottom: 10, borderRadius: 10,
          background: "linear-gradient(180deg,rgba(255,255,255,.22),rgba(255,255,255,0))",
        }} />

        {/* 상태 아이콘 */}
        <div style={{
          position: "absolute", inset: 0, display: "flex",
          alignItems: "center", justifyContent: "center", paddingBottom: 36,
        }}>
          {charging && (
            <svg width="48" height="48" viewBox="0 0 24 24" fill="rgba(255,255,255,.92)">
              <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
            </svg>
          )}
          {full && (
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
              stroke="rgba(255,255,255,.95)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" fill="rgba(0,0,0,.25)" />
              <path d="m8 12 3 3 5-6" />
            </svg>
          )}
        </div>

        <div style={{
          position: "absolute", left: 0, right: 0, bottom: 9, textAlign: "center",
          fontSize: 34, fontWeight: 900, letterSpacing: -1,
          textShadow: "0 2px 10px rgba(0,0,0,.85)",
        }}>
          {Math.round(soc)}<span style={{ fontSize: 19, fontWeight: 800 }}>%</span>
        </div>
      </div>
    </div>
  );
}

function SlotCard({ slot, onToggle, showMarkers }) {
  const m = MODE[slot.mode] ?? MODE.IDLE;
  const charging = slot.mode === "CHARGING";
  const full = slot.mode === "DONE";
  const disabled = !slot.present || full;
  const accent = full ? C.green : C.cyan;

  const rows = [
    ["volt", "전압", slot.volt.toFixed(1), "V"],
    ["curr", "전류", slot.curr.toFixed(1), "A"],
    ["temp", "온도", slot.temp.toFixed(1), "℃"],
  ];

  return (
    <div style={{
      border: `2px solid ${C.line2}`, borderRadius: 18, padding: 22,
      background: "linear-gradient(160deg,#0d1b2f,#080f1c)",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,.05), 0 6px 26px rgba(0,0,0,.5)",
      display: "flex", flexDirection: "column", gap: 16, position: "relative",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: 0.5 }}>SLOT {slot.no}</div>
        <div style={{
          fontSize: 16, fontWeight: 700, padding: "8px 20px", borderRadius: 24,
          border: `2px solid ${m.border}`, color: m.color,
          background: charging ? "rgba(55,169,255,.14)" : full ? "rgba(47,214,127,.14)" : "transparent",
          boxShadow: (charging || full) ? `0 0 16px ${m.color}55` : "none",
        }}>{m.label}</div>
      </div>

      <div style={{ display: "flex", gap: 24, flex: 1, alignItems: "center" }}>
        <Battery soc={slot.soc} mode={slot.mode} />
        <div style={{ flex: 1 }}>
          {rows.map(([ico, k, v, unit], i) => (
            <div key={k} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "13px 0", borderBottom: i < 2 ? `1px solid ${C.line}` : "none",
            }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 18, color: C.muted }}>
                {Ico[ico](accent)}{k}
              </span>
              <span style={{ fontSize: 24, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                {v}<span style={{ fontSize: 15, fontWeight: 600, color: C.muted, marginLeft: 4 }}>{unit}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{
          flex: 1, height: 11, borderRadius: 6, background: "#0a1526",
          border: `1px solid ${C.line}`, overflow: "hidden",
        }}>
          <div style={{
            height: "100%", width: `${slot.soc}%`, borderRadius: 6,
            background: full
              ? "linear-gradient(90deg,#1ba95f,#5cf0a4)"
              : "linear-gradient(90deg,#1a6fc4,#6cc4ff)",
            boxShadow: `0 0 14px ${accent}aa`, transition: "width .6s ease",
          }} />
        </div>
        <span style={{ fontSize: 19, fontWeight: 800, color: accent, minWidth: 58, textAlign: "right" }}>
          {Math.round(slot.soc)}%
        </span>
      </div>

      <div style={{ position: "relative" }}>
        {showMarkers && <Marker n={4} style={{ top: -10, right: -10 }} />}
        <button
          onClick={() => onToggle(slot.no, !charging)}
          disabled={disabled}
          style={{
            width: "100%", height: 56, borderRadius: 12, fontSize: 19, fontWeight: 700,
            fontFamily: "inherit", cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.3 : 1,
            border: `2px solid ${charging ? C.amber : C.cyan}`,
            color: charging ? C.amber : C.cyan,
            background: charging ? "rgba(255,176,32,.12)" : "rgba(55,169,255,.12)",
            boxShadow: disabled ? "none" : `0 0 18px ${charging ? C.amber : C.cyan}33`,
          }}
        >{charging ? "⏸  충전 중지" : "⚡  충전 시작"}</button>
      </div>
    </div>
  );
}

/* ============================================================================
   메인
   ========================================================================== */
export default function ChargeDashboard({ onGoMain, onGoPayment }) {
  const [stations, setStations] = useState(initialData.stations);
  const [idx, setIdx] = useState(0);
  const [logs, setLogs] = useState([]);
  const [logOpen, setLogOpen] = useState(false);
  const [showMarkers, setShowMarkers] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [scale, setScale] = useState(1);
  const [weather, setWeather] = useState(null);
  const [weatherStale, setWeatherStale] = useState(false);
  const wrapRef = useRef(null);

  const log = useCallback((method, path, payload, res) => {
    setLogs((prev) => [{
      id: `${Date.now()}-${Math.random()}`,
      method, path,
      payload: payload ? JSON.stringify(payload) : null,
      res: JSON.stringify(res).slice(0, 200),
      at: new Date().toLocaleTimeString("ko-KR", { hour12: false }),
    }, ...prev].slice(0, 60));
  }, []);

  /* ★ useState 초기화 함수는 최초 1회만 실행 — 렌더링 중 ref 수정을 피합니다 */
  const [api] = useState(() => makeApi(log));

  /* CAN 상태 폴링 */
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const d = await api.getStations();
        if (alive) setStations(d.stations);
      } catch (e) {
        if (alive) log("GET", "/api/stations", null, { error: String(e.message ?? e) });
      }
    };
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [api, log]);

  /* 시계 */
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /* 날씨 — 프론트에서 외부 API 직접 호출 (10분 주기).
     실패해도 마지막 성공값을 유지하고 화면 나머지는 정상 동작 */
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

  /* 키오스크 캔버스를 브라우저 크기에 맞춰 축소 */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => setScale(Math.min(el.clientWidth / KIOSK.w, el.clientHeight / KIOSK.h));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const station = stations[idx] ?? stations[0];
  const move = (d) => setIdx((i) => (i + d + stations.length) % stations.length);
  const miniStations = [...stations.map((s) => s.name), "STATION 2"].slice(0, 3);

  const handleToggle = async (slotNo, on) => {
    await api.setCharge(station.id, slotNo, on);
    const d = await api.getStations();
    setStations(d.stations);
  };

  const present  = station.slots.filter((s) => s.present).length;
  const charging = station.slots.filter((s) => s.mode === "CHARGING").length;
  const done     = station.slots.filter((s) => s.mode === "DONE").length;

  const w = "일월화수목금토"[clock.getDay()];
  const hh = clock.getHours();
  const time = `${((hh + 11) % 12) + 1}:${String(clock.getMinutes()).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;

  const arrowStyle = {
    flex: "0 0 52px", display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 60, fontWeight: 200, color: C.cyan, cursor: "pointer", position: "relative",
    textShadow: `0 0 20px ${C.cyan}`, userSelect: "none",
  };

  return (
    <div ref={wrapRef} style={{
      width: "100%", height: "100%", background: "#000",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "Pretendard, -apple-system, 'Malgun Gothic', 'Noto Sans KR', sans-serif",
      color: C.text, position: "relative", overflow: "hidden",
    }}>
      {/* 검토용 유틸 */}
      <div style={{ position: "absolute", top: 10, left: 12, zIndex: 60, display: "flex", gap: 8 }}>
        <button onClick={() => setShowMarkers((v) => !v)} style={utilBtn(showMarkers)}>
          버튼 번호 {showMarkers ? "숨기기" : "보기"}
        </button>
        <button onClick={() => setLogOpen((v) => !v)} style={utilBtn(logOpen)}>API 로그</button>
        <span style={{ fontSize: 11, color: C.muted2, alignSelf: "center" }}>
          {KIOSK.w}×{KIOSK.h} · {Math.round(scale * 100)}%
        </span>
      </div>

      {/* ── 키오스크 캔버스 ── */}
      <div style={{
        width: KIOSK.w, height: KIOSK.h, flex: "0 0 auto",
        transform: `scale(${scale})`, transformOrigin: "center",
      }}>
        <div style={{
          width: "100%", height: "100%", background: C.bg,
          display: "flex", flexDirection: "column", overflow: "hidden", position: "relative",
        }}>
          <div style={{
            position: "absolute", inset: 0, pointerEvents: "none",
            background: "radial-gradient(90% 60% at 50% 0%, rgba(30,110,190,.18), transparent 65%)",
          }} />

          {/* 헤더 */}
          <div style={{
            flex: "0 0 84px", display: "flex", alignItems: "center", gap: 24, padding: "0 40px",
            borderBottom: `1px solid ${C.line}`, background: "rgba(8,18,32,.7)", zIndex: 2,
          }}>
            <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 0.5 }}>
              JUWON <span style={{ fontSize: 17, fontWeight: 500, color: C.muted, marginLeft: 8 }}>주원</span>
            </div>
            <div style={{ flex: 1, textAlign: "center" }}>
              <div style={{ fontSize: 23, fontWeight: 700 }}>전기이륜차 공유배터리 스테이션</div>
              <div style={{ fontSize: 15, color: C.cyan }}>현재 화면: {station.name}</div>
            </div>
            <WeatherBadge weather={weather} stale={weatherStale} />
            <div style={{ textAlign: "right", lineHeight: 1.3, paddingLeft: 22, borderLeft: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 15, color: C.muted }}>
                {clock.getFullYear()}. {clock.getMonth() + 1}. {clock.getDate()} ({w})
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{time}</div>
            </div>
            <div style={{ display: "flex", gap: 20, paddingLeft: 22, borderLeft: `1px solid ${C.line}` }}>
              <StatusPill label="네트워크 정상" />
              <StatusPill label="CAN 통신 정상" />
            </div>
          </div>

          <StepBar />

          {/* 본문 */}
          <div style={{ flex: 1, padding: "0 60px", display: "flex", gap: 20, minHeight: 0, zIndex: 2 }}>
            <div style={arrowStyle} onClick={() => move(-1)}>
              {showMarkers && <Marker n={1} style={{ bottom: 0, left: -6 }} />}‹
            </div>

            <div style={{
              flex: 1, border: `2.5px solid ${C.cyan}`, borderRadius: 20, padding: 24,
              background: "linear-gradient(180deg,rgba(14,32,58,.75),rgba(6,14,26,.75))",
              boxShadow: `0 0 40px ${C.cyan}33, inset 0 0 50px ${C.cyan}12`,
              display: "flex", flexDirection: "column", gap: 18, minWidth: 0,
            }}>
              <div style={{
                textAlign: "center", fontSize: 36, fontWeight: 900, fontStyle: "italic",
                letterSpacing: 3, textShadow: `0 0 24px ${C.cyan}, 0 0 50px ${C.cyan}66`,
              }}>{station.name}</div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, flex: 1, minHeight: 0 }}>
                {station.slots.map((s) => (
                  <SlotCard key={s.no} slot={s} onToggle={handleToggle} showMarkers={showMarkers} />
                ))}
              </div>

              <div style={{
                display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 1,
                background: C.line, border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden",
              }}>
                <Summary ico="slots" k="운영 슬롯" v={`${present} / ${station.slots.length}`} color={C.cyan} />
                <Summary ico="bolt"  k="충전중"    v={charging} color={C.cyan} />
                <Summary ico="check" k="완료"      v={done}     color={C.green} />
                <Summary ico="bell"  k="알람"      v={0}        color={C.red} />
              </div>
            </div>

            <div style={arrowStyle} onClick={() => move(1)}>
              {showMarkers && <Marker n={1} style={{ bottom: 0, right: -6 }} />}›
            </div>

            <div style={{ flex: "0 0 280px", display: "flex" }}>
              <div style={{
                flex: 1, borderRadius: 20, padding: "26px 24px",
                background: "linear-gradient(160deg,#0c1a2d,#060d18)",
                border: `1px solid ${C.line}`,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,.04)",
                display: "flex", flexDirection: "column",
              }}>
                <div style={{ fontSize: 21, fontWeight: 800, color: C.cyan, marginBottom: 14, lineHeight: 1.4 }}>
                  2구 스테이션 단위<br />확장형 UI
                </div>
                <div style={{ fontSize: 16, color: C.muted, lineHeight: 1.75 }}>
                  각 스테이션은 2개의<br />충전 슬롯을 가지며,<br />모듈 단위로 확장됩니다.
                </div>

                {/* 확장 일러스트 */}
                <div style={{ display: "flex", alignItems: "flex-end", gap: 9, margin: "26px 0 8px" }}>
                  {miniStations.map((n, i) => (
                    <div key={n} style={{ textAlign: "center", flex: "0 0 auto" }}>
                      <div style={{
                        width: 54 - i * 5, height: 62 - i * 6, borderRadius: 7, margin: "0 auto",
                        background: "linear-gradient(160deg,#12263f,#0a1526)",
                        border: `1.5px solid ${i === 0 ? C.cyan : C.line2}`,
                        boxShadow: i === 0 ? `0 0 16px ${C.cyan}55` : "none",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                      }}>
                        <span style={{ width: 8, height: 24, borderRadius: 3, background: C.cyan, opacity: 0.8 }} />
                        <span style={{ width: 8, height: 24, borderRadius: 3, background: C.cyan, opacity: 0.8 }} />
                      </div>
                      <div style={{ fontSize: 10, color: C.muted2, marginTop: 6, whiteSpace: "nowrap" }}>{n}</div>
                    </div>
                  ))}
                  <div style={{ color: C.muted2, fontSize: 15, paddingBottom: 24 }}>···</div>
                </div>

                <div style={{
                  display: "flex", alignItems: "center", gap: 12, marginTop: "auto",
                  paddingTop: 18, borderTop: `1px solid ${C.line}`,
                }}>
                  {Ico.hand(C.muted)}
                  <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.6 }}>
                    좌우로 밀어<br />다른 스테이션 보기
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 탭 (2번) */}
          <div style={{ padding: "16px 60px 0", display: "flex", gap: 10, zIndex: 2, position: "relative" }}>
            {showMarkers && <Marker n={2} style={{ top: 8, right: 40 }} />}
            {stations.map((s, i) => (
              <button key={s.id} onClick={() => setIdx(i)} style={tabStyle(i === idx, false)}>{s.name}</button>
            ))}
            {["STATION 2", "STATION 3"].map((n) => (
              <button key={n} disabled style={tabStyle(false, true)}>{n}</button>
            ))}
          </div>

          {/* 하단 액션 (3번 / 5번) */}
          <div style={{
            flex: "0 0 120px", display: "flex", alignItems: "center",
            justifyContent: "center", gap: 20, zIndex: 2, position: "relative",
          }}>
            <div style={{ position: "relative" }}>
              {showMarkers && <Marker n={3} style={{ bottom: -8, left: -12 }} />}
              <button onClick={onGoMain} style={btn("ghost")}>{Ico.home(C.muted)} 메인으로</button>
            </div>
            <div style={{ position: "relative" }}>
              {showMarkers && <Marker n={5} style={{ bottom: -8, right: -12 }} />}
              <button onClick={onGoPayment} style={btn("primary")}>결제하기 ›</button>
            </div>
          </div>
        </div>
      </div>

      {/* API 로그 */}
      {logOpen && (
        <div style={{
          position: "absolute", right: 12, bottom: 12, width: 420, height: 320, zIndex: 60,
          background: "#050d18", border: `1px solid ${C.line2}`, borderRadius: 10,
          overflow: "auto", padding: 12,
          fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 11, lineHeight: 1.6,
        }}>
          {logs.length === 0 && <div style={{ color: C.muted2 }}>호출 대기 중…</div>}
          {logs.map((l) => (
            <div key={l.id} style={{
              borderBottom: "1px solid #10233c", padding: "3px 0",
              color: "#8fb8e8", wordBreak: "break-all",
            }}>
              <span style={{ color: C.muted2 }}>{l.at}</span>{" "}
              <b style={{ color: C.amber }}>{l.method}</b> {l.path}
              {l.payload && <div>&nbsp;&nbsp;→ {l.payload}</div>}
              <div style={{ color: C.green }}>&nbsp;&nbsp;← {l.res}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 스타일 헬퍼 ───────────────────────────────────────────────────────── */
function WeatherBadge({ weather, stale }) {
  if (!weather) {
    return <div style={{ fontSize: 15, color: C.muted2, minWidth: 160, textAlign: "right" }}>날씨 불러오는 중…</div>;
  }
  const s = SKY[weather.sky] ?? SKY.CLEAR;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 13, opacity: stale ? 0.55 : 1 }}>
      <div style={{ fontSize: 36, lineHeight: 1 }}>{s.icon}</div>
      <div style={{ lineHeight: 1.25 }}>
        <div style={{ fontSize: 14, color: stale ? C.amber : C.muted }}>{stale ? "갱신 실패" : s.text}</div>
        <div style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
          {weather.temp.toFixed(0)}°C
        </div>
      </div>
      <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.5, paddingLeft: 12, borderLeft: `1px solid ${C.line}` }}>
        최고 <b style={{ color: C.amber }}>{weather.high}°</b><br />
        최저 <b style={{ color: C.cyan }}>{weather.low}°</b>
      </div>
    </div>
  );
}

function StatusPill({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, color: C.muted }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: C.green, boxShadow: `0 0 10px ${C.green}` }} />
      {label}
    </div>
  );
}

function Summary({ ico, k, v, color }) {
  return (
    <div style={{
      background: C.panel, padding: "14px 10px",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 13,
    }}>
      {ico && <div style={{ opacity: 0.9 }}>{Ico[ico](color ?? C.muted)}</div>}
      <div style={{ textAlign: "left" }}>
        <div style={{ fontSize: 15, color: color ?? C.muted }}>{k}</div>
        <div style={{ fontSize: 30, fontWeight: 900, lineHeight: 1.1, color: C.text }}>{v}</div>
      </div>
    </div>
  );
}

function tabStyle(on, disabled) {
  return {
    flex: 1, height: 58, borderRadius: "12px 12px 0 0", fontSize: 18, fontWeight: 700,
    fontFamily: "inherit", cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.35 : 1,
    border: `1.5px solid ${on ? C.cyan : C.line}`, borderBottom: "none",
    background: on ? C.cyan : C.panel, color: on ? "#04121f" : C.muted,
    boxShadow: on ? `0 -4px 20px ${C.cyan}44` : "none",
  };
}

function btn(kind) {
  const base = {
    minWidth: 260, height: 76, padding: "0 42px", borderRadius: 14, cursor: "pointer",
    fontSize: 25, fontWeight: 700, fontFamily: "inherit",
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 12,
  };
  if (kind === "primary") {
    return { ...base, background: C.cyan, border: `2px solid ${C.cyan}`, color: "#04121f", boxShadow: `0 0 30px ${C.glow}` };
  }
  return { ...base, background: "transparent", border: `2px solid ${C.line2}`, color: C.muted, minWidth: 230 };
}

function utilBtn(active) {
  return {
    padding: "7px 13px", borderRadius: 8, fontSize: 12, fontWeight: 700, fontFamily: "inherit",
    cursor: "pointer", border: `1px solid ${C.line2}`,
    background: active ? C.cyan : "#132842", color: active ? "#04121f" : C.cyan,
  };
}
