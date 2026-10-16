const KEY = 'myday.v2';
const START = 8 * 60;   // 08:00
const END = 17 * 60;    // 17:00
const BOTTLE_ML = 789;          // ml per bottle
const BOTTLES = 3;              // bottles is the daily water goal
const WATER_GOAL = BOTTLE_ML * BOTTLES;
const MOODS = [
  { icon: 'i-mood-1', label: 'Awful' },
  { icon: 'i-mood-2', label: 'Low' },
  { icon: 'i-mood-3', label: 'Okay' },
  { icon: 'i-mood-4', label: 'Good' },
  { icon: 'i-mood-5', label: 'Great' }
];
const ACCENTS = ['#2563eb', '#0d9488', '#7c3aed', '#db2777', '#ea580c', '#0891b2'];
const PHOTO_SLOTS = 3;      // three photos a day
const PHOTO_MAX = 1000;     // px, longest side after downscaling
const PHOTO_QUALITY = 0.72; // JPEG quality
const PROMPTS = [
  'What is one thing that went well today, and why?',
  'What would make tomorrow feel like a good day?',
  'What did you learn recently that surprised you?',
  'What are you grateful for right now?',
  'What is weighing on your mind, and what is one small step on it?',
  'Who made a difference for you this week?',
  'What is one thing you want to let go of?',
  'If today were your last day off, how would you spend it?'
];
const $ = s => document.querySelector(s);
// icon set is a Lucide-derived SVG sprite defined in index.html (never emoji)
const icon = id => `<svg class="ico" aria-hidden="true"><use href="#${id}"/></svg>`;

const DEFAULTS = {
  events: [], todos: [], habits: [], notes: [], photos: {}, countdowns: [],
  priorities: {}, pomo: {}, checkins: {}, water: {}, sleep: {},
  lastPrompt: '', lastNudge: '',
  settings: { theme: 'light', accent: ACCENTS[0], city: '', units: 'C', reminders: false, dailyPrompt: true }
};

function load() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
  return { ...structuredClone(DEFAULTS), ...saved, settings: { ...DEFAULTS.settings, ...(saved.settings || {}) } };
}
let state = load();
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    toast('Device storage is full — delete some photos or export a backup');
  }
  queueRemoteSave();
}

let saveTimer;
function queueRemoteSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch('api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
      keepalive: true
    }).then(res => {
      if (res.status === 401) toast('Signed out — reload the page to sign in again');
      else if (!res.ok) toast('Kept on this device, but the server refused the sync');
    }).catch(() => toast('Offline: changes are saved on this device only'));
  }, 400);
}

