"use strict";
/* =====================================================================
   AI CITY EMERGENCY BRAIN — frontend
   Layers:  CONFIG → MOCK DATA (single file/section) → API SERVICE →
            TRAFFIC SOCKET → STORE → UI COMPONENTS → VIEWS → ROUTER
   Nothing below the MOCK section reads mock data directly; it only goes
   through `api` and `TrafficSocket`. Flip CONFIG.USE_MOCK to false and
   point API_BASE at the real backend to replace mock data.
   ===================================================================== */

/* ============================ CONFIG ============================ */
const CONFIG = {
  USE_MOCK: false,
  API_BASE: 'http://127.0.0.1:8000',
  WS_URL: '/ws/traffic',
  endpoints: {
    roads: '/traffic',
    incidents: '/incidents',
    report: '/emergencies',
    status: id => `/emergencies/${id}/status`,
    history: '/traffic/history'
  },
  TICK_MS: 3000
};

/* ========================= MOCK DATA (centralised) ========================= */
const NOW0 = Date.now();
const ago = m => NOW0 - m * 60000;
const MOCK = {
  // backend-shaped road records (no coordinates are provided by the backend)
  roads: [
    { name:'Road A',    vehicle_count:30, average_speed:42, congestion:'LOW',    status:'OPEN' },
    { name:'Road B',    vehicle_count:85, average_speed:18, congestion:'HIGH',   status:'OPEN' },
    { name:'Road C',    vehicle_count:50, average_speed:30, congestion:'MEDIUM', status:'OPEN' },
    { name:'Road D',    vehicle_count:0,  average_speed:0,  congestion:'HIGH',   status:'BLOCKED' },
    { name:'Road E',    vehicle_count:78, average_speed:21, congestion:'HIGH',   status:'OPEN' },
    { name:'Main Road', vehicle_count:55, average_speed:28, congestion:'MEDIUM', status:'OPEN' },
    { name:'Road F',    vehicle_count:25, average_speed:46, congestion:'LOW',    status:'OPEN' },
    { name:'Road G',    vehicle_count:35, average_speed:38, congestion:'LOW',    status:'OPEN' }
  ],
  // Incident fields the backend does not send are simply absent (UI shows "Not provided")
  incidents: [
    { id:102, type:'ACCIDENT', road:'Road B', severity:'HIGH', status:'ACTIVE', reported_at:ago(2),
      vehicles_involved:2, lanes_blocked:1, ambulance_required:true,
      ai:{ traffic_impact:'HIGH', affected_roads:['Road B','Road E'], recommended_route:'Road C',
           reason:'The accident blocks one lane and requires an ambulance. Road C has lower congestion and is not blocked.' } },
    { id:101, type:'FIRE', road:'Main Road', severity:'HIGH', status:'ACTIVE', reported_at:ago(5),
      ai:{ traffic_impact:'MEDIUM', affected_roads:['Main Road','Road D'], recommended_route:'Road C',
           reason:'Main Road is affected by the fire response and Road D is blocked. Road C is open with moderate traffic.' } },
    { id:103, type:'MEDICAL', road:'Road G', severity:'MEDIUM', status:'RESPONDING', reported_at:ago(18), ambulance_required:true,
      ai:{ traffic_impact:'LOW', affected_roads:['Road G'], recommended_route:'Road A',
           reason:'Road G traffic is light. Road A is open with low congestion.' } },
    ...[[100,'ACCIDENT','Road A','MEDIUM',95,32],[99,'FIRE','Road C','CRITICAL',240,47],[98,'OTHER','Road F','LOW',420,25],
        [97,'MEDICAL','Road E','MEDIUM',1500,52],[96,'ACCIDENT','Road B','HIGH',2900,58],[95,'MEDICAL','Road G','LOW',4400,21],
        [94,'FIRE','Main Road','HIGH',5800,66],[93,'ACCIDENT','Road D','HIGH',7300,44],[92,'OTHER','Road A','LOW',8700,18],
        [91,'ACCIDENT','Road C','MEDIUM',9900,35]].map(([id,type,road,sev,m,res]) => ({
      id, type, road, severity:sev, status:'RESOLVED', reported_at:ago(m), resolved_at:ago(m-res),
      ai: id===98 ? null : { traffic_impact: sev==='LOW'?'LOW':sev==='MEDIUM'?'MEDIUM':'HIGH', affected_roads:[road],
           recommended_route: road==='Road A'?'Road C':'Road A', reason:'Archived recommendation based on traffic conditions at the time of the incident.' } }))
  ],
  notifications: [
    { id:1, kind:'high',   title:'High severity accident detected', sub:'Road B', at:ago(2) },
    { id:2, kind:'traffic',title:'Traffic increased', sub:'Road E', at:ago(5) },
    { id:3, kind:'ai',     title:'AI route recommendation updated', sub:'Road C', at:NOW0-4000 },
    { id:4, kind:'blocked',title:'Road blocked', sub:'Road D', at:ago(14) },
    { id:5, kind:'system', title:'Traffic feed connected', sub:'System', at:ago(30) }
  ],
  health: { backend:'ONLINE', database:'ONLINE', ai:'ONLINE', frontend:'ONLINE' },
  history() { // seeded, deterministic hourly traffic history for 72h
    let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const out = []; const base = { 'Road A':30,'Road B':85,'Road C':50,'Road D':40,'Road E':78,'Main Road':55,'Road F':25,'Road G':35 };
    const cur = new Date(NOW0); cur.setMinutes(0,0,0);
    for (let h = 71; h >= 0; h--) {
      const t = cur.getTime() - h * 3600000, hr = new Date(t).getHours();
      const f = .55 + .55 * (Math.exp(-(((hr-9)/2.2)**2)) + Math.exp(-(((hr-18)/2.5)**2)));
      for (const [road,b] of Object.entries(base)) {
        const v = Math.round(b * f * (.85 + rnd()*.3) * (b > 60 ? .9 : 1));
        out.push({ ts:t, road, vehicle_count:v, average_speed:Math.max(6, Math.round(58 - v*.52 + (rnd()-.5)*6)), congestion: congOf(v) });
      }
    }
    return out;
  }
};
function congOf(v){ return v >= 70 ? 'HIGH' : v >= 40 ? 'MEDIUM' : 'LOW'; }

/* Map layer config — the backend has no lat/lng yet, so this is a stylised layout only.
   When coordinates exist, replace <CityMap> with a Leaflet/OpenStreetMap adapter that
   consumes the same { roads, incidents, route } props. */
const GEO = {
  'Road A':[[70,110],[330,110],[560,130]],
  'Road B':[[330,110],[345,300],[335,510]],
  'Road C':[[70,320],[345,300],[650,305],[930,285]],
  'Road D':[[560,130],[650,305],[700,510]],
  'Road E':[[560,130],[790,95],[940,140]],
  'Main Road':[[70,510],[335,510],[700,510],[930,495]],
  'Road F':[[790,95],[830,300],[880,498]],
  'Road G':[[70,110],[70,320],[70,510]]
};

/* ============================= API SERVICE ============================= */
const sim = { apiFail:false, wsDown:false, aiDown:false };   // demo switches (Settings page)
const clone = o => JSON.parse(JSON.stringify(o));
const wait = ms => new Promise(r => setTimeout(r, ms));
const DB = { roads:clone(MOCK.roads), incidents:clone(MOCK.incidents), history:MOCK.history(), notifications:clone(MOCK.notifications) };

