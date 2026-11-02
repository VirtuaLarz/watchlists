// Watch Lists — standalone app. Google sign-in and sync via Firebase; titles and posters from TMDB.
import { firebaseConfig } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = s => document.querySelector(s);
const CHUNK = 700, PAGE = 150, IMG = "https://image.tmdb.org/t/p/";
const S = { uid: null, lists: {}, chunks: {}, cur: null, q: "", kind: "all", scope: "list", shown: PAGE, tmdbKey: "", shared: [], genre: "", sort: "list", gmap: {}, loaded: { lists: false, chunks: false }, unsub: [] };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const todayISO = new Date().toISOString().slice(0, 10);
function fmtDate(d) { if (!d || d.length < 10) return d ? d.slice(0, 4) : "—"; return `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`; }
function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2800); }
const keyOf = it => `${it.t}:${it.i}`;
function pref(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

/* ---------- genres ---------- */
// Existing titles: looked up in genres.json (built from TMDB). New titles keep their own genres in "g".
const TMDB_GENRES = { 28: ["Action"], 12: ["Adventure"], 16: ["Animation"], 35: ["Comedy"], 80: ["Crime"], 99: ["Documentary"], 18: ["Drama"], 10751: ["Family"], 14: ["Fantasy"], 36: ["History"], 27: ["Horror"], 10402: ["Music"], 9648: ["Mystery"], 10749: ["Romance"], 878: ["Sci-Fi"], 53: ["Thriller"], 10752: ["War"], 37: ["Western"], 10759: ["Action", "Adventure"], 10762: ["Kids"], 10764: ["Reality"], 10765: ["Sci-Fi", "Fantasy"], 10767: ["Talk"], 10768: ["War"], 10763: ["News"], 10766: ["Soap"] };
const genresFromIds = ids => [...new Set((ids || []).flatMap(id => TMDB_GENRES[id] || []))];
function genreOf(it) { return it.g || S.gmap[keyOf(it)] || []; }
// genres.txt: line 1 = genre names joined by "|"; then one line per type ("m" movies, "t" shows) of
// space-separated "<id delta>.<genre bitmask>" pairs in base 36, ids ascending.
fetch("genres.txt").then(r => r.text()).then(txt => {
  const [head, ...rows] = txt.trim().split("\n"), labels = head.split("|"), map = {};
  for (const row of rows) {
    const t = row[0]; let id = 0;
    for (const pair of row.slice(1).split(" ")) {
      const [dl, m] = pair.split("."); id += parseInt(dl, 36); const mask = parseInt(m, 36);
      map[`${t}:${id}`] = labels.filter((_, i) => mask & (1 << i));
    }
  }
  S.gmap = map; fillGenres(labels); render();
}).catch(() => fillGenres([]));
function fillGenres(labels) {
  const all = new Set(labels); for (const [it] of allItems()) (it.g || []).forEach(g => all.add(g));
  const sel = $("#genre"), cur = S.genre;
  sel.innerHTML = `<option value="">All genres</option>` + [...all].sort().map(g => `<option${g === cur ? " selected" : ""}>${esc(g)}</option>`).join("");
}

/* ---------- Firebase ---------- */
if (!firebaseConfig || !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("PASTE")) {
  $("#sub").textContent = "Setup needed";
  $("#signin").hidden = false;
  $("#signin").innerHTML = `<h2>Almost there</h2><p>Paste your Firebase settings into <b>config.js</b>, then reload. The setup guide shows where to find them.</p>`;
  throw new Error("Missing Firebase config");
}
const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = initializeFirestore(fb, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
const userCol = name => collection(db, "users", S.uid, name);
const userDoc = (name, id) => doc(db, "users", S.uid, name, id);

$("#googleBtn").onclick = async () => {
  const provider = new GoogleAuthProvider();
  $("#signinMsg").textContent = "";
  try { await signInWithPopup(auth, provider); }
  catch (e) {
    if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") { await signInWithRedirect(auth, provider); return; }
    if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request")
      $("#signinMsg").textContent = e.code === "auth/unauthorized-domain"
        ? "This web address isn't approved in Firebase yet. Add it under Authentication → Settings → Authorized domains."
        : "Sign-in didn't finish. Try again.";
  }
};
getRedirectResult(auth).catch(() => {});

onAuthStateChanged(auth, user => {
  S.unsub.forEach(u => u()); S.unsub = [];
  S.lists = {}; S.chunks = {}; S.loaded = { lists: false, chunks: false };
  if (!user) {
    S.uid = null;
    $("#signin").hidden = false; $("#appView").hidden = true;
    ["#addBtn", "#manageBtn", "#settingsBtn"].forEach(s => $(s).hidden = true);
    $("#tabs").innerHTML = ""; $("#sub").textContent = "Signed out";
    return;
  }
  S.uid = user.uid;
  $("#signin").hidden = true; $("#appView").hidden = false;
  ["#addBtn", "#manageBtn", "#settingsBtn"].forEach(s => $(s).hidden = false);
  let t; const later = () => { clearTimeout(t); t = setTimeout(render, 60); };
  const fail = () => toast("Lost the connection to your lists. Reload to reconnect.");
  S.unsub.push(onSnapshot(userCol("lists"), s => { S.lists = {}; s.forEach(d => S.lists[d.id] = d.data()); S.loaded.lists = true; later(); }, fail));
  S.unsub.push(onSnapshot(userCol("chunks"), s => { S.chunks = {}; s.forEach(d => S.chunks[d.id] = d.data()); S.loaded.chunks = true; later(); }, fail));
  S.unsub.push(onSnapshot(userDoc("settings", "main"), d => { S.tmdbKey = d.exists() ? (d.data().tmdbKey || "") : ""; }, () => {}));
  S.unsub.push(onSnapshot(collection(db, "sharedKeys"), s => { S.shared = []; s.forEach(d => { const v = d.data(); if (v.key) S.shared.push({ uid: d.id, key: v.key, name: v.name || "someone", at: v.at || "" }); }); S.shared.sort((a, b) => a.at.localeCompare(b.at)); }, () => {}));
  render();
});

/* ---------- data ---------- */
function listOrder() { return Object.entries(S.lists).sort((a, b) => (a[1].pos ?? 0) - (b[1].pos ?? 0)).map(([id, l]) => ({ id, ...l })); }
function itemsOf(lid) { return Object.values(S.chunks).filter(c => c.list === lid).sort((a, b) => a.k - b.k).flatMap(c => c.items || []); }
function allItems() { const out = []; for (const l of listOrder()) for (const it of itemsOf(l.id)) out.push([it, l]); return out; }
function whereIs(it) { for (const l of listOrder()) if (itemsOf(l.id).some(x => keyOf(x) === keyOf(it))) return l; return null; }

async function saveList(lid, items) {
  const old = Object.entries(S.chunks).filter(([, c]) => c.list === lid);
  const n = Math.max(1, Math.ceil(items.length / CHUNK));
  const batch = writeBatch(db); let ops = 0;
  for (let k = 0; k < n; k++) {
    const part = items.slice(k * CHUNK, (k + 1) * CHUNK), id = `${lid}~${k}`, prev = S.chunks[id];
    if (prev && JSON.stringify(prev.items) === JSON.stringify(part)) continue;
    batch.set(userDoc("chunks", id), { list: lid, k, items: part }); ops++;
  }
  for (const [id, c] of old) if (c.k >= n) { batch.delete(userDoc("chunks", id)); ops++; }
  if (ops) await batch.commit();
}
function insertByDate(items, it) {
  const d = it.d || "9999"; let i = items.findIndex(x => (x.d || "9999") > d); if (i < 0) i = items.length;
  const copy = items.slice(); copy.splice(i, 0, it); return copy;
}
const slug = n => n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "list";

/* ---------- posters ---------- */
function posterEl(it, big) {
  const el = document.createElement("div"); el.className = "poster";
  el.innerHTML = `<span class="ph">${esc(it.n)}</span>${big ? "" : `<span class="kind">${it.t === "t" ? "Show" : "Film"}</span>`}`;
  if (it.p) {
    const img = new Image(); img.alt = ""; img.loading = "lazy"; img.decoding = "async";
    img.src = IMG + (big ? "w342" : "w185") + it.p;
    img.onload = () => el.querySelector(".ph")?.remove();
    img.onerror = () => img.remove();
    el.prepend(img);
  }
  return el;
}

/* ---------- render ---------- */
function openList(id) { S.cur = id; S.shown = PAGE; S.sel = null; renderSelBar(); render(); window.scrollTo({ top: 0 }); }
function everyScope() { return !S.cur || (S.scope === "every" && (S.q.trim() || S.genre)); }
function renderTabs() {
  const tabs = $("#tabs"); tabs.innerHTML = "";
  const mk = (label, n, sel, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "tab"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(sel)); b.innerHTML = `${esc(label)}<span class="n">${n}</span>`; b.onclick = fn; tabs.appendChild(b); };
  mk("All lists", listOrder().length, !S.cur, () => openList(null));
  for (const l of listOrder()) mk(l.name, itemsOf(l.id).length, l.id === S.cur, () => openList(l.id));
  tabs.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "center" });
}
function renderHome() {
  const home = $("#home"); home.innerHTML = "";
  for (const l of listOrder()) {
    const its = itemsOf(l.id), yrs = its.map(i => +i.y).filter(Boolean), films = its.filter(i => i.t === "m").length;
    const b = document.createElement("button"); b.type = "button"; b.className = "ltile";
    const m = document.createElement("div"); m.className = "mosaic";
    const pick = its.length <= 3 ? its : [its[0], its[Math.floor(its.length / 2)], its[its.length - 1]];
    for (let k = 0; k < 3; k++) { if (pick[k]) m.appendChild(posterEl(pick[k], true)); else { const e = document.createElement("div"); e.className = "poster"; m.appendChild(e); } }
    b.appendChild(m);
    b.insertAdjacentHTML("beforeend", `<span class="ln">${esc(l.name)}</span><span class="ls"><span>${its.length.toLocaleString()} titles</span><span>${yrs.length ? `${Math.min(...yrs)}–${Math.max(...yrs)}` : "empty"}</span></span><span class="ls"><span>${films} films · ${its.length - films} shows</span></span>`);
    b.onclick = () => openList(l.id);
    home.appendChild(b);
  }
}
function filtered() {
  const q = S.q.trim().toLowerCase();
  let rows = everyScope() ? allItems() : itemsOf(S.cur).map(it => [it, { id: S.cur, ...S.lists[S.cur] }]);
  if (S.kind !== "all") rows = rows.filter(([it]) => it.t === (S.kind === "movie" ? "m" : "t"));
  if (q) rows = rows.filter(([it]) => it.n.toLowerCase().includes(q) || String(it.y).includes(q));
  if (S.genre) rows = rows.filter(([it]) => genreOf(it).includes(S.genre));
  const d = it => it.d || `${it.y || 9999}`;
  if (S.sort === "old") rows = rows.slice().sort((a, b) => d(a[0]).localeCompare(d(b[0])));
  else if (S.sort === "new") rows = rows.slice().sort((a, b) => d(b[0]).localeCompare(d(a[0])));
  else if (S.sort === "az") rows = rows.slice().sort((a, b) => a[0].n.localeCompare(b[0].n, undefined, { sensitivity: "base", numeric: true }));
  return rows;
}
function renderFirstRun() {
  const box = $("#firstRun");
  const ready = S.loaded.lists && S.loaded.chunks;
  box.hidden = !(ready && !listOrder().length);
  if (box.hidden) return;
  box.innerHTML = `<div class="notice"><p><b>Your account has no lists yet.</b> Load your saved lists from the file <b>watchlists-import.json</b>, or start from scratch with “Lists → Add list”.</p><button class="btn primary" id="frImport" type="button">Load my lists from file</button></div>`;
  $("#frImport").onclick = () => $("#importFile").click();
}
function render() {
  if (!S.uid) return;
  const lists = listOrder();
  if (S.cur && !S.lists[S.cur]) S.cur = null;
  renderTabs(); renderFirstRun();
  const total = lists.reduce((a, l) => a + itemsOf(l.id).length, 0);
  $("#sub").textContent = lists.length ? `${lists.length} lists · ${total.toLocaleString()} titles` : (S.loaded.lists ? "No lists yet" : "Loading your lists…");
  $("#scopeSeg").hidden = !S.cur;
  $("#q").placeholder = S.cur ? "Search this list" : "Search all lists";
  const grid = $("#grid"); grid.innerHTML = "";
  const homeView = !S.cur && !S.q.trim() && !S.genre;
  $("#home").hidden = !homeView;
  if (homeView) { renderHome(); $("#meta").innerHTML = lists.length ? `<span>All lists</span><span>Tap a list to open it</span>` : ""; $("#moreWrap").hidden = true; return; }
  const rows = filtered(), films = rows.filter(([i]) => i.t === "m").length;
  const name = everyScope() ? "Every list" : esc(S.lists[S.cur].name);
  $("#meta").innerHTML = `<span>${name}</span><span>${rows.length.toLocaleString()} shown</span><span>${films} films · ${rows.length - films} shows</span><span>${{ list: everyScope() ? "Grouped by list" : "List order (release date)", old: "Oldest first", new: "Newest first", az: "Title A–Z" }[S.sort]}</span>${S.genre ? `<span>${esc(S.genre)}</span>` : ""}<button class="btn ghost small" id="selBtn" type="button">${S.sel ? "Done selecting" : "Select"}</button>`;
  $("#selBtn").onclick = () => { S.sel = S.sel ? null : new Map(); render(); renderSelBar(); };
  if (!rows.length) grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><h2>${S.q ? "No matches" : "This list is empty"}</h2><p>${S.q ? "Try another spelling, or use + Add to find it on TMDB." : "Use + Add to find a title, or move one here from another list."}</p></div>`;
  const frag = document.createDocumentFragment();
  for (const [it, lst] of rows.slice(0, S.shown)) {
    const b = document.createElement("button"); b.type = "button"; b.className = "card";
    b.appendChild(posterEl(it));
    const upcoming = it.d && it.d > todayISO;
    b.insertAdjacentHTML("beforeend", `<span class="t">${esc(it.n)}</span><span class="y">${upcoming ? `<em>Coming ${esc(fmtDate(it.d))}</em>` : esc(it.y || "")}${everyScope() ? ` · ${esc(lst.name)}` : ""}</span>`);
    const sk = `${keyOf(it)}@${lst.id}`;
    if (S.sel) { b.classList.add("selecting"); if (S.sel.has(sk)) b.classList.add("sel"); b.setAttribute("aria-pressed", String(S.sel.has(sk))); }
    b.onclick = () => {
      if (!S.sel) return openDetail(it, lst.id);
      if (S.sel.has(sk)) { S.sel.delete(sk); b.classList.remove("sel"); } else { S.sel.set(sk, { it, lid: lst.id }); b.classList.add("sel"); }
      b.setAttribute("aria-pressed", String(S.sel.has(sk))); renderSelBar();
    };
    frag.appendChild(b);
  }
  grid.appendChild(frag);
  $("#moreWrap").hidden = rows.length <= S.shown;
}

/* ---------- select many ---------- */
function renderSelBar() {
  let bar = $("#selBar");
  if (!S.sel) { bar?.remove(); return; }
  if (!bar) { bar = document.createElement("div"); bar.id = "selBar"; bar.className = "selbar"; document.body.appendChild(bar); }
  const n = S.sel.size;
  bar.innerHTML = `<div class="wrap selin"><b>${n} selected</b>
    <select id="selTo" aria-label="Move selected to list">${listOptions(S.cur || listOrder()[0]?.id)}</select>
    <button class="btn primary" id="selMove" type="button"${n ? "" : " disabled"}>Move</button>
    <button class="btn danger" id="selRm" type="button"${n ? "" : " disabled"}>Remove</button>
    <button class="btn ghost" id="selX" type="button">Cancel</button></div>`;
  $("#selX").onclick = () => { S.sel = null; render(); renderSelBar(); };
  $("#selMove").onclick = async e => {
    const to = $("#selTo").value, picks = [...S.sel.values()].filter(p => p.lid !== to);
    if (!picks.length) { toast("Those titles are already in that list."); return; }
    e.target.disabled = true;
    try {
      const keys = new Set(picks.map(p => keyOf(p.it)));
      let dest = itemsOf(to).filter(x => !keys.has(keyOf(x)));
      for (const p of picks) dest = insertByDate(dest, p.it);
      await saveList(to, dest);
      for (const lid of new Set(picks.map(p => p.lid))) await saveList(lid, itemsOf(lid).filter(x => !keys.has(keyOf(x))));
      toast(`Moved ${picks.length} to ${S.lists[to].name}`); S.sel = null; render(); renderSelBar();
    } catch (err) { e.target.disabled = false; toast("Couldn’t move them. Check your connection and try again."); }
  };
  $("#selRm").onclick = e => {
    if (e.target.dataset.armed !== "1") { e.target.dataset.armed = "1"; e.target.textContent = `Remove ${n}? Tap again`; return; }
    e.target.disabled = true;
    (async () => {
      try {
        const picks = [...S.sel.values()];
        for (const lid of new Set(picks.map(p => p.lid))) { const keys = new Set(picks.filter(p => p.lid === lid).map(p => keyOf(p.it))); await saveList(lid, itemsOf(lid).filter(x => !keys.has(keyOf(x)))); }
        toast(`Removed ${picks.length}`); S.sel = null; render(); renderSelBar();
      } catch (err) { e.target.disabled = false; toast("Couldn’t remove them. Try again."); }
    })();
  };
}

/* ---------- sheets ---------- */
function openSheet(build) {
  const host = $("#sheetHost");
  host.innerHTML = `<div class="scrim"></div><div class="sheet" role="dialog" aria-modal="true"><div class="in"></div></div>`;
  const onKey = e => { if (e.key === "Escape") close(); };
  const close = () => { host.innerHTML = ""; document.removeEventListener("keydown", onKey); };
  document.addEventListener("keydown", onKey);
  host.querySelector(".scrim").onclick = close;
  build(host.querySelector(".in"), close);
  host.querySelector("input,select,button")?.focus({ preventScroll: true });
}
const listOptions = sel => listOrder().map(l => `<option value="${esc(l.id)}"${l.id === sel ? " selected" : ""}>${esc(l.name)}</option>`).join("");

function openDetail(it, lid) {
  openSheet((el, close) => {
    const tmdb = `https://www.themoviedb.org/${it.t === "t" ? "tv" : "movie"}/${encodeURIComponent(it.i)}`;
    el.innerHTML = `<div class="detail"><div id="dp"></div><div class="facts">
      <h2>${esc(it.n)}</h2>
      <dl class="facts" style="margin:0">
        <div><dt>${it.t === "t" ? "First aired" : "Released"}</dt><dd>${esc(fmtDate(it.d))}</dd></div>
        <div><dt>Type</dt><dd>${it.t === "t" ? "TV show" : "Movie"}</dd></div>
        <div><dt>List</dt><dd>${esc(S.lists[lid]?.name)}</dd></div>
        <div><dt>TMDB</dt><dd>${it.t === "t" ? "tv" : "movie"}/${esc(it.i)}</dd></div>
      </dl></div></div>
      <a class="btn" href="${tmdb}" target="_blank" rel="noopener">Open on TMDB ↗</a>
      <label class="f" for="mv">Move to list<select id="mv">${listOptions(lid)}</select></label>
      <div class="row"><button class="btn primary" id="mvGo" type="button">Move</button><button class="btn danger" id="rm" type="button">Remove</button><button class="btn ghost" id="cl" type="button">Close</button></div>
      <div id="cf"></div>`;
    el.querySelector("#dp").appendChild(posterEl(it, true));
    el.querySelector("#cl").onclick = close;
    el.querySelector("#mvGo").onclick = async e => {
      const to = el.querySelector("#mv").value; if (to === lid) { close(); return; }
      e.target.disabled = true;
      try {
        await saveList(to, insertByDate(itemsOf(to).filter(x => keyOf(x) !== keyOf(it)), it));
        await saveList(lid, itemsOf(lid).filter(x => keyOf(x) !== keyOf(it)));
        close(); toast(`Moved to ${S.lists[to].name}`);
      } catch (err) { e.target.disabled = false; toast("Couldn’t move it. Check your connection and try again."); }
    };
    el.querySelector("#rm").onclick = () => {
      el.querySelector("#cf").innerHTML = `<div class="confirm"><span>Remove <b>${esc(it.n)}</b> from ${esc(S.lists[lid].name)}?</span><div class="row"><button class="btn danger" id="rmYes" type="button">Remove</button><button class="btn ghost" id="rmNo" type="button">Keep it</button></div></div>`;
      el.querySelector("#rmNo").onclick = () => el.querySelector("#cf").innerHTML = "";
      el.querySelector("#rmYes").onclick = async e => {
        e.target.disabled = true;
        try { await saveList(lid, itemsOf(lid).filter(x => keyOf(x) !== keyOf(it))); close(); toast("Removed"); }
        catch (err) { e.target.disabled = false; toast("Couldn’t remove it. Try again."); }
      };
    };
  });
}