async function loadRemote() {
  try {
    const res = await fetch('api/state', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (data && Object.keys(data).length) {
      state = { ...structuredClone(DEFAULTS), ...data, settings: { ...DEFAULTS.settings, ...(data.settings || {}) } };
      localStorage.setItem(KEY, JSON.stringify(state));
    } else {
      queueRemoteSave();
    }
  } catch {}
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmtKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function todayStr() { return fmtKey(new Date()); }
function parseKey(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseKey(s); d.setDate(d.getDate() + n); return fmtKey(d); }
function addMonths(s, n) { const d = parseKey(s); d.setDate(1); d.setMonth(d.getMonth() + n); return fmtKey(d); }
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const hhmm = min => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const label = min => {
  const h = Math.floor(min / 60), m = min % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/* ---------- Mutable view state ---------- */
let viewDate = todayStr();
let calMode = 'day';
let noteId = null;
let noteFilter = null;
let heatMonth = todayStr();

/* ---------- Toast & notifications ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.hidden = true, 3500);
}
function notify(title, body) {
  toast(`${title}: ${body}`);
  if (state.settings.reminders && 'Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}

/* ---------- Theme ---------- */
function applySettings() {
  const s = state.settings;
  const dark = s.theme === 'dark' || (s.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.setProperty('--accent', s.accent);
}
function saveSettings() { save(); applySettings(); }
function fillSettings() {
  const s = state.settings;
  $('#s-theme').value = s.theme;
  $('#s-units').value = s.units;
  $('#s-city').value = s.city;
  $('#s-reminders').checked = s.reminders;
  $('#s-prompt').checked = s.dailyPrompt;
  $('#s-accent').innerHTML = ACCENTS.map(c =>
    `<button class="swatch ${c === s.accent ? 'on' : ''}" data-color="${c}" style="background:${c}" title="${c}" aria-label="Accent ${c}"></button>`).join('');
  renderSettingsInfo();
}

/* ---------- Clock, date, greeting ---------- */
let lastDay = todayStr();
let lastMin = -1;
function tick() {
  const now = new Date();
  $('#clock').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('#today-date').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const h = now.getHours();
  $('#greet').textContent = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';

  if (todayStr() !== lastDay) {
    lastDay = todayStr();
    if (viewDate === addDays(lastDay, -1)) viewDate = lastDay;
    ensureDailyPrompt();
    renderAll();
  } else if (now.getMinutes() !== lastMin) {
    lastMin = now.getMinutes();
    renderCalendar();
    renderCountdown();
    checkReminders();
  }
}

/* ---------- Weather ---------- */
function wxIcon(c) {
  if (c === 0) return 'i-sun';
  if (c <= 2) return 'i-cloud-sun';
  if (c === 3) return 'i-cloud';
  if (c <= 48) return 'i-cloud-fog';
  if (c <= 57) return 'i-cloud-drizzle';
  if (c <= 67) return 'i-cloud-rain';
  if (c <= 77) return 'i-cloud-snow';
  if (c <= 82) return 'i-cloud-rain';
  return 'i-cloud-bolt';
}
const getJSON = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });

function setWeather(iconId, text) {
  $('#weather').innerHTML = `${icon(iconId)}<span>${esc(text)}</span>`;
}

async function loadWeather() {
  setWeather('i-cloud-sun', 'Loading weather…');
  try {
    let lat, lon, place = '';
    const city = state.settings.city.trim();
    if (city) {
      const g = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
      if (!g.results) throw new Error('city not found');
      ({ latitude: lat, longitude: lon, name: place } = g.results[0]);
    } else {
      if (!navigator.geolocation) throw new Error('no geolocation');
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 }));
      ({ latitude: lat, longitude: lon } = pos.coords);
    }
    const w = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`);
    let t = w.current.temperature_2m, unit = '°C';
    if (state.settings.units === 'F') { t = t * 9 / 5 + 32; unit = '°F'; }
    setWeather(wxIcon(w.current.weather_code), `${Math.round(t)}${unit}${place ? ' · ' + place : ''}`);
  } catch {
    setWeather('i-cloud-fog', 'Weather unavailable. Set a city in Settings.');
  }
}

/* ---------- Calendar ---------- */
function renderCalendar() {
  document.querySelectorAll('[data-mode]').forEach(b => {
    const on = b.dataset.mode === calMode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  $('#ev-form').hidden = calMode !== 'day';
  if (calMode === 'day') renderDay(); else renderMonth();
}

function renderDay() {
  $('#cal-label').textContent = (viewDate === todayStr() ? 'Today · ' : '') +
    parseKey(viewDate).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });

  let html = '<div class="timeline">';
  for (let h = 8; h <= 17; h++) {
    const top = h * 60 - START;
    html += `<div class="hlabel" style="top:${top}px">${label(h * 60)}</div>`;
    html += `<div class="hline" style="top:${top}px"></div>`;
    if (h < 17) html += `<div class="slot" data-min="${h * 60}" style="top:${top}px"></div>`;
  }

  const evs = state.events
    .filter(e => e.date === viewDate)
    .map(e => ({ ...e, s: Math.max(START, toMin(e.start)), e: Math.min(END, toMin(e.end)) }))
    .filter(e => e.e > e.s)
    .sort((a, b) => a.s - b.s || b.e - a.e);

  const laneEnds = [];
  evs.forEach(ev => {
    let i = laneEnds.findIndex(le => le <= ev.s);
    if (i < 0) { i = laneEnds.length; laneEnds.push(ev.e); } else laneEnds[i] = ev.e;
    ev.lane = i;
  });
  const lanes = Math.max(1, laneEnds.length);

  let layer = '';
  evs.forEach(ev => {
    const height = Math.max(24, ev.e - ev.s - 2);
    layer += `<button class="event" data-id="${ev.id}" title="Click to delete"
      style="top:${ev.s - START}px;height:${height}px;left:calc(${ev.lane * 100 / lanes}% + 2px);width:calc(${100 / lanes}% - 4px)">
      ${esc(ev.title)}<small>${label(toMin(ev.start))} – ${label(toMin(ev.end))}</small></button>`;
  });

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (viewDate === todayStr() && nowMin >= START && nowMin <= END) {
    html += `<div class="now" style="top:${nowMin - START}px"></div>`;
  }
  html += `<div class="events">${layer}</div></div>`;
  $('#cal-body').innerHTML = html;
}

function renderMonth() {
  const first = parseKey(viewDate);
  first.setDate(1);
  const y = first.getFullYear(), m = first.getMonth();
  const days = new Date(y, m + 1, 0).getDate();
  const counts = {};
  state.events.forEach(e => counts[e.date] = (counts[e.date] || 0) + 1);
  const today = todayStr();

  $('#cal-label').textContent = first.toLocaleDateString([], { month: 'long', year: 'numeric' });
  let html = '<div class="mhead">' + ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<span>${d}</span>`).join('') + '</div>';
  html += '<div class="mgrid">' + '<div></div>'.repeat(first.getDay());
  for (let d = 1; d <= days; d++) {
    const key = fmtKey(new Date(y, m, d));
    const n = Math.min(counts[key] || 0, 3);
    html += `<button class="mcell ${key === today ? 'today' : ''} ${key === viewDate ? 'sel' : ''}" data-date="${key}">
      <span>${d}</span><div class="dots">${'<i></i>'.repeat(n)}</div></button>`;
  }
  $('#cal-body').innerHTML = html + '</div>';
}

function fillTimeSelects() {
  const opts = [];
  for (let m = START; m <= END; m += 30) opts.push(`<option value="${hhmm(m)}">${label(m)}</option>`);
  $('#ev-start').innerHTML = opts.join('');
  $('#ev-end').innerHTML = opts.join('');
  $('#ev-start').value = '09:00';
  $('#ev-end').value = '10:00';
}