async function mockCall(fn, ms = 500) {
  await wait(ms + Math.random()*250);
  if (sim.apiFail) throw new Error('Backend unreachable');
  return fn();
}
async function http(path, opts) {
  const r = await fetch(CONFIG.API_BASE + path, { headers:{'Content-Type':'application/json'}, ...opts });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
function mockAnalyze(inc) {           // stand-in for the backend AI engine
  const sev = { ACCIDENT:'HIGH', FIRE:'HIGH', MEDICAL:'MEDIUM', OTHER:'LOW' }[inc.type] || 'LOW';
  const r = DB.roads.find(x => x.name === inc.road);
  const affected = [inc.road, ...DB.roads.filter(x => x.name !== inc.road && x.congestion === 'HIGH' && x.status === 'OPEN').map(x => x.name)].slice(0,3);
  const cand = DB.roads.filter(x => x.status === 'OPEN' && !affected.includes(x.name)).sort((a,b) => a.vehicle_count - b.vehicle_count)[0];
  return { severity:sev, ai:{ traffic_impact: r ? (r.status==='BLOCKED'?'HIGH':r.congestion) : 'LOW', affected_roads:affected, recommended_route:cand ? cand.name : 'Not available',
    reason: cand ? `${cand.name} has ${cand.congestion.toLowerCase()} congestion and is not blocked.` : 'No open road with acceptable congestion was found.' } };
}
const api = {
  getRoads:     async () => CONFIG.USE_MOCK ? mockCall(() => clone(DB.roads)) : (await http(CONFIG.endpoints.roads)).roads || [],
  getIncidents: async () => CONFIG.USE_MOCK ? mockCall(() => clone(DB.incidents), 650) : (await http(CONFIG.endpoints.incidents)).incidents || [],
  getHistory:   async () => CONFIG.USE_MOCK ? mockCall(() => DB.history, 300) : (await http(CONFIG.endpoints.history)).history || [],
  reportEmergency: body => CONFIG.USE_MOCK ? mockCall(() => {
      const id = Math.max(...DB.incidents.map(i => i.id)) + 1;
      const a = mockAnalyze(body);
      const inc = { id, type:body.type, road:body.road, severity:a.severity, status:'REPORTED', reported_at:Date.now(), description:body.info || undefined, ai:a.ai };
      DB.incidents.unshift(inc); return clone(inc);
    }, 900) : http(CONFIG.endpoints.report, { method:'POST', body:JSON.stringify(body) }),
  updateStatus: (id, status) => CONFIG.USE_MOCK ? mockCall(() => {
      const i = DB.incidents.find(x => x.id === id); i.status = status; if (status === 'RESOLVED') i.resolved_at = Date.now(); return clone(i);
    }, 500) : http(CONFIG.endpoints.status(id), { method:'PATCH', body:JSON.stringify({ status }) })
};

/* ============================ TRAFFIC SOCKET ============================ */
class TrafficSocket {
  constructor(onMessage, onState) { this.onMessage = onMessage; this.onState = onState; this.state = 'reconnecting'; this.tries = 0; this.timer = null; this.ws = null; }
  set(s) { if (s !== this.state) { this.state = s; this.onState(s); } }
  connect() { CONFIG.USE_MOCK ? this.simulate() : this.open(); }
  open() {
    try {
      this.ws = new WebSocket(
  `ws://127.0.0.1:8000${CONFIG.WS_URL}`
);
      this.ws.onopen = () => { this.tries = 0; this.set('live'); };
      this.ws.onmessage = e => { try { this.onMessage(JSON.parse(e.data)); } catch {} };
      this.ws.onclose = this.ws.onerror = () => {
        this.tries++; this.set(this.tries > 3 ? 'offline' : 'reconnecting');
        clearTimeout(this.timer); this.timer = setTimeout(() => this.open(), Math.min(15000, 1000 * 2 ** this.tries));
      };
    } catch { this.set('offline'); }
  }
  simulate() {                        // demo: emits the same message shape as /ws/traffic
    this.set('reconnecting');
    setTimeout(() => this.set('live'), 900);
    setInterval(() => {
      if (sim.wsDown) { this.tries++; this.set(this.tries > 2 ? 'offline' : 'reconnecting'); return; }
      this.tries = 0; this.set('live');
      const out = [];
      for (const r of DB.roads) {
        if (r.status === 'BLOCKED') continue;
        const base = MOCK.roads.find(x => x.name === r.name).vehicle_count;
        if (Math.random() < .55) {
          const v = Math.max(5, Math.round(base + (Math.random() - .5) * 12));
          out.push({ name:r.name, vehicle_count:v, average_speed:Math.max(6, Math.round(58 - v*.5 + (Math.random()-.5)*5)), congestion:congOf(v), status:'OPEN' });
        }
      }
      this.onMessage({ type:'traffic_update', roads:out });
    }, CONFIG.TICK_MS);
  }
}

/* ================================ STORE ================================ */
const S = {
  route:{ name:'command', id:null }, loading:true, error:null, refreshing:false,
  roads:[], incidents:[], history:[], notifs:clone(MOCK.notifications), unread:3,
  conn:'reconnecting', lastUpdate:Date.now(), roadTs:{}, roadHist:{}, totals:[],
  f:{ q:'', status:'ALL', sev:'ALL', type:'ALL', sort:'NEWEST' },
  tf:'ALL', drawer:null, side:false, notifOpen:false,
  mp:{ q:'', cong:'ALL', sel:null }, an:{ range:72, road:'ALL', cong:'ALL', limit:15 },
  aiSel:null, aiDone:{}, aiStep:{}, modal:null,
  rep:{ type:'ACCIDENT', road:'', info:'', state:'form', msg:'', id:null }
};
const maps = {};
const TYPES = ['ACCIDENT','FIRE','MEDICAL','OTHER'];
const SEVR = { CRITICAL:4, HIGH:3, MEDIUM:2, LOW:1 };
const isOpenInc = i => i.status !== 'RESOLVED';
const activeInc = () => S.incidents.filter(isOpenInc).sort((a,b) => b.reported_at - a.reported_at);
const primaryInc = () => activeInc().sort((a,b) => SEVR[b.severity] - SEVR[a.severity] || b.reported_at - a.reported_at)[0] || null;
const roadBy = n => S.roads.find(r => r.name === n);
const rcong = r => r.status === 'BLOCKED' ? 'BLOCKED' : r.congestion;

/* =============================== HELPERS =============================== */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cap = s => s ? s[0] + s.slice(1).toLowerCase() : s;
const P = {
  dash:'<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  siren:'<path d="M7 18v-6a5 5 0 1 1 10 0v6"/><path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z"/><path d="M21 12h1M2 12h1M12 2v1M4.93 4.93l.7.7M19.07 4.93l-.7.7"/>',
  traffic:'<rect x="7" y="2" width="10" height="20" rx="3"/><circle cx="12" cy="7" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="17" r="1.6"/>',
  brain:'<rect x="5" y="5" width="14" height="14" rx="3"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  map:'<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  chart:'<path d="M3 3v18h18"/><path d="M8 17v-5M13 17V8M18 17v-9"/>',
  gear:'<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  activity:'<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  bell:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  shield:'<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4M12 16h.01"/>',
  refresh:'<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>', x:'<path d="M18 6 6 18M6 6l12 12"/>', plus:'<path d="M12 5v14M5 12h14"/>', minus:'<path d="M5 12h14"/>',
  check:'<path d="M20 6 9 17l-5-5"/>', route:'<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H17a3.5 3.5 0 0 0 0-7H7a3.5 3.5 0 0 1 0-7h8"/>',
  layers:'<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>', search:'<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  flame:'<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  car:'<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  cross:'<path d="M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z"/>', alert:'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', wifi:'<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a14 14 0 0 1 20 0"/><path d="M12 20h.01"/>',
  db:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  server:'<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01"/>',
  arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>', ban:'<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>', gauge:'<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  eye:'<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>', user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  flag:'<path d="M5 22V4M5 4h13l-2 4 2 4H5"/>', zap:'<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>'
};
const ic = (n, s = 18) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;
const typeIcon = t => ({ ACCIDENT:'car', FIRE:'flame', MEDICAL:'cross' }[t] || 'alert');
const bd = (v, dot) => `<span class="bd ${esc(v)}${dot ? ' dotted' : ''}">${esc(v)}</span>`;
const rel = ts => { const s = Math.max(0, Math.round((Date.now() - ts) / 1000)); if (s < 5) return 'Just now'; if (s < 60) return s + ' sec ago'; const m = Math.round(s/60); if (m < 60) return m + ' min ago'; const h = Math.round(m/60); if (h < 24) return h + ' h ago'; return Math.round(h/24) + ' d ago'; };
const relS = ts => `<span data-ts="${ts}">${rel(ts)}</span>`;
const clock = ts => new Date(ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
const fmtDT = ts => new Date(ts).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
const covar = c => ({ LOW:'var(--green)', MEDIUM:'var(--yellow)', HIGH:'var(--orange)', BLOCKED:'var(--red)' }[c] || 'var(--tx3)');
const sk = (w, h, extra = '') => `<div class="sk" style="width:${w};height:${h};${extra}"></div>`;
const reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
function toast(msg, kind = 'ok') { const t = $('#toast'); t.innerHTML = `<div class="toast"><span class="${kind}">${ic(kind === 'ok' ? 'check' : 'alert', 16)}</span>${esc(msg)}</div>`; clearTimeout(toast.t); toast.t = setTimeout(() => t.innerHTML = '', 3200); }
function pushNotif(kind, title, sub) { S.notifs.unshift({ id:Date.now()+Math.random(), kind, title, sub, at:Date.now() }); S.notifs = S.notifs.slice(0, 30); S.unread++; }
const NK = { high:['siren','r'], traffic:['traffic','o'], ai:['brain','c'], blocked:['ban','r'], system:['activity','g'], new:['siren','o'] };

/* ================================ CHARTS ================================ */
function lineChart(series, labels, { h = 220, fill = true, yMin, yMax, every = 4, unit = '' } = {}) {
  const W = 640, pl = 38, pr = 10, pt = 12, pb = 26, all = series.flatMap(s => s.vals);
  let mn = yMin ?? Math.min(...all), mx = yMax ?? Math.max(...all); if (mx <= mn) mx = mn + 1;
  const pad = (mx - mn) * .1; if (yMin == null) mn = Math.max(0, mn - pad); if (yMax == null) mx += pad;
  const X = i => pl + (W - pl - pr) * (i / Math.max(1, labels.length - 1)), Y = v => pt + (h - pt - pb) * (1 - (v - mn) / (mx - mn));
  let g = '';
  for (let k = 0; k <= 4; k++) { const v = mn + (mx - mn) * k / 4, y = Y(v); g += `<line x1="${pl}" x2="${W-pr}" y1="${y}" y2="${y}" stroke="#1a2740" stroke-width="1"/><text x="${pl-7}" y="${y+4}" text-anchor="end">${Math.round(v)}${unit}</text>`; }
  labels.forEach((l, i) => { if (i % every === 0) g += `<text x="${X(i)}" y="${h-7}" text-anchor="middle">${esc(l)}</text>`; });
  const paths = series.map((s, si) => {
    const d = s.vals.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join('');
    const area = fill && si === 0 ? `<path d="${d}L${X(s.vals.length-1)} ${h-pb}L${pl} ${h-pb}Z" fill="${s.color}" opacity=".10"/>` : '';
    return area + `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" role="img">${g}${paths}</svg>`;
}
function barChart(vals, labels, { h = 220, color = 'var(--cyan)', colors } = {}) {
  const W = 640, pl = 34, pr = 10, pt = 14, pb = 26, mx = Math.max(1, ...vals) * 1.15, bw = (W - pl - pr) / vals.length;
  let g = '';
  for (let k = 0; k <= 4; k++) { const v = mx * k / 4, y = pt + (h - pt - pb) * (1 - k / 4); g += `<line x1="${pl}" x2="${W-pr}" y1="${y}" y2="${y}" stroke="#1a2740"/><text x="${pl-7}" y="${y+4}" text-anchor="end">${Math.round(v)}</text>`; }
  vals.forEach((v, i) => { const bh = (h - pt - pb) * v / mx, x = pl + i * bw + bw * .22; g += `<rect x="${x}" y="${h-pb-bh}" width="${bw*.56}" height="${bh}" rx="4" fill="${colors ? colors[i] : color}" opacity=".9"/><text x="${x+bw*.28}" y="${h-7}" text-anchor="middle">${esc(labels[i])}</text><text x="${x+bw*.28}" y="${h-pb-bh-5}" text-anchor="middle" style="fill:var(--tx2)">${v}</text>`; });
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" role="img">${g}</svg>`;
}
function donut(items) {
  const tot = items.reduce((a, b) => a + b.v, 0) || 1, R = 62, C = 2 * Math.PI * R; let off = 0;
  const arcs = items.map(it => { const len = C * it.v / tot, s = `<circle cx="90" cy="90" r="${R}" fill="none" stroke="${it.c}" stroke-width="22" stroke-dasharray="${len} ${C-len}" stroke-dashoffset="${-off}" transform="rotate(-90 90 90)"/>`; off += len; return s; }).join('');
  return `<div style="display:flex;gap:22px;align-items:center;flex-wrap:wrap"><svg viewBox="0 0 180 180" width="170" height="170"><circle cx="90" cy="90" r="${R}" fill="none" stroke="#132038" stroke-width="22"/>${arcs}<text x="90" y="88" text-anchor="middle" style="fill:#eaf0fc;font-size:30px;font-weight:800">${tot}</text><text x="90" y="108" text-anchor="middle" style="fill:#66768f;font-size:11px">incidents</text></svg><div class="legend-d" style="flex-direction:column;margin:0">${items.map(i => `<span><i style="background:${i.c}"></i>${esc(i.l)} <b style="color:var(--tx)">${i.v}</b></span>`).join('')}</div></div>`;
}
function spark(vals, color = 'var(--cyan)', h = 40) {
  if (vals.length < 2) return '';
  const W = 200, mn = Math.min(...vals), mx = Math.max(...vals) || 1, r = mx - mn || 1;
  const d = vals.map((v, i) => (i ? 'L' : 'M') + (i / (vals.length - 1) * W).toFixed(1) + ' ' + (h - 4 - (v - mn) / r * (h - 8)).toFixed(1)).join('');
  return `<svg viewBox="0 0 ${W} ${h}" width="100%" height="${h}" preserveAspectRatio="none"><path d="${d}L${W} ${h}L0 ${h}Z" fill="${color}" opacity=".12"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

/* ============================== CITY MAP ==============================
   Props are plain data (roads/incidents/route) so this component can be swapped
   for a Leaflet adapter later without touching the pages that use it.        */
function pointAt(pts, t) {
  const seg = []; let L = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]); seg.push(d); L += d; }
  let w = L * t;
  for (let i = 0; i < seg.length; i++) { if (w <= seg[i]) { const k = w / seg[i]; return [pts[i][0] + (pts[i+1][0]-pts[i][0])*k, pts[i][1] + (pts[i+1][1]-pts[i][1])*k]; } w -= seg[i]; }
  return pts[pts.length-1];
}
const pathD = pts => pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join('');
const MINOR = [[[70,215],[940,215]],[[70,410],[940,410]],[[200,110],[200,510]],[[450,110],[450,510]],[[560,130],[560,300]],[[780,95],[780,500]],[[940,140],[940,495]],[[120,60],[860,60]],[[120,560],[900,560]]];
function mountMap(id, getCfg) {
  const el = document.getElementById(id); if (!el) return null;
  if (!window.L) {
    el.innerHTML = '<div class="empty"><b>MAP LIBRARY UNAVAILABLE</b><span>Check your internet connection to load Leaflet and OpenStreetMap.</span></div>';
    return null;
  }
  el.innerHTML = `<div class="leaflet-host" id="${id}-leaflet"></div>
    <div class="map-tag">${ic('map',14)} OpenStreetMap <span>Geographic map · demonstration incident locations</span></div>
    <div class="map-ctrl"><button data-m="layers" aria-label="Toggle incident markers">${ic('layers',16)}</button><button data-m="locate" aria-label="Use my location">${ic('crosshair',16)}</button></div>
    <div class="map-legend">${[['LOW','var(--green)'],['MEDIUM','var(--yellow)'],['HIGH','var(--orange)'],['CRITICAL','var(--red)']].map(([l,c]) => `<span><i style="background:${c}"></i>${l}</span>`).join('')}<span><i style="background:var(--cyan)"></i>INCIDENT MARKERS</span></div>`;
  const map = L.map(id+'-leaflet').setView([28.9845,77.7064],12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19, attribution:'&copy; OpenStreetMap contributors'
  }).addTo(map);
  const markerLayer = L.layerGroup().addTo(map);
  const m={el,leaflet:map,sel:null,layers:{emerg:true},update:()=>{
    const c=getCfg(); markerLayer.clearLayers();
    const coords = {
      'Road A':[28.990,77.700], 'Road B':[28.979,77.714], 'Road C':[28.987,77.724],
      'Road D':[28.970,77.705], 'Road E':[28.998,77.719], 'Main Road':[28.982,77.695],
      'Road F':[28.963,77.721], 'Road G':[28.995,77.687]
    };
    if(m.layers.emerg) (c.incidents||[]).forEach(i=>{
      const pos=coords[i.road]; if(!pos)return;
      const query=String(c.q||'').toLowerCase();
      const congestion=(c.roads||[]).find(r=>r.name===i.road);
      if(query && !String(i.road||'').toLowerCase().includes(query) && !String(i.type||'').toLowerCase().includes(query) && !String(i.id||'').includes(query)) return;
      if(c.cong && c.cong!=='ALL' && congestion && String(congestion.status||congestion.congestion||'').toUpperCase()!==c.cong && String(congestion.congestion||'').toUpperCase()!==c.cong) return;
      const color=String(i.severity||'MEDIUM').toUpperCase()==='CRITICAL'?'#ff4b5c':
        String(i.severity||'').toUpperCase()==='HIGH'?'#ff8a3d':
        String(i.severity||'').toUpperCase()==='LOW'?'#2fd3a0':'#f4c542';
      const marker=L.circleMarker(pos,{radius:8,color:'#fff',weight:2,fillColor:color,fillOpacity:.95}).addTo(markerLayer);
      marker.bindPopup(`<b>${esc(i.type||'INCIDENT')} #${i.id}</b><br>${esc(i.road||'Location not provided')}<br>Severity: ${esc(i.severity||'UNKNOWN')}<br>Status: ${esc(i.status||'UNKNOWN')}<br><small>Demo coordinate near Meerut; not a verified incident GPS location.</small>`);
      marker.on('click',()=>{m.sel={type:'inc',id:i.id}; if(c.onSelect)c.onSelect(m.sel);});
    });
  }};
  el.querySelectorAll('[data-m="layers"]').forEach(b=>b.addEventListener('click',()=>{m.layers.emerg=!m.layers.emerg;m.update();}));
  el.querySelectorAll('[data-m="locate"]').forEach(b=>b.addEventListener('click',()=>{
    if(!navigator.geolocation){alert('Geolocation is not supported by this browser.');return;}
    navigator.geolocation.getCurrentPosition(pos=>map.setView([pos.coords.latitude,pos.coords.longitude],15),()=>alert('Location permission denied or location unavailable.'));
  }));
  maps[id]=m; m.update(); setTimeout(()=>map.invalidateSize(),100); return m;
}
const mapBox = (id, tall) => `<div class="map${tall ? ' tall' : ''}" id="${id}"><div style="display:grid;place-items:center;height:100%;color:var(--tx3)">${ic('map',22)}&nbsp; Loading city map…</div></div>`;