/* ---------- TMDB search ---------- */
// Your own key wins; otherwise use a key someone has shared with everyone on this app.
function activeKey() { return (S.tmdbKey || "").trim() || (S.shared.find(x => x.uid !== S.uid) || S.shared[0] || {}).key || ""; }
function keySource() { if ((S.tmdbKey || "").trim()) return "your own key"; const s = S.shared.find(x => x.uid !== S.uid); return s ? `a key shared by ${s.name}` : ""; }
async function tmdb(path, params = {}, keyOverride) {
  const k = (keyOverride ?? activeKey()).trim(); const bearer = k.length > 60;
  const u = new URL("https://api.themoviedb.org/3" + path);
  for (const [a, b] of Object.entries(params)) u.searchParams.set(a, b);
  if (!bearer) u.searchParams.set("api_key", k);
  const r = await fetch(u, { headers: bearer ? { Authorization: "Bearer " + k, accept: "application/json" } : { accept: "application/json" } });
  if (r.status === 401) throw new Error("badkey");
  if (!r.ok) throw new Error("http");
  return r.json();
}
function openAdd() {
  if (!activeKey()) { openSettings("To search TMDB, add a TMDB key here, or ask someone who uses this app to share theirs."); return; }
  openSheet((el, close) => {
    el.innerHTML = `<h2>Add a title</h2>
      <div class="row"><input class="search" id="aQ" type="search" placeholder="Search TMDB, e.g. Ultraman Leo" autocomplete="off" aria-label="Search TMDB"><button class="btn primary" id="aGo" type="button">Search</button></div>
      <label class="f" for="aL">Add to list<select id="aL">${listOptions(S.cur || listOrder()[0]?.id)}</select></label>
      <p class="status" id="aS">Results show movies and shows. Tap one to add it in release-date order.</p>
      <div class="results" id="aR"></div>
      <div class="row"><button class="btn ghost" id="aX" type="button">Done</button></div>`;
    el.querySelector("#aX").onclick = close;
    const run = async () => {
      const q = el.querySelector("#aQ").value.trim(); if (!q) return;
      const st = el.querySelector("#aS"), box = el.querySelector("#aR");
      st.textContent = "Searching…"; box.innerHTML = "";
      try {
        const data = await tmdb("/search/multi", { query: q, include_adult: "false", language: "en-US", page: "1" });
        const res = (data.results || []).filter(r => r.media_type === "movie" || r.media_type === "tv");
        st.textContent = res.length ? `${res.length} results` : "No matches on TMDB. Try a different spelling or add the year.";
        for (const r of res) {
          const it = { i: String(r.id), t: r.media_type === "tv" ? "t" : "m", n: r.title || r.name || "Untitled", d: r.release_date || r.first_air_date || "", p: r.poster_path || "" };
          const g = genresFromIds(r.genre_ids); if (g.length) it.g = g;
          it.y = it.d ? +it.d.slice(0, 4) : "";
          const where = whereIs(it);
          const b = document.createElement("button"); b.type = "button"; b.className = "res" + (where ? " in" : "");
          b.appendChild(posterEl(it, true));
          b.insertAdjacentHTML("beforeend", `<span><b>${esc(it.n)}</b><small>${it.t === "t" ? "Show" : "Movie"} · ${esc(fmtDate(it.d))}${where ? ` · already in ${esc(where.name)}` : ""}</small><span class="ov">${esc(r.overview || "")}</span></span><span class="btn">${where ? "Added" : "Add"}</span>`);
          b.onclick = async () => {
            if (whereIs(it)) { toast(`Already in ${whereIs(it).name}`); return; }
            const lid = el.querySelector("#aL").value; if (!lid) { toast("Make a list first (Lists → Add list)."); return; }
            b.disabled = true;
            try { await saveList(lid, insertByDate(itemsOf(lid), it)); b.classList.add("in"); b.querySelector(".btn").textContent = "Added"; toast(`Added to ${S.lists[lid].name}`); }
            catch (e) { b.disabled = false; toast("Couldn’t add it. Try again."); }
          };
          box.appendChild(b);
        }
      } catch (e) {
        st.textContent = e.message === "badkey" ? "TMDB didn’t accept your key. Check it in Settings." : "Couldn’t reach TMDB. Check your connection and try again.";
      }
    };
    el.querySelector("#aGo").onclick = run;
    el.querySelector("#aQ").addEventListener("keydown", e => { if (e.key === "Enter") run(); });
  });
}