/* ---------- Journal prompt ---------- */
function ensureDailyPrompt() {
  if (!state.settings.dailyPrompt || state.lastPrompt === todayStr()) return;
  const prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
  const day = parseKey(todayStr()).toLocaleDateString([], { month: 'short', day: 'numeric' });
  state.notes.push({ id: uid(), title: `Journal · ${day}`, body: `${prompt}\n\n`, tags: ['journal'], updated: Date.now() });
  state.lastPrompt = todayStr();
  save();
  toast("Today's journal prompt is in Notes");
}

/* ---------- Reminders ---------- */
const alerted = new Set();
function checkReminders() {
  if (!state.settings.reminders) return;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const today = todayStr();

  state.events.filter(e => e.date === today).forEach(e => {
    const diff = toMin(e.start) - nowMin;
    if (diff >= 0 && diff <= 10 && !alerted.has(e.id)) {
      alerted.add(e.id);
      notify('Coming up', `${e.title} at ${label(toMin(e.start))}`);
    }
  });

  const left = state.habits.filter(h => !h.days.includes(today));
  if (nowMin >= 20 * 60 && state.habits.length && left.length && state.lastNudge !== today) {
    state.lastNudge = today;
    save();
    notify('Habits left today', left.map(h => h.name).join(', '));
  }
}

/* ---------- Focus priorities ---------- */
function todayPriorities() {
  const k = todayStr();
  if (!state.priorities[k]) {
    state.priorities[k] = [{ text: '', done: false }, { text: '', done: false }, { text: '', done: false }];
  }
  return state.priorities[k];
}
function renderPriorities() {
  const list = todayPriorities();
  $('#focus-count').textContent = `${list.filter(p => p.done && p.text).length} of 3 done`;
  $('#focus-list').innerHTML = list.map((p, i) => `
    <div class="prio">
      <span class="num">${i + 1}</span>
      <input class="prio-text" data-i="${i}" value="${esc(p.text)}" placeholder="Priority ${i + 1}" autocomplete="off">
      <input type="checkbox" class="prio-done" data-i="${i}" ${p.done ? 'checked' : ''} title="Done">
    </div>`).join('');
}

/* ---------- Pomodoro ---------- */
const POMO = { focus: 25 * 60, break: 5 * 60 };
const pomo = { mode: 'focus', left: POMO.focus, id: null };