/* ============================ SHELL COMPONENTS ============================ */
const NAV = [['command','COMMAND CENTER','dash'],['emergencies','EMERGENCIES','siren'],['traffic','TRAFFIC','traffic'],['ai','AI INTELLIGENCE','brain'],['map','CITY MAP','map'],['analytics','ANALYTICS','chart']];
const TITLES = {
  command:['COMMAND CENTER','Real-time emergency and traffic intelligence'],
  emergencies:['EMERGENCIES','Monitor and manage active city incidents.'],
  incident:['INCIDENT','Emergency overview and AI decision support'],
  traffic:['TRAFFIC INTELLIGENCE','Live city traffic conditions and road status.'],
  ai:['AI INTELLIGENCE','Emergency analysis and decision-support engine.'],
  map:['CITY MAP','Live emergency and traffic intelligence.'],
  analytics:['CITY ANALYTICS','Historical traffic and emergency intelligence.'],
  settings:['SETTINGS','Data source, demo controls and system information.']
};
function health() {
  const ws = S.conn === 'live' ? ['CONNECTED','ok'] : S.conn === 'reconnecting' ? ['RECONNECTING','warn'] : ['OFFLINE','bad'];
  const h = MOCK.health, aiS = sim.aiDown ? ['UNAVAILABLE','bad'] : [h.ai,'ok'];
  const list = [['Backend API', sim.apiFail ? ['UNREACHABLE','bad'] : [h.backend,'ok'], 'server'], ['Database', sim.apiFail ? ['UNKNOWN','warn'] : [h.database,'ok'], 'db'], ['AI Engine', aiS, 'brain'], ['Traffic WebSocket', ws, 'wifi'], ['Frontend', [h.frontend,'ok'], 'activity']];
  const bad = list.some(x => x[1][1] === 'bad'), warn = list.some(x => x[1][1] === 'warn');
  return { list, level: bad ? 'bad' : warn ? 'warn' : 'ok', text: bad ? 'SERVICE DISRUPTION' : warn ? 'PARTIAL DEGRADATION' : 'ALL SYSTEMS OPERATIONAL' };
}
function renderSide() {
  const hl = health(), n = activeInc().length;
  $('#side').className = 'side' + (S.side ? ' open' : ''); $('#backdrop').className = 'backdrop' + (S.side ? ' open' : '');
  const item = ([k,l,i]) => `<a class="nav${S.route.name === k || (k === 'emergencies' && S.route.name === 'incident') ? ' on' : ''}" href="#/${k}">${ic(i)}<span>${l}</span>${k === 'emergencies' && n ? `<span class="cnt">${n}</span>` : ''}</a>`;
  $('#side').innerHTML = `<div class="brand"><div class="logo">${ic('brain',22)}</div><div><b>AI CITY BRAIN</b><small>Emergency Intelligence Platform</small></div></div>
    <div class="online"><span class="dot live"></span>SYSTEM ONLINE</div>
    ${NAV.map(item).join('')}<div class="grp">SYSTEM</div>${item(['settings','SETTINGS','gear'])}
    <div class="sysc"><h6 class="${hl.level}"><span class="dot ${hl.level === 'ok' ? 'live' : ''}"></span>${hl.text}</h6>${hl.list.filter(x => x[0] !== 'Frontend' && x[0] !== 'Traffic WebSocket').concat([hl.list[3]]).map(([l,[t,c]]) => `<div class="sysrow"><span>${l.replace('Traffic WebSocket','Traffic Feed').replace('Backend API','Backend')}</span><i class="${c}">${t}</i></div>`).join('')}</div>`;
}
function connPill() {
  return S.conn === 'live' ? `<span class="pill ok"><span class="dot live" style="color:var(--green)"></span><span class="ok">LIVE</span></span>`
    : S.conn === 'reconnecting' ? `<span class="pill warn"><span class="dot hollow warn"></span><span class="warn">RECONNECTING</span></span>`
    : `<span class="pill bad"><span class="dot bad"></span><span class="bad">OFFLINE</span></span>`;
}
function renderTop() {
  const [t, d] = S.route.name === 'incident' ? [`INCIDENT #${S.route.id}`, TITLES.incident[1]] : TITLES[S.route.name], hl = health();
  $('#top').innerHTML = `<button class="ibtn menu-btn" data-act="toggleSide" aria-label="Open menu">${ic('menu')}</button>
    <div><h1>${t}</h1><p>${d}</p></div><div class="sp"></div>
    <div class="tools">${CONFIG.USE_MOCK ? `<span class="demo hide-m">${ic('zap',13)}DEMO DATA</span>` : ''}${connPill()}
    <span class="pill hide-m hide-s ${hl.level}" title="${hl.text}"><span class="dot ${hl.level}" style="color:currentColor"></span><span class="${hl.level}">${hl.level === 'ok' ? 'SYSTEMS OK' : hl.level === 'warn' ? 'DEGRADED' : 'DISRUPTION'}</span></span>
    <span class="clock" id="clock">${new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' })}</span>
    <button class="ibtn" data-act="toggleNotif" aria-label="Notifications">${ic('bell')}${S.unread ? `<span class="badge-n">${S.unread > 9 ? '9+' : S.unread}</span>` : ''}</button>
    <button class="ibtn ${S.refreshing ? 'spin' : ''}" data-act="refresh" aria-label="Refresh data">${ic('refresh')}</button>
    <div class="avatar" title="Operator">OP</div></div>`;
  $('#banner').innerHTML = S.conn === 'reconnecting' ? `<div class="banner warn">${ic('wifi',16)}Live traffic connection lost. Reconnecting… showing last known data.</div>`
    : S.conn === 'offline' ? `<div class="banner bad">${ic('alert',16)}Live traffic feed unavailable. The dashboard is still usable with last known data.</div>` : '';
}
function renderNotif() {
  const o = $('#notif');
  if (!S.notifOpen) { o.innerHTML = ''; return; }
  o.innerHTML = `<div class="notif"><div class="ch"><h3>${ic('bell',15)}NOTIFICATIONS</h3><button class="btn sm" data-act="readAll">Mark all read</button></div><div style="overflow-y:auto">${S.notifs.map((n, i) => { const [i2, c] = NK[n.kind] || NK.system; return `<div class="nit ${i < S.unread ? 'unread' : ''}"><div class="ico" style="background:var(--${{r:'red',o:'orange',c:'cyan',g:'green'}[c]}-a);color:var(--${{r:'red',o:'orange',c:'cyan',g:'green'}[c]})">${ic(i2,17)}</div><div><b>${esc(n.title)}</b><span>${esc(n.sub)} · ${relS(n.at)}</span></div></div>`; }).join('')}</div></div>`;
}

/* ============================ SKELETON / STATES ============================ */
const skeleton = () => `<div class="grid g4">${[1,2,3,4].map(() => `<div class="card pad">${sk('40px','40px')}${sk('90px','38px','margin:16px 0 8px')}${sk('70%','14px')}</div>`).join('')}</div>
  <div class="grid split mt"><div class="card" style="height:520px;display:grid;place-items:center;color:var(--tx3)">${ic('map',24)}<span style="margin-top:8px">Loading city data…</span></div><div class="card pad">${[1,2,3].map(() => sk('100%','108px','margin-bottom:10px')).join('')}</div></div>`;
const errorState = () => `<div class="card"><div class="empty err"><div class="big">${ic('alert',24)}</div><b>UNABLE TO LOAD CITY DATA</b><span>${esc(S.error)}. The command center could not reach the backend.</span><button class="btn cy" style="margin-top:12px" data-act="retry">${ic('refresh',15)}Retry</button></div></div>`;
const noActive = () => `<div class="empty"><div class="big">${ic('check',24)}</div><b>NO ACTIVE EMERGENCIES</b><span>All monitored incidents are currently resolved.</span></div>`;