/* ---------- settings, import, export ---------- */
function openSettings(msg) {
  openSheet((el, close) => {
    const mine = S.shared.find(x => x.uid === S.uid);
    const src = keySource();
    el.innerHTML = `<h2>Settings</h2>
      ${msg ? `<p class="hint">${esc(msg)}</p>` : ""}
      <p class="status">${src ? `TMDB search is using ${esc(src)}.` : "TMDB search is off until a key is added or shared."}</p>
      <label class="f" for="tk">Your TMDB API key (optional if someone shares theirs)<input id="tk" type="text" autocomplete="off" spellcheck="false" value="${esc(S.tmdbKey)}" placeholder="Paste from themoviedb.org → Settings → API"></label>
      <label class="row" for="shareKey" style="font-size:14px;gap:10px"><input id="shareKey" type="checkbox"${mine ? " checked" : ""}> Share my key with everyone who signs in to this app</label>
      <p class="hint">Shared keys let other people search TMDB without getting their own key. People can't see your lists, only use the key for searches.</p>
      <div class="row"><button class="btn primary" id="tkSave" type="button">Save</button><span class="status" id="tkS"></span></div>
      <hr style="border:0;border-top:1px solid var(--line);width:100%">
      <div class="row"><button class="btn" id="exp" type="button">Download a backup</button><button class="btn" id="imp" type="button">Load lists from a file</button></div>
      <p class="hint">Loading a file replaces lists with the same name and adds the rest. Signed in as ${esc(auth.currentUser?.email || "")}.</p>
      <div class="row"><button class="btn danger" id="out" type="button">Sign out</button><button class="btn ghost" id="sX" type="button">Close</button></div>`;
    el.querySelector("#sX").onclick = close;
    el.querySelector("#tkSave").onclick = async () => {
      const v = el.querySelector("#tk").value.trim(), share = el.querySelector("#shareKey").checked, st = el.querySelector("#tkS");
      if (share && !v) { st.textContent = "Add your key above to share it."; return; }
      st.textContent = "Saving…";
      try {
        await setDoc(userDoc("settings", "main"), { tmdbKey: v }, { merge: true }); S.tmdbKey = v;
        const ref = doc(db, "sharedKeys", S.uid);
        if (share) await setDoc(ref, { key: v, name: (auth.currentUser?.displayName || "").split(" ")[0] || "a friend", at: mine?.at || new Date().toISOString() });
        else if (mine) await deleteDoc(ref);
      } catch (e) { st.textContent = "Couldn’t save. Check your connection and try again."; return; }
      if (!v) { st.textContent = keySource() ? `Saved. Searching with ${keySource()}.` : "Saved."; return; }
      try { await tmdb("/configuration", {}, v); st.textContent = share ? "Saved and shared. TMDB accepted the key." : "Saved. TMDB accepted the key."; }
      catch (e) { st.textContent = e.message === "badkey" ? "Saved, but TMDB rejected this key. Double-check it." : "Saved. Couldn’t test it right now."; }
    };
    el.querySelector("#exp").onclick = exportBackup;
    el.querySelector("#imp").onclick = () => $("#importFile").click();
    el.querySelector("#out").onclick = async () => { close(); await signOut(auth); };
  });
}
function exportBackup() {
  const data = { format: "watchlists.v1", exportedAt: new Date().toISOString(), lists: listOrder().map(l => ({ id: l.id, name: l.name, pos: l.pos, items: itemsOf(l.id) })) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = `watchlists-backup-${todayISO}.json`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
$("#importFile").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.format !== "watchlists.v1" || !Array.isArray(data.lists)) throw new Error("format");
    const byName = Object.fromEntries(listOrder().map(l => [l.name.toLowerCase(), l.id]));
    let pos = Math.max(-1, ...listOrder().map(l => l.pos ?? 0)); const fresh = !listOrder().length;
    let ops = [];
    const incoming = new Set(data.lists.flatMap(l => (l.items || []).map(keyOf)));
    const targetNames = new Set(data.lists.map(l => l.name.toLowerCase()));
    let moved = 0;
    for (const l of listOrder()) {
      if (targetNames.has(l.name.toLowerCase())) continue;
      const items = itemsOf(l.id), keep = items.filter(it => !incoming.has(keyOf(it)));
      if (keep.length === items.length) continue;
      moved += items.length - keep.length;
      for (const [id, c] of Object.entries(S.chunks)) if (c.list === l.id) ops.push(["del", userDoc("chunks", id)]);
      for (let k = 0; k * CHUNK < Math.max(1, keep.length); k++) ops.push(["set", userDoc("chunks", `${l.id}~${k}`), { list: l.id, k, items: keep.slice(k * CHUNK, (k + 1) * CHUNK) }]);
    }
    for (const l of data.lists) {
      const lid = byName[l.name.toLowerCase()] || (S.lists[l.id || slug(l.name)] ? `${slug(l.name)}-${Date.now() % 10000}` : (l.id || slug(l.name)));
      if (!byName[l.name.toLowerCase()]) ops.push(["set", userDoc("lists", lid), { name: l.name, pos: fresh ? (l.pos ?? ++pos) : ++pos }]);
      for (const [id, c] of Object.entries(S.chunks)) if (c.list === lid) ops.push(["del", userDoc("chunks", id)]);
      const items = l.items || [];
      for (let k = 0; k * CHUNK < Math.max(1, items.length); k++) ops.push(["set", userDoc("chunks", `${lid}~${k}`), { list: lid, k, items: items.slice(k * CHUNK, (k + 1) * CHUNK) }]);
    }
    for (let i = 0; i < ops.length; i += 400) {
      const b = writeBatch(db);
      for (const [op, ref, val] of ops.slice(i, i + 400)) op === "set" ? b.set(ref, val) : b.delete(ref);
      await b.commit();
    }
    toast(`Loaded ${data.lists.length} list${data.lists.length > 1 ? "s" : ""}${moved ? ` · moved ${moved} title${moved > 1 ? "s" : ""} from other lists` : ""}`);
  } catch (err) { toast(err.message === "format" ? "That file isn’t a Watch Lists file." : "Couldn’t load that file. Try again."); }
});