function renderPomo() {
  $('#pomo-time').textContent = fmtTime(pomo.left);
  $('#pomo-start').innerHTML = icon(pomo.id ? 'i-pause' : 'i-play') + `<span>${pomo.id ? 'Pause' : 'Start'}</span>`;
  $('#pomo-today').textContent = `${state.pomo[todayStr()] || 0} min focused today`;
  document.querySelectorAll('[data-pomo]').forEach(b => {
    const on = b.dataset.pomo === pomo.mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
function setPomoMode(mode) {
  clearInterval(pomo.id);
  pomo.id = null;
  pomo.mode = mode;
  pomo.left = POMO[mode];
  renderPomo();
}
function pomoTick() {
  pomo.left--;
  if (pomo.left <= 0) {
    clearInterval(pomo.id);
    pomo.id = null;
    if (pomo.mode === 'focus') {
      const k = todayStr();
      state.pomo[k] = (state.pomo[k] || 0) + 25;
      save();
      notify('Focus session complete', 'Time for a break');
      setPomoMode('break');
    } else {
      notify('Break over', 'Back to focus');
      setPomoMode('focus');
    }
    return;
  }
  renderPomo();
}

/* ---------- To-do ---------- */
function renderTodos() {
  const done = state.todos.filter(t => t.done).length;
  $('#todo-count').textContent = state.todos.length ? `${done} of ${state.todos.length} done` : '';
  $('#todo-list').innerHTML = state.todos.length
    ? state.todos.map(t => `
      <div class="todo ${t.done ? 'done' : ''}">
        <input type="checkbox" data-act="toggle" data-id="${t.id}" ${t.done ? 'checked' : ''} aria-label="Mark ${esc(t.text)} complete">
        <span>${esc(t.text)}</span>
        <button class="icon" data-act="del-todo" data-id="${t.id}" title="Delete" aria-label="Delete ${esc(t.text)}">${icon('i-trash')}</button>
      </div>`).join('')
    : `<p class="muted">Nothing on the list. Enjoy the calm.</p>`;
}

/* ---------- Habits ---------- */
function streak(h) {
  const set = new Set(h.days);
  let d = todayStr();
  if (!set.has(d)) d = addDays(d, -1);
  let n = 0;
  while (set.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
function renderHabits() {
  const today = todayStr();
  const week = [...Array(7)].map((_, i) => addDays(today, i - 6));
  $('#habit-list').innerHTML = state.habits.length
    ? state.habits.map(h => {
        const s = streak(h);
        const on = h.days.includes(today);
        return `
        <div class="habit">
          <div class="habit-top">
            <button class="habit-check ${on ? 'on' : ''}" data-act="habit" data-id="${h.id}" title="Mark today"
              aria-pressed="${on}" aria-label="Mark ${esc(h.name)} done today">${icon('i-check')}</button>
            <span class="name">${esc(h.name)}</span>
            <button class="icon" data-act="del-habit" data-id="${h.id}" title="Delete habit" aria-label="Delete ${esc(h.name)}">${icon('i-trash')}</button>
          </div>
          <div class="habit-meta">
            <div class="week">${week.map(d => `
              <div class="day ${h.days.includes(d) ? 'on' : ''}">${parseKey(d).toLocaleDateString([], { weekday: 'narrow' })}<i></i></div>`).join('')}
            </div>
            <span class="streak">${icon('i-flame')}Streak <b>${s}</b> ${s === 1 ? 'day' : 'days'}</span>
          </div>
        </div>`;
      }).join('')
    : `<p class="muted">Add a habit to start building streaks.</p>`;
}

function renderHeat() {
  const first = parseKey(heatMonth);
  first.setDate(1);
  const y = first.getFullYear(), m = first.getMonth();
  const days = new Date(y, m + 1, 0).getDate();
  const today = todayStr();
  $('#heat-label').textContent = first.toLocaleDateString([], { month: 'long', year: 'numeric' });

  const body = $('#heat-body');
  body.style.setProperty('--days', days);
  if (!state.habits.length) {
    body.innerHTML = '<p class="muted">Add a habit to see your monthly heatmap. Click a square to mark any past day.</p>';
    return;
  }
  let html = '<div class="hrow hhead"><span></span>' + [...Array(days)].map((_, i) => `<span>${i + 1}</span>`).join('') + '</div>';
  state.habits.forEach(h => {
    html += `<div class="hrow"><span class="hname" title="${esc(h.name)}">${esc(h.name)}</span>`;
    for (let d = 1; d <= days; d++) {
      const key = fmtKey(new Date(y, m, d));
      const on = h.days.includes(key);
      const future = key > today;
      html += `<button class="sq ${on ? 'on' : ''} ${key === today ? 'today' : ''}" data-habit="${h.id}" data-date="${key}" ${future ? 'disabled' : ''} title="${key}"></button>`;
    }
    html += '</div>';
  });
  body.innerHTML = html;
}

/* ---------- Wellness ---------- */
function renderWellness() {
  const k = todayStr();
  const c = state.checkins[k] || {};
  const w = Math.min(state.water[k] || 0, BOTTLES);
  $('#water').innerHTML = [...Array(BOTTLES)].map((_, i) => `
    <button class="bottle ${i < w ? 'on' : ''}" data-n="${i + 1}"
      title="Bottle ${i + 1} of ${BOTTLES} (${BOTTLE_ML} ml)" aria-pressed="${i < w}">
      <span class="cap"></span>
      <span class="body"><b>${BOTTLE_ML}</b>ml</span>
    </button>`).join('');
  $('#water-label').textContent =
    `${w}/${BOTTLES} · ${(w * BOTTLE_ML / 1000).toFixed(2)} of ${(WATER_GOAL / 1000).toFixed(2)} L`;
  $('#sleep').value = state.sleep[k] ?? '';
  $('#mood').innerHTML = MOODS.map((mo, i) =>
    `<button class="mood-btn ${c.mood === i + 1 ? 'on' : ''}" data-mood="${i + 1}"
      title="${mo.label}" aria-label="${mo.label}" aria-pressed="${c.mood === i + 1}">${icon(mo.icon)}</button>`).join('');
  $('#energy').value = c.energy || 3;
  $('#energy-val').textContent = c.energy ? `${c.energy}/5` : 'not set';
}

function renderChart() {
  const days = [...Array(14)].map((_, i) => addDays(todayStr(), i - 13));
  const W = 300, pad = 12;
  const x = i => pad + i * (W - 2 * pad) / 13;
  const y = v => 10 + (5 - v) / 4 * 80;   // 1 at bottom, 5 at top
  const series = (get, cls) => {
    const pts = days.map((d, i) => { const v = get(d); return v == null ? null : { x: x(i), y: y(v) }; }).filter(Boolean);
    if (!pts.length) return '';
    return `<polyline class="line ${cls}" points="${pts.map(p => `${p.x},${p.y}`).join(' ')}"></polyline>` +
      pts.map(p => `<circle class="pt ${cls}" cx="${p.x}" cy="${p.y}" r="3"></circle>`).join('');
  };
  $('#chart').innerHTML =
    series(d => state.checkins[d]?.mood, 'mood') +
    series(d => state.checkins[d]?.energy, 'energy') +
    `<text class="ax" x="${pad}" y="118">${parseKey(days[0]).toLocaleDateString([], { month: 'short', day: 'numeric' })}</text>` +
    `<text class="ax" x="${W - pad}" y="118" text-anchor="end">Today</text>`;
}

/* ---------- Daily photos ---------- */
function photosToday() {
  const k = todayStr();
  if (!Array.isArray(state.photos[k])) state.photos[k] = [];
  return state.photos[k];
}
function photoCount() {
  return Object.values(state.photos).reduce((n, list) => n + list.length, 0);
}
function photoBytes() {
  let n = 0;
  Object.values(state.photos).forEach(list => list.forEach(p => n += p.src.length * 2));
  return n; // images live in localStorage as UTF-16, so ~2 bytes per encoded char
}
const fmtBytes = n => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

function renderPhotos() {
  const list = photosToday();
  $('#photo-count').textContent = list.length ? `${list.length} of ${PHOTO_SLOTS} today` : '';

  let html = '';
  for (let i = 0; i < PHOTO_SLOTS; i++) {
    const p = list[i];
    html += p
      ? `<div class="photo-slot filled">
          <img src="${p.src}" alt="Photo ${i + 1} added on ${todayStr()}" loading="lazy">
          <button class="photo-act open" data-open="${p.id}" title="View larger" aria-label="View photo ${i + 1} larger">${icon('i-maximize')}</button>
          <button class="photo-act del" data-del="${p.id}" title="Remove photo" aria-label="Remove photo ${i + 1}">${icon('i-x')}</button>
        </div>`
      : `<button class="photo-slot empty" data-add="1" aria-label="Add photo ${i + 1} of ${PHOTO_SLOTS}">${icon('i-image')}<span>Add photo</span></button>`;
  }
  $('#photo-row').innerHTML = html;

  const total = photoCount();
  $('#photo-meta').textContent = total ? `${total} saved · ${fmtBytes(photoBytes())}` : '';
}

function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, PHOTO_MAX / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', PHOTO_QUALITY));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.src = url;
  });
}

async function addPhotos(files) {
  const list = photosToday();
  const room = PHOTO_SLOTS - list.length;
  if (room <= 0) { toast(`${PHOTO_SLOTS} photos a day — today's are already in`); return; }
  const picked = [...files].slice(0, room);
  if (files.length > room) toast(`Adding ${picked.length} — the limit is ${PHOTO_SLOTS} a day`);

  let added = 0;
  for (const file of picked) {
    if (!file.type.startsWith('image/')) { toast(`${file.name || 'That file'} is not an image`); continue; }
    try {
      list.push({ id: uid(), src: await shrinkImage(file), ts: Date.now() });
      added++;
    } catch {
      toast(`Could not read ${file.name || 'that image'}`);
    }
  }
  if (!added) return;
  save(); renderPhotos(); renderSettingsInfo();
}

function renderSettingsInfo() {
  const total = photoCount();
  const days = Object.values(state.photos).filter(a => a.length).length;
  $('#s-photo-info').textContent = total
    ? `${total} photo${total === 1 ? '' : 's'} across ${days} day${days === 1 ? '' : 's'} · about ${fmtBytes(photoBytes())} of device storage.`
    : `No photos yet. ${PHOTO_SLOTS} a day, downscaled to ${PHOTO_MAX}px so they stay light.`;
}

/* lightbox */
let lbId = null;
function openLightbox(id) {
  if (!photosToday().some(p => p.id === id)) return;
  lbId = id;
  renderLightbox();
  $('#lightbox').hidden = false;
  $('#lb-close').focus();
}
function closeLightbox() { $('#lightbox').hidden = true; lbId = null; }
function renderLightbox() {
  const list = photosToday();
  const i = list.findIndex(p => p.id === lbId);
  if (i < 0) { closeLightbox(); return; }
  const day = parseKey(todayStr()).toLocaleDateString([], { month: 'short', day: 'numeric' });
  $('#lb-img').src = list[i].src;
  $('#lb-img').alt = `Photo ${i + 1} of ${list.length} added on ${day}`;
  $('#lb-cap').textContent = `${i + 1} of ${list.length} · ${day}`;
  const many = list.length > 1;
  $('#lb-prev').hidden = !many;
  $('#lb-next').hidden = !many;
}
function stepLightbox(n) {
  const list = photosToday();
  const i = list.findIndex(p => p.id === lbId);
  if (i < 0) return;
  lbId = list[(i + n + list.length) % list.length].id;
  renderLightbox();
}
function deletePhoto(id) {
  const k = todayStr();
  state.photos[k] = (state.photos[k] || []).filter(p => p.id !== id);
  save(); renderPhotos(); renderSettingsInfo();
}

/* ---------- Countdown ---------- */
// whole days between today and a 'YYYY-MM-DD' target (negative = already passed)
function cdDays(c, now = new Date()) {
  const target = parseKey(c.date);
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - midnight) / 86400000);
}
function cdLabel(diff) {
  if (diff < 0) return { big: String(-diff), unit: -diff === 1 ? 'day ago' : 'days ago', cls: 'is-past' };
  if (diff === 0) return { big: 'Today', unit: '', cls: 'is-today' };
  if (diff === 1) return { big: 'Tomorrow', unit: '', cls: 'is-soon' };
  return { big: String(diff), unit: 'days', cls: '' };
}
const fmtDay = key => parseKey(key).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