/* ================================ VIEWS ================================ */
function trafficStats() {
  const R = S.roads, blocked = R.filter(r => r.status === 'BLOCKED').length, high = R.filter(r => r.status !== 'BLOCKED' && r.congestion === 'HIGH').length;
  return { total:R.length, open:R.length - blocked, blocked, high, low:R.filter(r => r.status !== 'BLOCKED' && r.congestion === 'LOW').length, med:R.filter(r => r.status !== 'BLOCKED' && r.congestion === 'MEDIUM').length };
}
function kpis() {
  const a = activeInc(), t = trafficStats(), hi = a.filter(i => SEVR[i.severity] >= 3).length, med = a.filter(i => i.severity === 'MEDIUM').length, low = a.length - hi - med;
  const lvl = t.high >= 3 ? 'HIGH' : (t.high >= 1 || t.med >= 3) ? 'MEDIUM' : 'LOW', tc = { HIGH:'o', MEDIUM:'y', LOW:'g' }[lvl];
  const aiOK = !sim.aiDown;
  const card = (cls, lab, ico, v, s, vc) => `<div class="card kpi ${cls}"><div class="row"><span class="lab">${lab}</span><span class="ico">${ic(ico,20)}</span></div><div class="v" ${vc ? `style="color:${vc}"` : ''}>${v}</div><div class="s">${s}</div></div>`;
  return card(a.length ? 'r' : 'g', 'ACTIVE EMERGENCIES', 'siren', String(a.length).padStart(2,'0'), a.length ? [hi ? `${hi} High priority` : '', med ? `${med} Medium` : '', low ? `${low} Low` : ''].filter(Boolean).join(' · ') : 'No open incidents')
    + card(tc, 'TRAFFIC STATUS', 'traffic', lvl, `${t.high} congested road${t.high === 1 ? '' : 's'}`)
    + card(t.blocked ? 'r' : 'c', 'CITY ROADS', 'route', String(t.total).padStart(2,'0'), `${t.open} Open · ${t.blocked} Blocked`)
    + card(aiOK ? 'c' : 'o', 'AI BRAIN', 'brain', aiOK ? 'ACTIVE' : 'DEGRADED', aiOK ? `Last analysis: ${relS(S.lastUpdate)}` : 'Using traffic data only', aiOK ? 'var(--cyan)' : 'var(--orange)');
}
function incCard(i) {
  return `<div class="icard ${i.severity}" role="button" tabindex="0" data-act="viewIncident" data-arg="${i.id}">
    <div class="t"><div class="itype ${i.severity === 'MEDIUM' ? 'MEDIUM' : i.severity === 'LOW' ? 'LOW' : ''}">${ic(typeIcon(i.type),18)}</div><div style="flex:1;min-width:0"><h4>${esc(i.type)}</h4><div class="loc">${esc(i.road)}</div></div>${bd(i.severity)}</div>
    <div class="meta">${bd(i.status, 1)}${i.vehicles_involved ? `<span class="loc">${i.vehicles_involved} vehicles involved</span>` : ''}</div>
    <div class="ft"><span>${relS(i.reported_at)}</span><span class="btn sm cy" style="pointer-events:none">VIEW INCIDENT</span></div></div>`;
}
const activePanel = () => { const a = activeInc(); return a.length ? a.map(incCard).join('') : noActive(); };
function situation() {
  const a = activeInc(), t = trafficStats(), p = primaryInc();
  if (!a.length) return `<div class="sit calm"><span class="ok">${ic('check',26)}</span><div class="st"><b>No active emergencies</b><span>${t.blocked} road${t.blocked === 1 ? '' : 's'} blocked · ${t.high} congested</span></div><button class="btn" data-act="openReport">${ic('plus',15)}Report emergency</button></div>`;
  const hi = a.filter(i => SEVR[i.severity] >= 3).length;
  return `<div class="sit"><span class="bad">${ic('siren',28)}</span><div class="st"><b>${a.length} active emergenc${a.length === 1 ? 'y' : 'ies'}${hi ? `, ${hi} high priority` : ''}</b><span>${t.blocked} road${t.blocked === 1 ? '' : 's'} blocked · ${t.high} congested${p && p.ai && !sim.aiDown ? ` · AI recommends <b style="color:var(--cyan)">${esc(p.ai.recommended_route)}</b> for ${esc(p.type.toLowerCase())} on ${esc(p.road)}` : ''}</span></div><button class="btn pri" data-act="openReport">${ic('plus',15)}Report emergency</button></div>`;
}
function healthCard() { const hl = health(); return `<div class="sysgrid">${hl.list.map(([l,[t,c],i]) => `<div class="sysrow" style="padding:9px 0;border-bottom:1px solid var(--line)"><span style="display:flex;gap:10px;align-items:center">${ic(i,16)}${l}</span><i class="${c}" style="font-style:normal;font-weight:700;letter-spacing:.08em;font-size:11px;display:flex;gap:7px;align-items:center"><span class="dot ${c === 'ok' ? '' : 'hollow'}"></span>${t}</i></div>`).join('')}</div>`; }
function trafficActivity() { const w = S.totals.slice(-24); return `<div style="display:flex;justify-content:space-between;align-items:baseline"><div><span style="font-size:26px;font-weight:800">${w[w.length-1] ?? '–'}</span> <span class="lab">vehicles on monitored roads</span></div><span class="bd ai dotted">LIVE</span></div>${lineChart([{ vals:w.length > 1 ? w : [0,0], color:'var(--cyan)' }], w.map((_, i) => ''), { h:140 })}`; }
function emergencyActivity() { const d = dayVolume(); return barChart(d.vals, d.labels, { h:170, color:'var(--orange)' }); }
function dayVolume() { const vals = [], labels = []; for (let k = 6; k >= 0; k--) { const s = new Date(); s.setHours(0,0,0,0); s.setDate(s.getDate() - k); const t0 = s.getTime(); vals.push(S.incidents.filter(i => i.reported_at >= t0 && i.reported_at < t0 + 864e5).length); labels.push(k === 0 ? 'Today' : s.toLocaleDateString([], { weekday:'short' })); } return { vals, labels }; }
function viewCommand() {
  return `<div id="sit">${situation()}</div><div class="grid g4 keep2" id="kpis">${kpis()}</div>
  <div class="grid split mt"><div class="card"><div class="ch"><h3>${ic('map',15)}LIVE CITY OVERVIEW</h3><span class="lab">Select a road or marker</span></div>${mapBox('map1')}</div>
  <div class="card"><div class="ch"><h3>${ic('siren',15)}ACTIVE EMERGENCIES</h3><span class="bd ${activeInc().length ? 'ACTIVE' : 'RESOLVED'}">${activeInc().length}</span></div><div class="plist" id="plist">${activePanel()}</div></div></div>
  <div class="grid g3 mt"><div class="card pad"><div class="h" style="margin-bottom:12px">${ic('activity',15)}TRAFFIC ACTIVITY</div><div id="tact">${trafficActivity()}</div></div>
  <div class="card pad"><div class="h" style="margin-bottom:12px">${ic('chart',15)}EMERGENCY ACTIVITY · 7 DAYS</div>${emergencyActivity()}</div>
  <div class="card pad"><div class="h" style="margin-bottom:8px">${ic('shield',15)}SYSTEM HEALTH</div><div id="hcard">${healthCard()}</div></div></div>`;
}
function mountCommand() {
  const p = () => primaryInc();
  mountMap('map1', () => ({ roads:S.roads, incidents:activeInc(), route:!sim.aiDown && p() && p().ai ? p().ai.recommended_route : null, popup:true }));
}
function liveCommand() {
  const k = $('#kpis'); if (!k) return;
  $('#sit').innerHTML = situation(); k.innerHTML = kpis(); $('#tact').innerHTML = trafficActivity(); $('#hcard').innerHTML = healthCard();
  maps.map1 && maps.map1.update();
}