function openManage() {
  openSheet((el, close) => {
    const draw = () => {
      const ls = listOrder();
      el.innerHTML = `<h2>Your lists</h2><p class="hint">Rename, reorder or add lists. A list can be deleted once it’s empty.</p>
      <div>${ls.map((l, i) => `<div class="listrow"><input id="ln-${esc(l.id)}" value="${esc(l.name)}" aria-label="List name"><span class="n">${itemsOf(l.id).length}</span>
        <button class="btn ghost" data-up="${i}" type="button" aria-label="Move up"${i ? "" : " disabled"}>↑</button>
        <button class="btn ghost" data-dn="${i}" type="button" aria-label="Move down"${i < ls.length - 1 ? "" : " disabled"}>↓</button>
        <button class="btn ghost danger" data-rm="${esc(l.id)}" type="button" aria-label="Delete list"${itemsOf(l.id).length ? " disabled" : ""}>✕</button></div>`).join("")}</div>
      <div class="row"><input id="newName" class="search" placeholder="New list name" aria-label="New list name"><button class="btn" id="newGo" type="button">Add list</button></div>
      <div class="row"><button class="btn primary" id="saveNames" type="button">Save names</button><button class="btn ghost" id="mX" type="button">Close</button><span class="status" id="mS"></span></div>`;
      el.querySelector("#mX").onclick = close;
      const swap = async (a, b) => { const w = writeBatch(db); w.update(userDoc("lists", ls[a].id), { pos: ls[b].pos ?? b }); w.update(userDoc("lists", ls[b].id), { pos: ls[a].pos ?? a }); try { await w.commit(); } catch (e) { toast("Couldn’t reorder. Try again."); } draw(); };
      el.querySelectorAll("[data-up]").forEach(b => b.onclick = () => swap(+b.dataset.up, +b.dataset.up - 1));
      el.querySelectorAll("[data-dn]").forEach(b => b.onclick = () => swap(+b.dataset.dn, +b.dataset.dn + 1));
      el.querySelectorAll("[data-rm]").forEach(b => b.onclick = async () => {
        const w = writeBatch(db); w.delete(userDoc("lists", b.dataset.rm));
        for (const [id, c] of Object.entries(S.chunks)) if (c.list === b.dataset.rm) w.delete(userDoc("chunks", id));
        try { await w.commit(); toast("List deleted"); } catch (e) { toast("Couldn’t delete. Try again."); } draw();
      });
      el.querySelector("#newGo").onclick = async () => {
        const n = el.querySelector("#newName").value.trim(); if (!n) return;
        let lid = slug(n), k = 2; while (S.lists[lid]) lid = `${slug(n)}-${k++}`;
        try { await setDoc(userDoc("lists", lid), { name: n, pos: Math.max(0, ...ls.map(l => l.pos ?? 0)) + 1 }); toast(`Added ${n}`); draw(); }
        catch (e) { toast("Couldn’t add the list. Try again."); }
      };
      el.querySelector("#saveNames").onclick = async () => {
        let c = 0;
        for (const l of ls) { const v = el.querySelector(`#ln-${CSS.escape(l.id)}`).value.trim(); if (v && v !== l.name) { try { await updateDoc(userDoc("lists", l.id), { name: v }); c++; } catch (e) {} } }
        el.querySelector("#mS").textContent = c ? `Saved ${c} name${c > 1 ? "s" : ""}` : "No changes";
      };
    };
    draw();
  });
}