let cdSig = '';
function renderCountdown() {
  const now = new Date();
  const all = state.countdowns.map(c => ({ ...c, diff: cdDays(c, now) }));
  const upcoming = all.filter(c => c.diff >= 0).sort((a, b) => a.diff - b.diff || a.name.localeCompare(b.name));
  const passed = all.filter(c => c.diff < 0).sort((a, b) => b.diff - a.diff);
  const list = [...upcoming, ...passed];

  // only touch the DOM when something visible actually changed (keeps focus intact)
  const sig = list.map(c => `${c.id}:${c.diff}`).join('|');
  if (sig === cdSig) return;
  cdSig = sig;

  $('#cd-count').textContent = upcoming.length ? `${upcoming.length} upcoming` : (all.length ? 'all passed' : '');
  $('#cd-foot').hidden = !passed.length;

  $('#cd-list').innerHTML = list.length
    ? list.map(c => {
        const v = cdLabel(c.diff);
        return `
        <div class="cd ${c.diff < 0 ? 'is-past' : ''}">
          <div class="cd-val ${v.cls}"><b>${v.big}</b>${v.unit ? `<span>${esc(v.unit)}</span>` : ''}</div>
          <div class="cd-info">
            <strong>${esc(c.name)}</strong>
            <span>${fmtDay(c.date)}</span>
          </div>
          <button class="icon" data-del="${c.id}" title="Delete" aria-label="Delete ${esc(c.name)}">${icon('i-trash')}</button>
        </div>`;
      }).join('')
    : `<p class="muted">Nothing on the countdown. Add a date below — birthdays, trips, deadlines.</p>`;
}