/* ---- emergencies ---- */
function filteredInc() {
  const f = S.f, q = f.q.trim().toLowerCase();
  let l = S.incidents.filter(i => (f.status === 'ALL' || (f.status === 'ACTIVE' ? i.status === 'ACTIVE' || i.status === 'REPORTED' : i.status === f.status)) && (f.sev === 'ALL' || i.severity === f.sev) && (f.type === 'ALL' || i.type === f.type)
    && (!q || `${i.id} ${i.type} ${i.road} ${i.status}`.toLowerCase().includes(q)));
  l.sort(f.sort === 'OLDEST' ? (a,b) => a.reported_at - b.reported_at : f.sort === 'SEVERITY' ? (a,b) => SEVR[b.severity] - SEVR[a.severity] || b.reported_at - a.reported_at : (a,b) => b.reported_at - a.reported_at);
  return l;
}
function incRows() {
  const l = filteredInc();
  if (!l.length) return `<div class="empty"><div class="big" style="background:var(--cyan-a);color:var(--cyan)">${ic('search',22)}</div><b>NO INCIDENTS MATCH</b><span>Try clearing a filter or search term.</span><button class="btn sm" style="margin-top:8px" data-act="clearF">Clear filters</button></div>`;
  return `<div class="trow h cols-e"><span>ID</span><span>TYPE</span><span>LOCATION</span><span>SEVERITY</span><span>STATUS</span><span>TIME</span><span></span></div>`
    + l.map(i => `<div class="trow cols-e" role="button" tabindex="0" data-act="viewIncident" data-arg="${i.id}"><span class="mono" data-l="ID">#${i.id}</span><span class="rname" data-l="TYPE"><span class="itype ${i.severity === 'MEDIUM' ? 'MEDIUM' : i.severity === 'LOW' ? 'LOW' : ''}" style="width:30px;height:30px">${ic(typeIcon(i.type),15)}</span>${esc(cap(i.type))}</span><span data-l="LOCATION">${esc(i.road)}</span><span data-l="SEVERITY">${bd(i.severity)}</span><span data-l="STATUS">${bd(i.status,1)}</span><span style="color:var(--tx2)" data-l="TIME">${relS(i.reported_at)}</span><span><button class="btn sm cy" tabindex="-1">View</button></span></div>`).join('');
}
function viewEmergencies() {
  const f = S.f, sel = (k, opts, lab) => `<select class="sel" data-in="f_${k}" aria-label="${lab}">${opts.map(([v,l]) => `<option value="${v}" ${f[k] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  return `<div class="mtools"><div class="search">${ic('search',16)}<input class="inp" data-in="f_q" value="${esc(f.q)}" placeholder="Search incidents by ID, type or road" aria-label="Search incidents"></div>
    ${sel('status',[['ALL','All status'],['ACTIVE','Active'],['RESPONDING','Responding'],['RESOLVED','Resolved']],'Status')}${sel('sev',[['ALL','All severity'],['CRITICAL','Critical'],['HIGH','High'],['MEDIUM','Medium'],['LOW','Low']],'Severity')}
    ${sel('type',[['ALL','All types'],['ACCIDENT','Accident'],['FIRE','Fire'],['MEDICAL','Medical'],['OTHER','Other']],'Type')}${sel('sort',[['NEWEST','Newest'],['OLDEST','Oldest'],['SEVERITY','Highest severity']],'Sort')}
    <button class="btn pri" data-act="openReport">${ic('plus',15)}Report emergency</button></div>
    <div class="card" id="erows">${incRows()}</div>`;
}

/* ---- incident detail ---- */
const STAGES = [['REPORTED','flag'],['ACTIVE','siren'],['RESPONDING','route'],['RESOLVED','check']];
const PIPE = [['INCIDENT','alert','Incident received','Incident understood'],['UNDERSTANDING','eye','Reading the report','Report context extracted'],['SEVERITY','gauge','Assessing priority','Severity assessed'],['TRAFFIC IMPACT','traffic','Evaluating traffic','Traffic evaluated, blocked roads excluded'],['ROUTE RECOMMENDATION','route','Selecting a route','Route recommended']];
function pipeHTML(step, stages = PIPE) {
  return `<div class="pipe">${stages.map(([t,i,run,done], k) => { const st = k < step ? 'done' : k === step ? 'run' : ''; return `<div class="pst ${st}"><i>${st === 'done' ? ic('check',17) : ic(i,17)}</i><div><b>${t}</b><span>${st === 'done' ? '✓ ' + done : st === 'run' ? run + '…' : 'Waiting'}</span></div></div>`; }).join('')}</div>`;
}
function aiResult(i) {
  const a = i.ai; if (!a) return `<div class="empty"><b>NO AI ANALYSIS</b><span>The backend did not return an analysis for this incident.</span></div>`;
  const rr = roadBy(a.recommended_route), stale = rr && (rr.status === 'BLOCKED' || rr.congestion === 'HIGH');
  return `<div class="grid g2"><div class="res"><div class="lab">SEVERITY</div><div class="v">${bd(i.severity)}</div></div><div class="res"><div class="lab">TRAFFIC IMPACT</div><div class="v">${bd(a.traffic_impact)}</div></div></div>
  <div class="res route mt" style="margin-top:12px"><div class="lab" style="color:var(--cyan)">RECOMMENDED ROUTE</div><div class="v">${esc(a.recommended_route)}</div>${rr ? `<div style="color:var(--tx2);font-size:12.5px;margin-top:4px">Currently ${rr.congestion.toLowerCase()} congestion · ${rr.vehicle_count} vehicles · ${rr.average_speed} km/h</div>` : ''}${stale ? `<div class="warn" style="font-size:12.5px;margin-top:8px">${ic('alert',14)} Live conditions on this road have changed. Review before use.</div>` : ''}</div>
  <div class="res" style="margin-top:12px"><div class="lab">AFFECTED ROADS</div><div style="margin-top:8px">${a.affected_roads.map(r => `<span class="chip">${esc(r)}</span>`).join('') || '<span style="color:var(--tx3)">Not provided</span>'}</div></div>
  <div class="why" style="margin-top:12px"><div class="lab" style="color:var(--cyan)">WHY THIS ROUTE?</div><q>${esc(a.reason)}</q><div class="note">${ic('brain',15)}<span><b style="color:var(--cyan)">AI RECOMMENDATION</b> — a decision-support suggestion based on available traffic data. Responders make the final decision.</span></div></div>`;
}
function aiFallback(i) {
  const bad = S.roads.filter(r => r.status === 'BLOCKED' || r.congestion === 'HIGH').map(r => `${r.name} (${r.status === 'BLOCKED' ? 'blocked' : 'high'})`);
  return `<div class="empty err"><div class="big">${ic('brain',24)}</div><b>AI ANALYSIS UNAVAILABLE</b><span>Use the available incident and traffic information instead.</span></div>
   <div class="res"><div class="lab">SEVERITY (REPORTED)</div><div class="v">${bd(i.severity)}</div></div><div class="res" style="margin-top:12px"><div class="lab">ROADS NEEDING ATTENTION NOW</div><div style="margin-top:8px">${bad.map(b => `<span class="chip">${esc(b)}</span>`).join('') || 'None'}</div></div>`;
}
function viewIncident() {
  const i = S.incidents.find(x => x.id === +S.route.id);
  if (!i) return `<div class="card"><div class="empty err"><div class="big">${ic('alert',24)}</div><b>INCIDENT NOT FOUND</b><span>No incident #${esc(S.route.id)} exists.</span><a class="btn cy" href="#/emergencies" style="margin-top:10px">Back to emergencies</a></div></div>`;
  const na = v => v == null ? `<dd class="na">Not provided</dd>` : `<dd>${v}</dd>`, yn = v => v == null ? null : v ? 'Yes' : 'No';
  const idx = STAGES.findIndex(s => s[0] === i.status);
  const pri = SEVR[i.severity] >= 3 ? `${i.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH'} PRIORITY` : i.severity + ' PRIORITY';
  return `<a href="#/emergencies" class="btn sm" style="margin-bottom:14px">${ic('arrow',14).replace('<svg','<svg style="transform:rotate(180deg)"')}All emergencies</a>
  <div class="card hero-i"><div class="itype ${i.severity === 'MEDIUM' ? 'MEDIUM' : i.severity === 'LOW' ? 'LOW' : ''}">${ic(typeIcon(i.type),26)}</div>
   <div style="flex:1;min-width:200px"><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:6px">${bd(i.severity)}<span class="lab ${SEVR[i.severity] >= 3 && isOpenInc(i) ? 'bad' : ''}" style="font-weight:700">${pri}</span>${bd(i.status,1)}</div>
   <div style="font-size:22px;font-weight:800;letter-spacing:.04em">${esc(i.type)} <span style="color:var(--tx3);font-weight:500">on</span> ${esc(i.road)}</div><div style="color:var(--tx2)">Reported ${fmtDT(i.reported_at)} · ${relS(i.reported_at)} · ID #${i.id}</div></div>
   <button class="btn cy" data-act="showOnMap" data-arg="${i.id}">${ic('map',15)}View on city map</button></div>
  <div class="grid split2 mt">
   <div><div class="card"><div class="ch"><h3>INCIDENT INFORMATION</h3></div><dl class="kv" style="margin:0">
     <div><dt>INCIDENT TYPE</dt>${na(cap(i.type))}</div><div><dt>LOCATION</dt>${na(esc(i.road))}</div>
     <div><dt>VEHICLES INVOLVED</dt>${na(i.vehicles_involved)}</div><div><dt>LANES BLOCKED</dt>${na(i.lanes_blocked)}</div>
     <div><dt>AMBULANCE REQUIRED</dt>${na(yn(i.ambulance_required))}</div><div><dt>REPORTED</dt>${na(clock(i.reported_at))}</div>
     <div><dt>STATUS</dt>${na(cap(i.status))}</div><div><dt>${i.resolved_at ? 'RESOLVED' : 'ADDITIONAL INFORMATION'}</dt>${na(i.resolved_at ? clock(i.resolved_at) : i.description ? esc(i.description) : null)}</div></dl></div>
    <div class="card pad mt"><div class="h" style="margin-bottom:14px">INCIDENT STATUS</div>
     <div class="tl">${STAGES.map(([s,ico], k) => `<div class="s ${k < idx ? 'done' : k === idx ? 'cur' : ''}"><i>${k < idx || (k === idx && s === 'RESOLVED') ? ic('check',16) : ic(ico,16)}</i>${s}</div>`).join('')}</div>
     <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px">${i.status === 'RESOLVED' ? `<span class="btn gr" style="pointer-events:none">${ic('check',16)}INCIDENT RESOLVED</span>`
       : `<button class="btn bl" data-act="confirmStatus" data-arg="${i.id}|RESPONDING" ${i.status === 'RESPONDING' ? 'disabled' : ''}>MARK RESPONDING</button><button class="btn gr" data-act="confirmStatus" data-arg="${i.id}|RESOLVED">MARK RESOLVED</button>`}</div></div></div>
   <div class="card"><div class="ch"><h3>${ic('brain',15)}AI EMERGENCY ANALYSIS</h3><span id="aist"></span></div><div class="pad" style="padding:18px" id="aibody"></div></div></div>`;
}
function mountIncident() {
  const i = S.incidents.find(x => x.id === +S.route.id); if (!i) return;
  const body = $('#aibody'), st = $('#aist');
  if (sim.aiDown) { st.innerHTML = `<span class="bd BLOCKED dotted">UNAVAILABLE</span>`; body.innerHTML = aiFallback(i); return; }
  if (!i.ai) { st.innerHTML = `<span class="bd REPORTED">NO DATA</span>`; body.innerHTML = aiResult(i); return; }
  const key = i.id, draw = () => {
    if (S.route.name !== 'incident' || +S.route.id !== key || !$('#aibody')) return;
    const step = S.aiDone[key] ? 99 : (S.aiStep[key] || 0);
    if (step >= PIPE.length) { $('#aist').innerHTML = `<span class="bd ai dotted">ANALYSIS COMPLETE</span>`; $('#aibody').innerHTML = `<div style="margin-bottom:20px">${pipeHTML(99)}</div>` + aiResult(S.incidents.find(x => x.id === key)); return; }
    $('#aist').innerHTML = `<span class="bd ai">ANALYZING EMERGENCY…</span>`; $('#aibody').innerHTML = pipeHTML(step);
    S.aiStep[key] = step + 1; setTimeout(() => { if (S.aiStep[key] >= PIPE.length) S.aiDone[key] = true; draw(); }, 420);
  };
  if (S.aiDone[key]) { S.aiStep[key] = 99; } else S.aiStep[key] = 0;
  draw();
}
function liveIncident() { const i = S.incidents.find(x => x.id === +S.route.id); if (i && S.aiDone[i.id] && !sim.aiDown && i.ai) $('#aibody').innerHTML = `<div style="margin-bottom:20px">${pipeHTML(99)}</div>` + aiResult(i); }

/* ---- traffic ---- */
function trafRows() {
  const l = S.roads.filter(r => S.tf === 'ALL' || (S.tf === 'BLOCKED' ? r.status === 'BLOCKED' : r.status !== 'BLOCKED' && r.congestion === S.tf)).sort((a,b) => ({BLOCKED:4,HIGH:3,MEDIUM:2,LOW:1}[rcong(b)] - {BLOCKED:4,HIGH:3,MEDIUM:2,LOW:1}[rcong(a)]) || b.vehicle_count - a.vehicle_count);
  if (!l.length) return `<div class="empty"><b>NO ROADS IN THIS FILTER</b><span>Choose another filter.</span></div>`;
  return `<div class="trow h cols-t"><span>ROAD</span><span>VEHICLES</span><span>AVERAGE SPEED</span><span>CONGESTION</span><span>STATUS</span><span></span></div>` + l.map(r => `<div class="trow cols-t" role="button" tabindex="0" data-act="openRoad" data-arg="${esc(r.name)}"><span class="rname" data-l="ROAD"><i style="width:9px;height:9px;border-radius:50%;background:${covar(rcong(r))};display:inline-block"></i>${esc(r.name)}</span>
    <span data-l="VEHICLES"><b>${r.vehicle_count}</b><div class="bar" style="margin-top:5px;max-width:110px"><i style="width:${Math.min(100, r.vehicle_count)}%;background:${covar(rcong(r))}"></i></div></span><span data-l="AVERAGE SPEED">${r.average_speed} km/h</span><span data-l="CONGESTION">${bd(r.congestion)}</span><span data-l="STATUS">${bd(r.status)}</span><span style="color:var(--tx3)">${ic('arrow',15)}</span></div>`).join('');
}
function tstats() {
  const t = trafficStats(), c = (cls, l, v, s, ico) => `<div class="card kpi ${cls}"><div class="row"><span class="lab">${l}</span><span class="ico">${ic(ico,20)}</span></div><div class="v">${String(v).padStart(2,'0')}</div><div class="s">${s}</div></div>`;
  return c('c','TOTAL ROADS',t.total,`${t.open} open`,'route') + c(t.high ? 'o' : 'g','HIGH CONGESTION',t.high,'Open roads at high load','traffic') + c(t.blocked ? 'r' : 'g','BLOCKED ROADS',t.blocked,t.blocked ? 'Excluded from AI routes' : 'None','ban') + c('g','LOW TRAFFIC',t.low,'Free-flowing','gauge');
}
function alertsPanel() {
  const l = S.roads.filter(r => r.status === 'BLOCKED' || r.congestion === 'HIGH');
  return l.length ? l.map(r => `<div class="sysrow" style="padding:10px 0;border-bottom:1px solid var(--line);cursor:pointer" data-act="openRoad" data-arg="${esc(r.name)}"><span class="rname">${ic(r.status === 'BLOCKED' ? 'ban' : 'traffic',16)}${esc(r.name)}</span>${bd(rcong(r))}</div>`).join('')
    : `<div class="empty"><div class="big">${ic('check',22)}</div><b>TRAFFIC CONDITIONS NORMAL</b><span>No high congestion or blocked roads.</span></div>`;
}
function viewTraffic() {
  return `<div class="grid g4 keep2" id="tstats">${tstats()}</div><div class="grid split mt"><div>
   <div class="mtools" style="margin-bottom:12px">${['ALL','HIGH','MEDIUM','LOW','BLOCKED'].map(f => `<button class="btn sm ${S.tf === f ? 'cy' : ''}" data-act="tfilter" data-arg="${f}">${f === 'ALL' ? 'All roads' : cap(f)}</button>`).join('')}<span class="sp" style="flex:1"></span><span class="pill" id="tconn">${S.conn === 'live' ? '<span class="dot live ok"></span><span class="ok">LIVE DATA</span>' : '<span class="warn">LAST KNOWN DATA</span>'}</span></div>
   <div class="card" id="trows">${trafRows()}</div></div>
   <div class="card"><div class="ch"><h3>${ic('alert',15)}TRAFFIC ALERTS</h3></div><div style="padding:8px 18px 14px" id="talerts">${alertsPanel()}</div></div></div>`;
}
function liveTraffic() { if (!$('#tstats')) return; $('#tstats').innerHTML = tstats(); $('#trows').innerHTML = trafRows(); $('#talerts').innerHTML = alertsPanel(); $('#tconn').innerHTML = S.conn === 'live' ? '<span class="dot live ok"></span><span class="ok">LIVE DATA</span>' : '<span class="warn">LAST KNOWN DATA</span>'; drawRoad(); }
function drawRoad() {
  const d = $('#ovl .drawer'); if (!d || !S.drawer) return;
  const r = roadBy(S.drawer); if (!r) return;
  const hist = (S.roadHist[r.name] || []), inc = S.incidents.filter(i => i.road === r.name && isOpenInc(i));
  d.innerHTML = `<div class="mh"><div><h2>${esc(r.name.toUpperCase())}</h2><p>Road detail</p></div><button class="ibtn" data-act="closeOvl" aria-label="Close">${ic('x')}</button></div>
   <div style="display:flex;gap:8px;margin:12px 0 18px;flex-wrap:wrap">${bd(r.status)}${bd(r.congestion)}${S.conn === 'live' ? `<span class="bd ai dotted">LIVE DATA</span>` : `<span class="bd MEDIUM">LAST KNOWN</span>`}</div>
   <div class="grid g2"><div class="res"><div class="lab">VEHICLE COUNT</div><div class="v">${r.vehicle_count}</div></div><div class="res"><div class="lab">AVERAGE SPEED</div><div class="v">${r.average_speed}<span style="font-size:13px;color:var(--tx3)"> km/h</span></div></div></div>
   <div class="h" style="margin:22px 0 10px">TRAFFIC CONDITION</div>
   <div class="lab" style="display:flex;justify-content:space-between;margin-bottom:5px"><span>Vehicle density</span><span>${r.vehicle_count} / 100</span></div><div class="bar"><i style="width:${Math.min(100, r.vehicle_count)}%;background:${covar(rcong(r))}"></i></div>
   <div class="lab" style="display:flex;justify-content:space-between;margin:14px 0 5px"><span>Speed vs 60 km/h free flow</span><span>${Math.round(r.average_speed / 60 * 100)}%</span></div><div class="bar"><i style="width:${Math.min(100, r.average_speed / 60 * 100)}%;background:var(--cyan)"></i></div>
   ${r.status === 'BLOCKED' ? `<div class="banner bad" style="margin:16px 0 0;border-radius:10px;padding:10px 14px">${ic('ban',16)}This road is blocked and excluded from AI route recommendations.</div>` : ''}
   <div class="h" style="margin:22px 0 6px">VEHICLE COUNT · RECENT</div>${hist.length > 2 ? spark(hist, covar(rcong(r)), 60) : '<div class="lab">Waiting for live updates…</div>'}
   <div style="color:var(--tx3);font-size:12.5px;margin-top:8px">Traffic condition updated ${relS(S.roadTs[r.name] || S.lastUpdate)}</div>
   ${inc.length ? `<div class="h" style="margin:22px 0 8px">ACTIVE INCIDENTS ON THIS ROAD</div>${inc.map(incCard).join('')}` : ''}`;
}

/* ---- AI page ---- */
const MODS = [['INCIDENT UNDERSTANDING','eye','Understand the emergency report.'],['SEVERITY ANALYSIS','gauge','Determine incident priority.'],['TRAFFIC IMPACT','traffic','Identify affected/congested roads.'],['ROUTE RECOMMENDATION','route','Recommend an available lower-congestion road.']];
function viewAI() {
  const list = S.incidents.filter(i => i.ai || true), sel = S.incidents.find(i => i.id === S.aiSel) || primaryInc() || S.incidents[0];
  if (sel) S.aiSel = sel.id;
  const a = sel && sel.ai, ok = !sim.aiDown;
  const latest = [sel ? `${esc(cap(sel.type))} on ${esc(sel.road)}` : '–', sel ? bd(sel.severity) : '–', a ? bd(a.traffic_impact) : '–', a ? `<b style="color:var(--cyan)">${esc(a.recommended_route)}</b>` : '–'];
  return `<div class="card aihero"><div class="core">${ic('brain',40)}</div><div><h2>AI CITY BRAIN</h2><div style="margin:8px 0" class="${ok ? 'ok' : 'bad'}"><span class="bd ${ok ? 'ai' : 'BLOCKED'} dotted">${ok ? 'AI ENGINE ONLINE' : 'AI ENGINE UNAVAILABLE'}</span></div><p>Turning emergency and traffic data into actionable recommendations.</p></div></div>
  <div class="card pad mt"><div class="h" style="margin-bottom:14px">DECISION PIPELINE</div><div class="hpipe">${[['EMERGENCY','siren'],['INCIDENT UNDERSTANDING','eye'],['SEVERITY ANALYSIS','gauge'],['TRAFFIC IMPACT','traffic'],['ROUTE RECOMMENDATION','route'],['RESPONDER ACTION','user']].map(([t,i]) => `<div class="hstep"><i>${ic(i,18)}</i><b>${t}</b></div>`).join('')}</div>
  <div class="note" style="margin-top:14px">${ic('shield',15)}<span>The AI supports responders with recommendations. It does not dispatch vehicles or control any emergency service.</span></div></div>
  <div class="grid g4 mt keep2">${MODS.map(([t,i,d], k) => `<div class="card pad"><div style="display:flex;justify-content:space-between;align-items:flex-start"><span class="kpi ${'c'}" style="all:unset"><span class="ico" style="width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:var(--cyan-a);color:var(--cyan)">${ic(i,19)}</span></span><span class="bd ${ok ? 'ai' : 'BLOCKED'} dotted">${ok ? 'READY' : 'DOWN'}</span></div><div class="h" style="margin:14px 0 6px;color:var(--tx)">${t}</div><div style="color:var(--tx2);font-size:13px;min-height:40px">${d}</div><div style="border-top:1px solid var(--line);margin-top:12px;padding-top:10px"><div class="lab">LATEST RESULT</div><div style="margin-top:6px;font-weight:600">${ok ? latest[k] : 'Unavailable'}</div></div></div>`).join('')}</div>
  <div class="grid split2 mt"><div class="card"><div class="ch"><h3>TRAFFIC AI RESULT</h3><select class="sel" data-in="aisel" aria-label="Incident">${S.incidents.map(i => `<option value="${i.id}" ${sel && i.id === sel.id ? 'selected' : ''}>#${i.id} ${cap(i.type)} · ${i.road}</option>`).join('')}</select></div>
   <dl class="kv" style="margin:0;grid-template-columns:1fr">${ok && a ? `<div><dt>traffic_impact</dt><dd>${bd(a.traffic_impact)}</dd></div><div><dt>affected_roads</dt><dd>${a.affected_roads.map(r => `<span class="chip">${esc(r)}</span>`).join('')}</dd></div><div><dt>recommended_route</dt><dd style="color:var(--cyan);font-size:18px">${esc(a.recommended_route)}</dd></div><div style="border-bottom:0"><dt>reason</dt><dd style="font-weight:500">${esc(a.reason)}</dd></div>`
      : `<div style="border-bottom:0"><dd class="na">${ok ? 'No analysis available for this incident.' : 'AI analysis unavailable. Use available incident and traffic information instead.'}</dd></div>`}</dl></div>
   <div class="card"><div class="ch"><h3>COMBINED AI RESULT</h3><span class="bd ai">DECISION SUPPORT</span></div><div style="padding:18px">${ok && a ? `<pre class="json">${esc(JSON.stringify({ severity:sel.severity, traffic_impact:a.traffic_impact, recommended_route:a.recommended_route, reason:a.reason }, null, 2))}</pre>` : `<div class="empty"><b>NOTHING TO SHOW</b><span>Select an incident with a completed analysis.</span></div>`}
    <div class="note" style="margin-top:12px">${ic('brain',15)}<span>An AI recommendation based on available traffic data. Not guaranteed.</span></div></div></div></div>`;
}

/* ---- map page ---- */
function mapSide() {
  const s = S.mp.sel;
  if (!s) return `<div class="empty"><div class="big" style="background:var(--cyan-a);color:var(--cyan)">${ic('map',22)}</div><b>NOTHING SELECTED</b><span>Select a road or an emergency marker on the map.</span></div>`;
  if (s.type === 'road') { const r = roadBy(s.id); if (!r) return ''; return `<div style="padding:18px"><div class="h" style="margin-bottom:12px;color:var(--tx);font-size:15px">${esc(r.name.toUpperCase())}</div><div style="display:flex;gap:8px;margin-bottom:14px">${bd(r.status)}${bd(r.congestion)}</div><dl class="kv" style="grid-template-columns:1fr 1fr;margin:0 -18px"><div><dt>VEHICLES</dt><dd>${r.vehicle_count}</dd></div><div><dt>AVG SPEED</dt><dd>${r.average_speed} km/h</dd></div></dl><div style="color:var(--tx3);font-size:12.5px;margin:12px 0">Updated ${relS(S.roadTs[r.name] || S.lastUpdate)}</div><button class="btn cy" style="width:100%" data-act="openRoad" data-arg="${esc(r.name)}">Open road details</button></div>`; }
  const i = S.incidents.find(x => x.id === s.id); if (!i) return '';
  return `<div style="padding:18px"><div class="h" style="margin-bottom:12px;color:var(--tx);font-size:15px">${esc(i.type)} #${i.id}</div><div style="display:flex;gap:8px;margin-bottom:14px">${bd(i.severity)}${bd(i.status,1)}</div><dl class="kv" style="margin:0 -18px"><div><dt>LOCATION</dt><dd>${esc(i.road)}</dd></div><div><dt>REPORTED</dt><dd>${relS(i.reported_at)}</dd></div></dl>${i.ai && !sim.aiDown ? `<div class="why" style="margin:14px 0"><div class="lab" style="color:var(--cyan)">AI RECOMMENDED ROUTE</div><div style="font-size:22px;font-weight:800;color:var(--cyan);margin:4px 0">${esc(i.ai.recommended_route)}</div><div style="color:var(--tx2);font-size:12.5px">${esc(i.ai.reason)}</div></div>` : ''}<button class="btn pri" style="width:100%" data-act="viewIncident" data-arg="${i.id}">View incident</button></div>`;
}
function viewMap() {
  return `<div class="mtools"><div class="search" style="max-width:320px">${ic('search',16)}<input class="inp" data-in="mq" value="${esc(S.mp.q)}" placeholder="Filter road/incident" aria-label="Filter road or incident"></div>
   <select class="sel" data-in="mcong" aria-label="Filter traffic">${['ALL','LOW','MEDIUM','HIGH','BLOCKED'].map(v => `<option value="${v}" ${S.mp.cong === v ? 'selected' : ''}>${v === 'ALL' ? 'All traffic' : cap(v) + (v === 'BLOCKED' ? '' : ' traffic')}</option>`).join('')}</select>
   <span class="lab">OpenStreetMap geographic tiles. Demo pins near Meerut are illustrative, not verified incident GPS.</span></div>
   <div class="card pad" style="margin-bottom:12px"><div class="realmap-tools">
   <input id="geoQuery" class="inp" placeholder="Search real address or place (e.g. Meerut railway station)" aria-label="Search real address">
   <button class="btn cy" id="geoSearchBtn">Search place</button>
   <select id="geoResults" class="sel" aria-label="Geocoding results"><option value="">Select a result</option></select>
   <button class="btn" id="setOriginBtn">Set origin</button><button class="btn" id="setDestBtn">Set destination</button>
   <button class="btn pri" id="routeBtn">Calculate road route</button></div>
   <div class="realmap-tools"><span class="lab">Origin</span><input id="originCoords" class="inp" placeholder="lat, lon">
   <span class="lab">Destination</span><input id="destCoords" class="inp" placeholder="lat, lon"></div>
   <div id="routeResult" class="realmap-note">Routing uses OSRM road-network data when available. It is not traffic-aware and is not an emergency-service dispatch tool.</div></div>
   <div class="grid split">${mapBox('map2', true)}<div class="card" id="mside" style="align-self:stretch">${mapSide()}</div></div>`;
}
function mountMapPage() {
  mountMap('map2', () => { const p = S.mp.sel && S.mp.sel.type === 'inc' ? S.incidents.find(i => i.id === S.mp.sel.id) : primaryInc(); return { roads:S.roads, incidents:activeInc(), route:!sim.aiDown && p && p.ai ? p.ai.recommended_route : null, q:S.mp.q, cong:S.mp.cong, onSelect: s => { S.mp.sel = s; const x = $('#mside'); if (x) x.innerHTML = mapSide(); } }; });
  if (S.mp.sel && maps.map2) { maps.map2.sel = S.mp.sel; maps.map2.update(); }
  const $id = id => document.getElementById(id);
  const map = maps.map2 && maps.map2.leaflet;
  let searchResults=[];
  if ($id('geoSearchBtn')) $id('geoSearchBtn').onclick=async()=>{
    const out=$id('routeResult'); out.textContent='Searching address…';
    try { const r=await fetch(CONFIG.API_BASE+'/geo/geocode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:$id('geoQuery').value})});
      const d=await r.json(); if(!r.ok) throw new Error(d.detail||'Geocoding failed'); searchResults=d.results||[];
      $id('geoResults').innerHTML='<option value="">Select a result</option>'+searchResults.map((x,i)=>`<option value="${i}">${esc(x.display_name)}</option>`).join('');
      if(searchResults.length && map) map.setView([searchResults[0].lat,searchResults[0].lon],15);
      out.textContent=searchResults.length?`Found ${searchResults.length} result(s) via ${d.provider}.`:'No matching places found.';
    } catch(e){out.textContent='Place search unavailable: '+e.message+' (check backend and internet connection).';}
  };
  const chosen=()=>searchResults[Number($id('geoResults').value)];
  if($id('setOriginBtn')) $id('setOriginBtn').onclick=()=>{const x=chosen();if(x)$id('originCoords').value=`${x.lat}, ${x.lon}`;};
  if($id('setDestBtn')) $id('setDestBtn').onclick=()=>{const x=chosen();if(x)$id('destCoords').value=`${x.lat}, ${x.lon}`;};
  if($id('routeBtn')) $id('routeBtn').onclick=async()=>{
    const parse=id=>$id(id).value.split(',').map(v=>Number(v.trim()));
    const [olat,olon]=parse('originCoords'),[dlat,dlon]=parse('destCoords'),out=$id('routeResult');
    if(![olat,olon,dlat,dlon].every(Number.isFinite)||Math.abs(olat)>90||Math.abs(dlat)>90||Math.abs(olon)>180||Math.abs(dlon)>180){out.textContent='Enter valid coordinates as latitude, longitude for both origin and destination.';return;}
    out.textContent='Calculating road-network route…';
    try{const r=await fetch(CONFIG.API_BASE+'/routes/calculate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({origin_lat:olat,origin_lon:olon,destination_lat:dlat,destination_lon:dlon})});const d=await r.json();if(!r.ok)throw new Error(d.detail||'Route calculation failed');
      if(map){if(maps.map2.routeLayer)map.removeLayer(maps.map2.routeLayer);maps.map2.routeLayer=L.geoJSON(d.routes[0].geometry,{style:{color:'#087fce',weight:6,opacity:.85}}).addTo(map);map.fitBounds(maps.map2.routeLayer.getBounds(),{padding:[24,24]});}
      const r0=d.routes[0];out.textContent=`${(r0.distance_m/1000).toFixed(2)} km · ${Math.round(r0.duration_s/60)} min estimated · ${r0.source}. ${d.notice}`;
    }catch(e){out.textContent='Routing unavailable: '+e.message;}
  };
}
function liveMap() { maps.map2 && maps.map2.update(); const x = $('#mside'); if (x) x.innerHTML = mapSide(); }

/* ---- analytics ---- */
function histRows() {
  const a = S.an, cutoff = Date.now() - a.range * 3600000;
  return S.history.filter(h => h.ts >= cutoff && (a.road === 'ALL' || h.road === a.road) && (a.cong === 'ALL' || h.congestion === a.cong)).sort((x, y) => y.ts - x.ts);
}
function histTable() {
  const rows = histRows(), a = S.an;
  if (!rows.length) return `<div class="empty"><b>NOT ENOUGH HISTORICAL DATA</b><span>No entries match these filters.</span></div>`;
  return `<div class="trow h cols-h"><span>ROAD</span><span>TIMESTAMP</span><span>VEHICLES</span><span>AVG SPEED</span><span>CONGESTION</span></div>` + rows.slice(0, a.limit).map(h => `<div class="trow cols-h" style="cursor:default"><span class="rname" data-l="ROAD">${esc(h.road)}</span><span style="color:var(--tx2)" data-l="TIMESTAMP">${fmtDT(h.ts)}</span><span data-l="VEHICLES">${h.vehicle_count}</span><span data-l="AVG SPEED">${h.average_speed} km/h</span><span data-l="CONGESTION">${bd(h.congestion)}</span></div>`).join('')
    + `<div style="padding:12px 18px;display:flex;justify-content:space-between;align-items:center"><span class="lab">Showing ${Math.min(a.limit, rows.length)} of ${rows.length} entries</span>${rows.length > a.limit ? `<button class="btn sm" data-act="showMore">Show more</button>` : ''}</div>`;
}
function viewAnalytics() {
  const H = S.history; if (!H.length) return `<div class="card"><div class="empty"><b>NOT ENOUGH HISTORICAL DATA</b><span>Traffic history will appear here once it has been collected.</span></div></div>`;
  const inc = S.incidents, res = inc.filter(i => i.status === 'RESOLVED' && i.resolved_at), avg = res.length ? Math.round(res.reduce((s, i) => s + (i.resolved_at - i.reported_at) / 60000, 0) / res.length) : null;
  const hrs = [...new Set(H.map(h => h.ts))].sort((a, b) => a - b).slice(-24), byH = t => H.filter(h => h.ts === t);
  const labels = hrs.map(t => new Date(t).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', hour12:false }));
  const congEv = H.filter(h => h.ts >= hrs[0] && h.congestion === 'HIGH').length;
  const trend = hrs.map(t => byH(t).filter(h => h.congestion === 'HIGH').length), spd = hrs.map(t => Math.round(byH(t).reduce((s, h) => s + h.average_speed, 0) / byH(t).length));
  const d = dayVolume(), sev = ['CRITICAL','HIGH','MEDIUM','LOW'].map(s => ({ l:cap(s), v:inc.filter(i => i.severity === s).length, c:{ CRITICAL:'#ff4b5c', HIGH:'#ff8a3d', MEDIUM:'#f4c542', LOW:'#2fd3a0' }[s] }));
  const roadAvg = S.roads.map(r => { const rows = H.filter(h => h.road === r.name && h.ts >= hrs[0]); return { name:r.name, v:rows.length ? Math.round(rows.reduce((s, h) => s + h.vehicle_count, 0) / rows.length) : 0 }; }).sort((a, b) => b.v - a.v);
  const m = (l, v, s, c) => `<div class="card kpi ${c}"><span class="lab">${l}</span><div class="v" style="font-size:32px">${v}</div><div class="s">${s}</div></div>`;
  return `<div class="grid g5 keep2">${m('TOTAL INCIDENTS', inc.length, 'All recorded', 'c')}${m('RESOLVED INCIDENTS', res.length, `${inc.length ? Math.round(res.length / inc.length * 100) : 0}% of total`, 'g')}${m('AVG RESOLUTION TIME', avg == null ? '–' : avg + ' min', 'Resolved incidents', 'b')}${m('HIGH SEVERITY', inc.filter(i => SEVR[i.severity] >= 3).length, 'High and critical', 'r')}${m('CONGESTION EVENTS', congEv, 'High congestion · last 24 h', 'o')}</div>
  <div class="grid g2 mt"><div class="card pad"><div class="h" style="margin-bottom:10px">TRAFFIC CONGESTION TREND <span class="lab">roads at high congestion</span></div>${lineChart([{ vals:trend, color:'var(--orange)' }], labels, { h:230, yMin:0 })}</div>
   <div class="card pad"><div class="h" style="margin-bottom:10px">EMERGENCY VOLUME <span class="lab">last 7 days</span></div>${barChart(d.vals, d.labels, { h:230, color:'var(--cyan)' })}</div>
   <div class="card pad"><div class="h" style="margin-bottom:14px">SEVERITY DISTRIBUTION</div>${donut(sev)}</div>
   <div class="card pad"><div class="h" style="margin-bottom:14px">ROAD CONGESTION COMPARISON <span class="lab">avg vehicles · 24 h</span></div>${roadAvg.map(r => `<div style="display:grid;grid-template-columns:90px 1fr 36px;gap:12px;align-items:center;margin-bottom:11px"><span>${esc(r.name)}</span><div class="bar" style="height:9px"><i style="width:${Math.min(100, r.v)}%;background:${covar(congOf(r.v))}"></i></div><b style="text-align:right">${r.v}</b></div>`).join('')}</div></div>
  <div class="card pad mt"><div class="h" style="margin-bottom:10px">AVERAGE SPEED TREND <span class="lab">km/h · citywide · 24 h</span></div>${lineChart([{ vals:spd, color:'var(--green)' }], labels, { h:210, unit:'' })}</div>
  <div class="card mt"><div class="ch"><h3>TRAFFIC HISTORY</h3><span class="lab">Demo history data</span></div><div class="mtools" style="padding:14px 18px 0">
   <select class="sel" data-in="hr" aria-label="Date range"><option value="24" ${S.an.range === 24 ? 'selected' : ''}>Last 24 hours</option><option value="72" ${S.an.range === 72 ? 'selected' : ''}>Last 3 days</option></select>
   <select class="sel" data-in="hroad" aria-label="Road"><option value="ALL">All roads</option>${S.roads.map(r => `<option ${S.an.road === r.name ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
   <select class="sel" data-in="hcong" aria-label="Congestion">${['ALL','LOW','MEDIUM','HIGH'].map(v => `<option value="${v}" ${S.an.cong === v ? 'selected' : ''}>${v === 'ALL' ? 'All congestion' : cap(v)}</option>`).join('')}</select></div><div id="htbl">${histTable()}</div></div>`;
}

/* ---- settings ---- */
function viewSettings() {
  const sw = (k, t, d) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:14px;padding:14px 18px;border-bottom:1px solid var(--line)"><div><b>${t}</b><div style="color:var(--tx3);font-size:12.5px">${d}</div></div><button class="btn sm ${sim[k] ? 'bad' : ''}" data-act="sim" data-arg="${k}" aria-pressed="${sim[k]}" style="${sim[k] ? 'border-color:var(--red);color:var(--red)' : ''}">${sim[k] ? 'Simulating · turn off' : 'Simulate'}</button></div>`;
  return `<div class="grid g2"><div class="card"><div class="ch"><h3>DEMO CONTROLS</h3><span class="demo">${ic('zap',13)}DEMO ONLY</span></div>
   ${sw('wsDown','Live traffic connection loss','Drops the /ws/traffic feed to show the reconnecting and offline states.')}${sw('apiFail','Backend API failure','Next refresh, report or status change fails. Nothing is faked as successful.')}${sw('aiDown','AI engine unavailable','Shows the AI fallback state with plain incident and traffic data.')}</div>
   <div class="card"><div class="ch"><h3>DATA SOURCE</h3></div><dl class="kv" style="margin:0;grid-template-columns:1fr"><div><dt>MODE</dt><dd>${CONFIG.USE_MOCK ? 'Mock data (centralised in the MOCK section)' : 'Live backend'}</dd></div><div><dt>REST ENDPOINTS</dt><dd style="font-weight:500;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;line-height:1.8">GET ${CONFIG.endpoints.roads}<br>GET ${CONFIG.endpoints.incidents}<br>POST ${CONFIG.endpoints.report}<br>PATCH ${CONFIG.endpoints.status(':id')}<br>GET ${CONFIG.endpoints.history}</dd></div><div><dt>WEBSOCKET</dt><dd style="font-family:ui-monospace,Menlo,monospace;font-size:12.5px">${CONFIG.WS_URL} · <span class="${S.conn === 'live' ? 'ok' : 'warn'}">${S.conn}</span></dd></div><div style="border-bottom:0"><dt>MAP</dt><dd style="font-weight:500">Stylised simulation. Swap in Leaflet/OpenStreetMap once roads have latitude and longitude.</dd></div></dl></div></div>
  <div class="card pad mt"><div class="h" style="margin-bottom:12px">SYSTEM HEALTH</div>${healthCard()}</div>`;
}

/* ============================ MODALS / DIALOGS ============================ */
function openOvl(html, cls = 'c') { $('#ovl').innerHTML = `<div class="ovl ${cls}" data-act="ovlBg">${html}</div>`; }
function closeOvl() { $('#ovl').innerHTML = ''; S.drawer = null; S.modal = null; }
function reportModal() {
  const r = S.rep;
  if (r.state === 'ok') return `<div class="modal"><div class="empty"><div class="big">${ic('check',26)}</div><b>EMERGENCY REPORTED</b><span>Your emergency has been added to the command center.</span><span class="lab" style="margin-top:6px">Incident #${r.id}</span><div style="display:flex;gap:10px;margin-top:14px"><button class="btn" data-act="closeOvl">Close</button><button class="btn pri" data-act="viewIncident" data-arg="${r.id}">View incident</button></div></div></div>`;
  return `<div class="modal"><div class="mh"><div><h2>REPORT EMERGENCY</h2><p>Send an incident to the command center for AI analysis.</p></div><button class="ibtn" data-act="closeOvl" aria-label="Close">${ic('x')}</button></div>
   <label class="f" for="rt">EMERGENCY TYPE</label><select class="sel inp" id="rt" data-in="rtype">${TYPES.map(t => `<option value="${t}" ${r.type === t ? 'selected' : ''}>${cap(t)}</option>`).join('')}</select>
   <label class="f" for="rr">LOCATION / ROAD</label><select class="sel inp" id="rr" data-in="rroad"><option value="">Select road</option>${S.roads.map(x => `<option ${r.road === x.name ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
   <label class="f" for="ri">ADDITIONAL INFORMATION</label><textarea class="inp" id="ri" data-in="rinfo" placeholder="What is happening? Anything responders should know?">${esc(r.info)}</textarea>
   ${r.state === 'err' ? `<div class="banner bad" style="margin-top:14px;border-radius:10px;padding:10px 14px">${ic('alert',16)}${esc(r.msg)}</div>` : ''}
   <button class="btn pri" style="width:100%;margin-top:18px;padding:12px" data-act="submitReport" ${r.state === 'sending' ? 'disabled' : ''}>${r.state === 'sending' ? 'REPORTING…' : 'REPORT EMERGENCY'}</button></div>`;
}
function confirmDlg(id, status) {
  const i = S.incidents.find(x => x.id === id), res = status === 'RESOLVED';
  return `<div class="modal" style="max-width:420px"><div class="mh"><div><h2>${res ? 'MARK AS RESOLVED?' : 'MARK AS RESPONDING?'}</h2><p>Incident #${id} · ${esc(cap(i.type))} on ${esc(i.road)}</p></div></div>
   <p style="color:var(--tx2)">${res ? 'This closes the incident and removes it from active emergencies.' : 'This tells the command center that responders are on their way.'}</p>
   <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px"><button class="btn" data-act="closeOvl">Cancel</button><button class="btn ${res ? 'gr' : 'bl'}" data-act="doStatus" data-arg="${id}|${status}">${res ? 'Mark resolved' : 'Mark responding'}</button></div></div>`;
}

/* ================================ ACTIONS ================================ */
const A = {
  toggleSide: () => { S.side = !S.side; renderSide(); }, closeSide: () => { S.side = false; renderSide(); },
  toggleNotif: () => { S.notifOpen = !S.notifOpen; if (S.notifOpen) { renderNotif(); S.unread = 0; renderTop(); } else renderNotif(); },
  readAll: () => { S.unread = 0; renderTop(); renderNotif(); },
  refresh: () => load(true), retry: () => load(),
  viewIncident: id => { closeOvl(); location.hash = '#/emergencies/' + id; },
  showOnMap: id => { S.mp.sel = { type:'inc', id:+id }; location.hash = '#/map'; },
  openReport: () => { S.rep = { type:'ACCIDENT', road:'', info:'', state:'form', msg:'', id:null }; openOvl(reportModal()); },
  closeOvl, ovlBg: (a, t, e) => { if (e.target === t) closeOvl(); },
  openRoad: n => { S.drawer = n; openOvl('<div class="drawer" role="dialog" aria-label="Road detail"></div>', 'r'); drawRoad(); },
  tfilter: f => { S.tf = f; $('#view').innerHTML = viewTraffic(); },
  clearF: () => { S.f = { q:'', status:'ALL', sev:'ALL', type:'ALL', sort:'NEWEST' }; renderView(); },
  showMore: () => { S.an.limit += 15; $('#htbl').innerHTML = histTable(); },
  confirmStatus: a => { const [id, st] = a.split('|'); openOvl(confirmDlg(+id, st)); },
  doStatus: async a => {
    const [id, st] = a.split('|');
    try { await api.updateStatus(+id, st); const i = S.incidents.find(x => x.id === +id); i.status = st; if (st === 'RESOLVED') i.resolved_at = Date.now(); closeOvl(); pushNotif('system', `Incident #${id} marked ${st.toLowerCase()}`, i.road); toast(`Incident #${id} marked ${st.toLowerCase()}`); renderAll();
    } catch (e) { closeOvl(); toast('Could not update the status: ' + e.message, 'bad'); }
  },
  submitReport: async () => {
    const r = S.rep; if (!r.road) { r.state = 'err'; r.msg = 'Choose the road where the emergency is happening.'; openOvl(reportModal()); return; }
    r.state = 'sending'; openOvl(reportModal());
    try { const inc = await api.reportEmergency({ type:r.type, road:r.road, info:r.info.trim() }); S.incidents.unshift(inc); r.id = inc.id; r.state = 'ok'; pushNotif('new', `New ${r.type.toLowerCase()} reported`, r.road); pushNotif('ai', 'AI route recommendation available', inc.ai.recommended_route); renderAll(); openOvl(reportModal());
    } catch (e) { r.state = 'err'; r.msg = 'The report was not sent: ' + e.message + '. Nothing was added to the command center.'; openOvl(reportModal()); }
  },
  sim: k => { sim[k] = !sim[k]; if (k === 'wsDown') { toast(sim[k] ? 'Simulating lost live connection' : 'Live connection restored', sim[k] ? 'bad' : 'ok'); } renderAll(); }
};
const IN = {
  f_q: v => { S.f.q = v; $('#erows').innerHTML = incRows(); }, f_status: v => { S.f.status = v; $('#erows').innerHTML = incRows(); }, f_sev: v => { S.f.sev = v; $('#erows').innerHTML = incRows(); },
  f_type: v => { S.f.type = v; $('#erows').innerHTML = incRows(); }, f_sort: v => { S.f.sort = v; $('#erows').innerHTML = incRows(); },
  rtype: v => S.rep.type = v, rroad: v => S.rep.road = v, rinfo: v => S.rep.info = v,
  aisel: v => { S.aiSel = +v; $('#view').innerHTML = viewAI(); },
  mq: v => { S.mp.q = v; maps.map2 && maps.map2.update(); }, mcong: v => { S.mp.cong = v; maps.map2 && maps.map2.update(); },
  hr: v => { S.an.range = +v; S.an.limit = 15; $('#htbl').innerHTML = histTable(); }, hroad: v => { S.an.road = v; S.an.limit = 15; $('#htbl').innerHTML = histTable(); }, hcong: v => { S.an.cong = v; S.an.limit = 15; $('#htbl').innerHTML = histTable(); }
};
document.addEventListener('click', e => {
  if (S.notifOpen && !e.target.closest('.notif') && !e.target.closest('[data-act=toggleNotif]')) { S.notifOpen = false; renderNotif(); }
  if (S.side && !e.target.closest('#side') && !e.target.closest('[data-act=toggleSide]')) { S.side = false; renderSide(); }
  const menuOpen = document.querySelector('.map-menu:not([hidden])'); if (menuOpen && !e.target.closest('.map-menu') && !e.target.closest('[data-m=layers]')) menuOpen.hidden = true;
  const t = e.target.closest('[data-act]'); if (!t) return;
  const f = A[t.dataset.act]; if (f) f(t.dataset.arg, t, e);
});
document.addEventListener('input', e => { const t = e.target.closest('[data-in]'); if (t && IN[t.dataset.in]) IN[t.dataset.in](t.value, t); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if ($('#ovl').innerHTML) closeOvl(); S.notifOpen = false; renderNotif(); S.side = false; renderSide(); }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role=button][data-act]')) { e.preventDefault(); e.target.click(); }
});

/* ============================ RENDER / ROUTER ============================ */
function renderView() {
  const v = $('#view'), n = S.route.name;
  Object.keys(maps).forEach(k => delete maps[k]);
  if (S.loading) { v.innerHTML = skeleton(); return; }
  if (S.error) { v.innerHTML = errorState(); return; }
  v.innerHTML = { command:viewCommand, emergencies:viewEmergencies, incident:viewIncident, traffic:viewTraffic, ai:viewAI, map:viewMap, analytics:viewAnalytics, settings:viewSettings }[n]();
  ({ command:mountCommand, incident:mountIncident, map:mountMapPage }[n] || (() => {}))();
}
function renderAll() { renderSide(); renderTop(); renderNotif(); renderView(); }
function route() {
  const h = location.hash.replace(/^#\/?/, '').split('/'), n = h[0] || 'command';
  S.route = n === 'emergencies' && h[1] ? { name:'incident', id:h[1] } : { name: TITLES[n] ? n : 'command', id:null };
  if (S.route.name !== 'map') S.mp.sel = S.mp.sel && S.route.name === 'incident' ? S.mp.sel : null;
  S.side = false; closeOvl(); $('.view') && ($('#view').scrollTop = 0);
  renderAll();
}
addEventListener('hashchange', route);

/* ============================ DATA FLOW ============================ */
async function load(manual) {
  S.loading = !manual || !S.roads.length; S.refreshing = true; S.error = null; if (S.loading) renderAll(); else renderTop();
  try {
    const [roads, incidents, history] = await Promise.all([api.getRoads(), api.getIncidents(), api.getHistory()]);
    S.roads = roads; S.incidents = incidents; S.history = history;
    S.roads.forEach(r => { S.roadHist[r.name] = S.roadHist[r.name] || Array.from({ length:12 }, () => Math.max(0, r.vehicle_count + Math.round((Math.random() - .5) * 8))); S.roadTs[r.name] = Date.now(); });
    if (!S.totals.length) { const tot = S.roads.reduce((s, r) => s + r.vehicle_count, 0); S.totals = Array.from({ length:20 }, (_, i) => tot + Math.round(Math.sin(i / 2) * 9 + (Math.random() - .5) * 10)); }
    S.lastUpdate = Date.now(); if (manual) toast('City data refreshed');
  } catch (e) { S.error = e.message; if (!manual) S.roads = []; else toast('Refresh failed: ' + e.message, 'bad'); S.error = manual && S.roads.length ? null : S.error; }
  S.loading = false; S.refreshing = false; renderAll();
}
function onTraffic(msg) {
  const list = Array.isArray(msg) ? msg : msg.roads || (msg.name ? [msg] : []);
  if (!list.length || !S.roads.length) return;
  for (const u of list) {
    const r = roadBy(u.name); if (!r) continue;
    const was = rcong(r);
    Object.assign(r, { vehicle_count:u.vehicle_count ?? r.vehicle_count, average_speed:u.average_speed ?? r.average_speed, congestion:u.congestion ?? r.congestion, status:u.status ?? r.status });
    const h = S.roadHist[r.name] = (S.roadHist[r.name] || []).concat(r.vehicle_count).slice(-30); S.roadTs[r.name] = Date.now();
    const now = rcong(r);
    if (now !== was) {
      if (now === 'BLOCKED') pushNotif('blocked', 'Road blocked', r.name);
      else if (was === 'BLOCKED') pushNotif('system', 'Road reopened', r.name);
      else if (now === 'HIGH') pushNotif('traffic', 'Traffic increased', r.name);
      else pushNotif('traffic', 'Traffic condition changed to ' + now.toLowerCase(), r.name);
      const p = primaryInc(); if (p && p.ai && p.ai.recommended_route === r.name && (now === 'HIGH' || now === 'BLOCKED')) pushNotif('ai', 'Recommended route needs review', r.name);
    }
  }
  S.totals.push(S.roads.reduce((s, r) => s + r.vehicle_count, 0)); S.totals = S.totals.slice(-40); S.lastUpdate = Date.now();
  if (S.unread && $('#top')) renderTop(); if (S.notifOpen) renderNotif();
  if (S.loading || S.error) return;
  ({ command:liveCommand, traffic:liveTraffic, map:liveMap, incident:liveIncident }[S.route.name] || (() => {}))();
  drawRoad(); if (S.route.name === 'settings') $('#view').innerHTML = viewSettings();
}
const socket = new TrafficSocket(onTraffic, s => { S.conn = s; if (s === 'live') pushNotif('system', 'Live traffic feed connected', 'System'); if (s === 'offline') pushNotif('system', 'Live traffic feed lost', 'System'); renderSide(); renderTop(); if (S.route.name === 'settings' && !S.loading) $('#view').innerHTML = viewSettings(); if (S.route.name === 'traffic' && !S.loading && !S.error) liveTraffic(); });

setInterval(() => {
  const c = $('#clock'); if (c) c.textContent = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  document.querySelectorAll('[data-ts]').forEach(n => n.textContent = rel(+n.dataset.ts));
}, 1000);

route(); load().then(() => socket.connect());