/* ---------- keyboard-aware sheets (iPhone) ---------- */
if (window.visualViewport) {
  const vv = window.visualViewport;
  const sync = () => { document.documentElement.style.setProperty("--vvh", `${vv.height}px`); document.documentElement.style.setProperty("--vvtop", `${vv.offsetTop}px`); };
  vv.addEventListener("resize", sync); vv.addEventListener("scroll", sync); sync();
}
document.addEventListener("focusin", e => { if (e.target.matches("input[type=search], input[type=text]")) setTimeout(() => e.target.scrollIntoView({ block: "nearest" }), 250); });

/* ---------- controls ---------- */
let qT; $("#q").addEventListener("input", e => { clearTimeout(qT); qT = setTimeout(() => { S.q = e.target.value; S.shown = PAGE; render(); }, 150); });
const seg = (ids, key, vals) => ids.forEach((id, i) => $(id).onclick = () => { S[key] = vals[i]; ids.forEach((x, j) => $(x).setAttribute("aria-pressed", String(i === j))); S.shown = PAGE; render(); });
seg(["#fAll", "#fMovie", "#fTv"], "kind", ["all", "movie", "tv"]);
seg(["#sList", "#sEvery"], "scope", ["list", "every"]);
S.sort = pref("wl-sort") || "list"; $("#sort").value = S.sort;
$("#sort").onchange = e => { S.sort = e.target.value; pref("wl-sort", S.sort); S.shown = PAGE; render(); };
$("#genre").onchange = e => { S.genre = e.target.value; S.shown = PAGE; render(); };
$("#moreBtn").onclick = () => { S.shown += PAGE * 2; render(); };
$("#addBtn").onclick = () => openAdd();
$("#manageBtn").onclick = openManage;
$("#settingsBtn").onclick = () => openSettings();
