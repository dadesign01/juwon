/* ============================================================================
   weatherApi.js — 날씨 조회 (프론트에서 외부 API 직접 호출)
   ----------------------------------------------------------------------------
   제공자를 바꾸려면 WEATHER_PROVIDER 값만 변경하면 됩니다.
     'mock'     : 서버 없이 화면 확인용 (기본값)
     'openmeteo': Open-Meteo — API 키 불필요, 브라우저 직접 호출 가능
     'kma'      : 기상청 단기예보 (공공데이터포털) — 서비스키 필요

   반환 형식 (제공자와 무관하게 동일):
     { sky, temp, high, low, updatedAt }
     sky ∈ CLEAR | CLOUDY | OVERCAST | RAIN | SNOW | SHOWER
   ========================================================================== */

export const WEATHER_PROVIDER = "mock";

/* 스테이션 설치 위치 — 기기별로 이 값만 바꿔주면 됩니다 */
export const STATION_COORD = { lat: 37.2636, lon: 127.0286, name: "수원" };

/* 기상청 서비스키 (공공데이터포털 발급). 'kma' 사용 시에만 필요 */
const KMA_SERVICE_KEY = "";

/* ────────────────────────────────────────────────────────────────────────
   1. Open-Meteo — 키 없이 브라우저에서 바로 호출됩니다
   ──────────────────────────────────────────────────────────────────────── */
/* WMO weather code → 내부 sky 코드 */
function wmoToSky(code) {
  if (code === 0 || code === 1) return "CLEAR";
  if (code === 2) return "CLOUDY";
  if (code === 3 || code === 45 || code === 48) return "OVERCAST";
  if (code >= 71 && code <= 77) return "SNOW";
  if (code === 85 || code === 86) return "SNOW";
  if (code >= 80 && code <= 82) return "SHOWER";
  if (code >= 95) return "SHOWER";
  if (code >= 51 && code <= 67) return "RAIN";
  return "CLOUDY";
}

async function fetchOpenMeteo({ lat, lon }) {
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lat}&longitude=${lon}` +
    "&current=temperature_2m,weather_code" +
    "&daily=temperature_2m_max,temperature_2m_min" +
    "&timezone=Asia%2FSeoul&forecast_days=1";

  const r = await fetch(url);
  if (!r.ok) throw new Error(`open-meteo ${r.status}`);
  const j = await r.json();

  return {
    sky: wmoToSky(j.current.weather_code),
    temp: j.current.temperature_2m,
    high: Math.round(j.daily.temperature_2m_max[0]),
    low: Math.round(j.daily.temperature_2m_min[0]),
    updatedAt: new Date().toISOString(),
  };
}

/* ────────────────────────────────────────────────────────────────────────
   2. 기상청 단기예보
   ──────────────────────────────────────────────────────────────────────── */

/* 위경도 → 기상청 격자좌표 (Lambert Conformal Conic) */
export function toGrid(lat, lon) {
  const RE = 6371.00877, GRID = 5.0;
  const SLAT1 = 30.0, SLAT2 = 60.0, OLON = 126.0, OLAT = 38.0;
  const XO = 43, YO = 136;
  const D = Math.PI / 180;

  const re = RE / GRID;
  const slat1 = SLAT1 * D, slat2 = SLAT2 * D;
  const olon = OLON * D, olat = OLAT * D;

  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  let ra = Math.tan(Math.PI * 0.25 + lat * D * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lon * D - olon;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;

  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  };
}

/* 단기예보 발표시각: 02·05·08·11·14·17·20·23시 (발표 후 약 10분 뒤 조회 가능) */
function kmaBaseDateTime(now = new Date()) {
  const kst = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60000);
  const slots = [2, 5, 8, 11, 14, 17, 20, 23];
  let h = kst.getHours();
  if (kst.getMinutes() < 15) h -= 1; // 발표 직후 지연 대비

  let base = slots.filter((s) => s <= h).pop();
  if (base === undefined) {
    kst.setDate(kst.getDate() - 1);
    base = 23;
  }
  const p = (n) => String(n).padStart(2, "0");
  return {
    base_date: `${kst.getFullYear()}${p(kst.getMonth() + 1)}${p(kst.getDate())}`,
    base_time: `${p(base)}00`,
  };
}

/* SKY(하늘상태) + PTY(강수형태) → 내부 sky 코드 */
function kmaToSky(sky, pty) {
  if (pty === "1" || pty === "5") return "RAIN";
  if (pty === "2" || pty === "6") return "RAIN";
  if (pty === "3" || pty === "7") return "SNOW";
  if (pty === "4") return "SHOWER";
  if (sky === "1") return "CLEAR";
  if (sky === "3") return "CLOUDY";
  if (sky === "4") return "OVERCAST";
  return "CLOUDY";
}

async function fetchKma({ lat, lon }) {
  if (!KMA_SERVICE_KEY) throw new Error("KMA_SERVICE_KEY 미설정");

  const { nx, ny } = toGrid(lat, lon);
  const { base_date, base_time } = kmaBaseDateTime();

  const url =
    "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst" +
    `?serviceKey=${encodeURIComponent(KMA_SERVICE_KEY)}` +
    `&pageNo=1&numOfRows=1000&dataType=JSON` +
    `&base_date=${base_date}&base_time=${base_time}&nx=${nx}&ny=${ny}`;

  const r = await fetch(url);
  if (!r.ok) throw new Error(`kma ${r.status}`);
  const j = await r.json();

  const items = j?.response?.body?.items?.item;
  if (!Array.isArray(items)) throw new Error("kma 응답 형식 오류");

  /* 가장 가까운 예보시각의 값을 사용 */
  const first = (cat) => items.find((i) => i.category === cat)?.fcstValue;
  const pick = (cat) => items.filter((i) => i.category === cat).map((i) => +i.fcstValue);

  const tmx = pick("TMX"), tmn = pick("TMN"), tmp = pick("TMP");
  const temp = +first("TMP");

  return {
    sky: kmaToSky(first("SKY"), first("PTY")),
    temp,
    high: Math.round(tmx.length ? Math.max(...tmx) : Math.max(...tmp, temp)),
    low: Math.round(tmn.length ? Math.min(...tmn) : Math.min(...tmp, temp)),
    updatedAt: new Date().toISOString(),
  };
}

/* ────────────────────────────────────────────────────────────────────────
   3. Mock — 서버/키 없이 화면만 볼 때
   ──────────────────────────────────────────────────────────────────────── */
function fetchMock() {
  return Promise.resolve({
    sky: "CLEAR",
    temp: +(27 + (Math.random() - 0.5) * 1.2).toFixed(1),
    high: 31,
    low: 20,
    updatedAt: new Date().toISOString(),
  });
}

/* ────────────────────────────────────────────────────────────────────────
   진입점
   ──────────────────────────────────────────────────────────────────────── */
export async function getWeather(coord = STATION_COORD) {
  switch (WEATHER_PROVIDER) {
    case "openmeteo": return fetchOpenMeteo(coord);
    case "kma":       return fetchKma(coord);
    default:          return fetchMock();
  }
}