/* ---------- Notes ---------- */
function noteTags(n) {
  const inBody = (n.body.match(/#[\w-]+/g) || []).map(t => t.slice(1));
  return [...new Set([...n.tags, ...inBody].map(t => t.toLowerCase()))].sort();
}
function currentNote() { return state.notes.find(x => x.id === noteId); }

function renderSidebar() {
  const counts = {};
  state.notes.forEach(n => noteTags(n).forEach(t => counts[t] = (counts[t] || 0) + 1));
  if (noteFilter && !counts[noteFilter]) noteFilter = null;

  $('#tag-chips').innerHTML =
    `<button class="chip ${!noteFilter ? 'on' : ''}" data-tag="">All</button>` +
    Object.keys(counts).map(t =>
      `<button class="chip ${noteFilter === t ? 'on' : ''}" data-tag="${esc(t)}">#${esc(t)} <i>${counts[t]}</i></button>`).join('');

  const q = $('#n-search').value.trim().toLowerCase();
  const list = state.notes
    .filter(n => (!noteFilter || noteTags(n).includes(noteFilter)) &&
      (!q || `${n.title} ${n.body} ${noteTags(n).join(' ')}`.toLowerCase().includes(q)))
    .sort((a, b) => b.updated - a.updated);

  $('#note-list').innerHTML = list.length
    ? list.map(n => `
      <button class="note-item ${n.id === noteId ? 'on' : ''}" data-id="${n.id}">
        <strong>${esc(n.title || 'Untitled')}</strong>
        <span>${esc(n.body.slice(0, 80) || 'No content')}</span>
        <div class="tags">${noteTags(n).map(t => `<em>#${esc(t)}</em>`).join(' ')}</div>
      </button>`).join('')
    : `<p class="muted">No notes match.</p>`;
}

function renderEditor() {
  const n = currentNote();
  $('#editor-empty').hidden = !!n;
  $('#editor-body').hidden = !n;
  if (!n) return;
  $('#n-title').value = n.title;
  $('#n-tags').value = n.tags.join(', ');
  $('#n-body').value = n.body;
}

function renderNotes() { renderSidebar(); renderEditor(); }

/* ---------- Render all ---------- */
function renderAll() {
  renderCalendar();
  renderPriorities();
  renderPomo();
  renderTodos();
  renderHabits();
  renderPhotos();
  renderCountdown();
  renderWellness();
  renderChart();
  renderHeat();
  renderNotes();
}

/* ---------- Calendar events ---------- */
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { calMode = b.dataset.mode; renderCalendar(); });
$('#prev').onclick = () => { viewDate = calMode === 'day' ? addDays(viewDate, -1) : addMonths(viewDate, -1); renderCalendar(); };
$('#next').onclick = () => { viewDate = calMode === 'day' ? addDays(viewDate, 1) : addMonths(viewDate, 1); renderCalendar(); };
$('#cal-today').onclick = () => { viewDate = todayStr(); renderCalendar(); };

$('#cal-body').addEventListener('click', e => {
  const ev = e.target.closest('.event');
  if (ev) {
    if (confirm('Delete this event?')) {
      state.events = state.events.filter(x => x.id !== ev.dataset.id);
      save(); renderCalendar();
    }
    return;
  }
  const slot = e.target.closest('.slot');
  if (slot) {
    const s = +slot.dataset.min;
    $('#ev-start').value = hhmm(s);
    $('#ev-end').value = hhmm(Math.min(END, s + 60));
    $('#ev-title').focus();
    return;
  }
  const cell = e.target.closest('.mcell');
  if (cell) { viewDate = cell.dataset.date; calMode = 'day'; renderCalendar(); }
});

$('#ev-form').addEventListener('submit', e => {
  e.preventDefault();
  const title = $('#ev-title').value.trim();
  const start = $('#ev-start').value, end = $('#ev-end').value;
  if (!title) return;
  if (toMin(end) <= toMin(start)) { alert('End time must be after start time.'); return; }
  state.events.push({ id: uid(), date: viewDate, title, start, end });
  save();
  $('#ev-title').value = '';
  renderCalendar();
});

/* ---------- Priorities ---------- */
$('#focus-list').addEventListener('input', e => {
  if (!e.target.matches('.prio-text')) return;
  todayPriorities()[+e.target.dataset.i].text = e.target.value;
  save();
});
$('#focus-list').addEventListener('change', e => {
  if (!e.target.matches('.prio-done')) return;
  todayPriorities()[+e.target.dataset.i].done = e.target.checked;
  save(); renderPriorities();
});

/* ---------- Pomodoro events ---------- */
document.querySelectorAll('[data-pomo]').forEach(b => b.onclick = () => setPomoMode(b.dataset.pomo));
$('#pomo-start').onclick = () => {
  if (pomo.id) { clearInterval(pomo.id); pomo.id = null; }
  else pomo.id = setInterval(pomoTick, 1000);
  renderPomo();
};
$('#pomo-reset').onclick = () => setPomoMode(pomo.mode);

/* ---------- To-do events ---------- */
$('#todo-form').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('#todo-input').value.trim();
  if (!text) return;
  state.todos.push({ id: uid(), text, done: false });
  save();
  $('#todo-input').value = '';
  renderTodos();
});
$('#todo-list').addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.dataset.act === 'toggle') {
    state.todos.find(x => x.id === el.dataset.id).done = el.checked;
  }
  if (el.dataset.act === 'del-todo') {
    state.todos = state.todos.filter(x => x.id !== el.dataset.id);
  }
  save(); renderTodos();
});
$('#todo-clear').onclick = () => {
  state.todos = state.todos.filter(t => !t.done);
  save(); renderTodos();
};

/* ---------- Habit events ---------- */
$('#habit-form').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#habit-input').value.trim();
  if (!name) return;
  state.habits.push({ id: uid(), name, days: [] });
  save();
  $('#habit-input').value = '';
  renderHabits(); renderHeat();
});
$('#habit-list').addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const h = state.habits.find(x => x.id === el.dataset.id);
  if (el.dataset.act === 'habit') {
    const today = todayStr();
    h.days = h.days.includes(today) ? h.days.filter(d => d !== today) : [...h.days, today];
  }
  if (el.dataset.act === 'del-habit') {
    if (!confirm(`Delete habit "${h.name}"?`)) return;
    state.habits = state.habits.filter(x => x.id !== h.id);
  }
  save(); renderHabits(); renderHeat();
});
$('#heat-prev').onclick = () => { heatMonth = addMonths(heatMonth, -1); renderHeat(); };
$('#heat-next').onclick = () => { heatMonth = addMonths(heatMonth, 1); renderHeat(); };
$('#heat-body').addEventListener('click', e => {
  const sq = e.target.closest('[data-habit]');
  if (!sq) return;
  const h = state.habits.find(x => x.id === sq.dataset.habit);
  const d = sq.dataset.date;
  h.days = h.days.includes(d) ? h.days.filter(x => x !== d) : [...h.days, d];
  save(); renderHabits(); renderHeat();
});

/* ---------- Wellness events ---------- */
$('#water').addEventListener('click', e => {
  const b = e.target.closest('[data-n]');
  if (!b) return;
  const k = todayStr(), n = +b.dataset.n, w = Math.min(state.water[k] || 0, BOTTLES);
  state.water[k] = w === n ? n - 1 : n;
  save(); renderWellness();
});
$('#sleep').addEventListener('change', e => {
  const k = todayStr();
  if (e.target.value === '') delete state.sleep[k];
  else state.sleep[k] = +e.target.value;
  save();
});
$('#mood').addEventListener('click', e => {
  const b = e.target.closest('[data-mood]');
  if (!b) return;
  const k = todayStr();
  const c = state.checkins[k] ||= {};
  const v = +b.dataset.mood;
  c.mood = c.mood === v ? undefined : v;
  save(); renderWellness(); renderChart();
});
$('#energy').addEventListener('input', e => {
  const k = todayStr();
  state.checkins[k] = { ...(state.checkins[k] || {}), energy: +e.target.value };
  save();
  $('#energy-val').textContent = `${e.target.value}/5`;
  renderChart();
});

/* ---------- Notes events ---------- */
$('#note-new').onclick = () => {
  const n = { id: uid(), title: '', body: '', tags: noteFilter ? [noteFilter] : [], updated: Date.now() };
  state.notes.push(n);
  noteId = n.id;
  save(); renderNotes();
  $('#n-title').focus();
};
$('#n-delete').onclick = () => {
  const n = currentNote();
  if (!n || !confirm(`Delete "${n.title || 'Untitled'}"?`)) return;
  state.notes = state.notes.filter(x => x.id !== n.id);
  noteId = null;
  save(); renderNotes();
};
$('#n-title').addEventListener('input', e => {
  const n = currentNote(); if (!n) return;
  n.title = e.target.value; n.updated = Date.now();
  save(); renderSidebar();
});
$('#n-tags').addEventListener('input', e => {
  const n = currentNote(); if (!n) return;
  n.tags = [...new Set(e.target.value.split(',').map(t => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean))];
  n.updated = Date.now();
  save(); renderSidebar();
});
$('#n-body').addEventListener('input', e => {
  const n = currentNote(); if (!n) return;
  n.body = e.target.value; n.updated = Date.now();
  save(); renderSidebar();
});
$('#n-search').addEventListener('input', renderSidebar);
$('#tag-chips').addEventListener('click', e => {
  const chip = e.target.closest('[data-tag]');
  if (!chip) return;
  noteFilter = chip.dataset.tag || null;
  renderSidebar();
});
$('#note-list').addEventListener('click', e => {
  const item = e.target.closest('[data-id]');
  if (!item) return;
  noteId = item.dataset.id;
  renderNotes();
});

$('#capture-form').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('#capture-input').value.trim();
  if (!text) return;
  state.notes.push({ id: uid(), title: text.slice(0, 60), body: text, tags: ['inbox'], updated: Date.now() });
  save();
  $('#capture-input').value = '';
  renderSidebar();
  toast('Captured to Inbox');
});

/* ---------- Photo events ---------- */
const photoRow = $('#photo-row');

photoRow.addEventListener('click', e => {
  const add = e.target.closest('[data-add]');
  if (add) { $('#photo-input').click(); return; }
  const del = e.target.closest('[data-del]');
  if (del) { deletePhoto(del.dataset.del); return; }
  const open = e.target.closest('[data-open]');
  if (open) openLightbox(open.dataset.open);
});
$('#photo-input').addEventListener('change', e => {
  if (e.target.files.length) addPhotos(e.target.files);
  e.target.value = '';
});

['dragenter', 'dragover'].forEach(ev => photoRow.addEventListener(ev, e => {
  e.preventDefault();
  photoRow.classList.add('drag');
}));
['dragleave', 'drop'].forEach(ev => photoRow.addEventListener(ev, e => {
  e.preventDefault();
  photoRow.classList.remove('drag');
}));
photoRow.addEventListener('drop', e => {
  const files = e.dataTransfer && e.dataTransfer.files;
  if (files && files.length) addPhotos(files);
});

$('#lb-close').onclick = closeLightbox;
$('#lb-prev').onclick = () => stepLightbox(-1);
$('#lb-next').onclick = () => stepLightbox(1);
$('#lb-del').onclick = () => {
  const id = lbId;
  const list = photosToday();
  if (list.length <= 1) { deletePhoto(id); closeLightbox(); return; }
  const next = list[(list.findIndex(p => p.id === id) + 1) % list.length].id;
  deletePhoto(id);
  lbId = next;
  renderLightbox();
};
$('#lightbox').addEventListener('click', e => { if (e.target.id === 'lightbox') closeLightbox(); });
document.addEventListener('keydown', e => {
  if ($('#lightbox').hidden) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowLeft') stepLightbox(-1);
  else if (e.key === 'ArrowRight') stepLightbox(1);
});

/* ---------- Countdown events ---------- */
$('#cd-form').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#cd-name').value.trim();
  const date = $('#cd-date').value;
  if (!name) { $('#cd-name').focus(); return; }
  if (!date) { $('#cd-date').focus(); return; }
  state.countdowns.push({ id: uid(), name, date });
  save(); renderCountdown();
  $('#cd-name').value = '';
  $('#cd-date').value = '';
  $('#cd-name').focus();
});
$('#cd-list').addEventListener('click', e => {
  const del = e.target.closest('[data-del]');
  if (!del) return;
  state.countdowns = state.countdowns.filter(c => c.id !== del.dataset.del);
  save(); renderCountdown();
});
$('#cd-clear').onclick = () => {
  const now = new Date();
  const passed = state.countdowns.filter(c => cdDays(c, now) < 0).length;
  if (!passed) return;
  if (!confirm(`Remove ${passed} passed countdown${passed === 1 ? '' : 's'}?`)) return;
  state.countdowns = state.countdowns.filter(c => cdDays(c, now) >= 0);
  save(); renderCountdown();
  toast('Passed countdowns cleared');
};

/* ---------- Settings events ---------- */
$('#settings-btn').onclick = () => { fillSettings(); $('#settings').hidden = false; };
$('#settings-close').onclick = () => { $('#settings').hidden = true; };
$('#settings').addEventListener('click', e => { if (e.target.id === 'settings') $('#settings').hidden = true; });
$('#s-theme').onchange = e => { state.settings.theme = e.target.value; saveSettings(); };
$('#s-accent').addEventListener('click', e => {
  const b = e.target.closest('[data-color]');
  if (!b) return;
  state.settings.accent = b.dataset.color;
  saveSettings(); fillSettings();
});
$('#s-city').onchange = e => { state.settings.city = e.target.value.trim(); saveSettings(); loadWeather(); };
$('#s-units').onchange = e => { state.settings.units = e.target.value; saveSettings(); loadWeather(); };
$('#s-reminders').onchange = e => {
  if (e.target.checked && 'Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  state.settings.reminders = e.target.checked;
  saveSettings();
};
$('#s-prompt').onchange = e => { state.settings.dailyPrompt = e.target.checked; saveSettings(); };
$('#s-photos-clear').onclick = () => {
  const total = photoCount();
  if (!total) { toast('No photos to delete'); return; }
  if (!confirm(`Delete all ${total} photos? This cannot be undone.`)) return;
  state.photos = {};
  save(); renderPhotos(); renderSettingsInfo();
  toast('All photos deleted');
};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySettings);

$('#export').onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `myday-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};
$('#import-btn').onclick = () => $('#import-file').click();
$('#import-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== 'object') throw new Error();
    state = { ...structuredClone(DEFAULTS), ...data, settings: { ...DEFAULTS.settings, ...(data.settings || {}) } };
    save(); applySettings(); renderAll(); fillSettings(); loadWeather();
    toast('Backup imported');
  } catch {
    alert('That file is not a valid backup.');
  }
  e.target.value = '';
});

/* ---------- Init ---------- */
async function startApp() {
  await loadRemote();
  fillTimeSelects();
  applySettings();
  ensureDailyPrompt();
  tick();
  setInterval(tick, 1000);
  renderAll();
  loadWeather();
  setInterval(loadWeather, 30 * 60 * 1000);
}

document.addEventListener('visibilitychange', async () => {
  if (document.hidden) return;
  await loadRemote();
  applySettings();
  renderAll();
});

startApp();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
