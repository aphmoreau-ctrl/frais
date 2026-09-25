import * as db from './data.js';
import { defaultConfig, PLAN, AGENDA } from './seed.js';

const $ = s => document.querySelector(s);
const A = (window.A = {});
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const addDays = (s, n) => { const d = new Date(s + 'T12:00'); d.setDate(d.getDate() + n); return iso(d); };
const hm = t => { const d = new Date(t); return `${d.getHours()} h ${pad(d.getMinutes())}`; };
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtH = h => (h || '').replace(':', ' h ');
const fDate = (s, o = { weekday: 'long', day: 'numeric', month: 'long' }) => new Date(s + 'T12:00').toLocaleDateString('fr-FR', o);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const ST = ['ok', 'warn', 'bad'], STL = { ok: 'OK', warn: 'À surveiller', bad: 'Problème' };

function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1800); }

// ---------- Configuration ----------
function cfg() {
  let c = db.get('cfg', 'main');
  if (!c) c = db.put('cfg', { id: 'main', ...defaultConfig() });
  return c;
}
const setCfg = patch => db.put('cfg', { id: 'main', ...patch });
const rayons = () => { const c = cfg(); return c.ordre.map(id => c.rayons.find(r => r.id === id)).filter(Boolean); };
const R = id => cfg().rayons.find(r => r.id === id) || { id, nom: 'Général', court: 'Général', couleur: '#8E98A1' };
const tag = id => id ? `<span class="tag" style="background:${R(id).couleur}"></span>` : '';
let lastRayon = localStorage.getItem('frais_ray') || 'fl';
const setRay = id => { lastRayon = id; try { localStorage.setItem('frais_ray', id); } catch (e) {} };

// ---------- Journée et routine ----------
const day = d => db.get('days', d) || { id: d, done: {}, extra: [], photos: {}, clos: false };
function routine(d) {
  const w = new Date(d + 'T12:00').getDay();
  const base = (cfg().routine[w] || []).map(x => ({ ...x }));
  return base.concat(day(d).extra || []).sort((a, b) => a.h.localeCompare(b.h));
}
function markTask(go) {
  const d = today(), dd = day(d);
  const t = routine(d).find(x => x.go === go && !dd.done[x.id]);
  if (t) db.put('days', { ...dd, done: { ...dd.done, [t.id]: Date.now() } });
}
A.toggleTask = (d, id) => { const dd = day(d); const done = { ...dd.done }; done[id] ? delete done[id] : (done[id] = Date.now()); db.put('days', { ...dd, done }); };
const GO = { tournee: '#/tournee', ruptures: '#/ruptures', bilan: '#/bilan', journal: '#/journal', libre: '' };

// ---------- Alertes ----------
function alerts() {
  const out = [];
  const su = db.all('suivis').filter(s => !s.closeTs);
  su.filter(s => s.type === 'temp').forEach(s => out.push(['bad', `${esc(s.crit)} : ${esc(s.val)} °C, seuil ${esc(s.max)} °C`, '#/suivis']));
  const since = Date.now() - 7 * 864e5, cnt = {};
  db.all('ruptures').filter(r => r.ts > since).forEach(r => (cnt[r.p] = (cnt[r.p] || 0) + 1));
  Object.entries(cnt).filter(([, n]) => n >= cfg().seuilRuptures).forEach(([p, n]) => out.push(['warn', `${esc(p)} : ${n} ruptures en 7 jours`, '#/ruptures-stats']));
  const so = su.filter(s => s.type !== 'temp');
  if (so.length) out.push(['warn', `${so.length} problème${so.length > 1 ? 's' : ''} relevé${so.length > 1 ? 's' : ''} non réglé${so.length > 1 ? 's' : ''}`, '#/suivis']);
  const t = today();
  db.all('actions').filter(a => a.statut !== 'fait' && a.echeance && a.echeance < t).forEach(a => out.push(['warn', `Échéance dépassée : ${esc(a.titre)}`, '#/actions']));
  const lb = (db.get('meta', 'backup') || {}).ts;
  if (!lb || Date.now() - lb > 30 * 864e5) out.push(['acc', lb ? 'Sauvegarde mensuelle à faire' : 'Aucune sauvegarde encore faite', '#/r-donnees']);
  return out;
}

// ---------- Mise en page ----------
const syncLbl = () => db.MODE === 'local' ? '<span class="sync off">mode essai, sur cet appareil</span>' : { ok: '<span class="sync ok">synchronisé</span>', pend: '<span class="sync pend">en attente d\'envoi</span>', off: '<span class="sync off">hors ligne, enregistré</span>' }[db.sync.state];
const hdr = (t, sub, back) => `<header class="top">${back ? '<button class="back" onclick="history.back()" aria-label="Retour">‹</button>' : ''}<div style="flex:1;min-width:0"><h1>${t}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div></header>`;
const lk = (href, label, right = '') => `<a class="row" href="${href}"><span class="grow">${label}</span>${right}<span class="chev">›</span></a>`;
const empty = t => `<div class="card empty">${t}</div>`;
const chipsRay = (cur, fn, withAll) => `<div class="chips" style="margin-bottom:12px">${withAll ? `<button class="chip ${!cur ? 'on' : ''}" onclick="A.${fn}('')">Tous</button>` : ''}${rayons().map(r => `<button class="chip ${r.id === cur ? 'on' : ''}" onclick="A.${fn}('${r.id}')">${tag(r.id)}${esc(r.court)}</button>`).join('')}</div>`;

const V = {};
let S = {}; // état d'écran (non enregistré)

// ---------- Accueil ----------
V[''] = () => {
  const d = today(), dd = day(d), rt = routine(d);
  const nx = rt.find(x => !dd.done[x.id]);
  const nd = rt.filter(x => dd.done[x.id]).length;
  const y = addDays(d, -1), yd = day(y), yr = routine(y);
  const yRupt = db.all('ruptures').filter(r => r.date === y).length;
  const yProb = db.all('obs').filter(o => o.date === y).reduce((n, o) => n + o.items.filter(i => i.s !== 'ok').length, 0);
  const yNotes = db.all('notes').filter(n => n.date === y).length;
  const yPh = Object.keys(yd.photos || {}).length;
  const yUndone = db.get('days', y) ? yr.filter(x => !yd.done[x.id]).length : 0;
  const al = alerts();
  const plan = db.all('plan').length ? db.all('plan') : PLAN;
  const cur = plan.find(p => p.du <= d && p.au >= d);
  const ag = AGENDA.filter(([dt]) => dt >= d).slice(0, 3);
  return hdr(cap(fDate(d)), 'Ma journée · ' + syncLbl()) +
    (db.MODE === 'local' ? '<div class="proto">Mode essai : les données restent sur cet appareil. Configure Firebase pour la synchronisation.</div>' : '') +
    (nx ? `<a class="next" href="${GO[nx.go] || '#/'}" ${nx.go === 'libre' ? `onclick="A.toggleTask('${d}','${nx.id}');return false"` : ''}><div class="l">Prochaine chose à faire · ${fmtH(nx.h)}</div><div class="t">${esc(nx.t)} ›</div></a>`
      : `<a class="next" href="#/bilan"><div class="l">${rt.length ? 'Routine terminée' : 'Pas de routine aujourd\'hui'}</div><div class="t">${dd.clos ? 'Journée clôturée ✓' : 'Bilan de fin de journée ›'}</div></a>`) +
    `<h2>Routine · ${nd} sur ${rt.length}</h2><div class="list">${rt.map(x => `<div class="row"><button class="check ${dd.done[x.id] ? 'done' : ''}" style="${dd.done[x.id] ? '' : 'background:none'};cursor:pointer" onclick="A.toggleTask('${d}','${x.id}')" aria-label="Cocher ${esc(x.t)}">${dd.done[x.id] ? '✓' : ''}</button><a href="${GO[x.go] || 'javascript:void 0'}" class="grow ${dd.done[x.id] ? 'done-t' : ''}" style="color:inherit;text-decoration:none">${esc(x.t)}</a><span class="small ${dd.done[x.id] ? 'muted' : 'acc'}">${fmtH(x.h)}</span></div>`).join('') || '<div class="empty">Aucune tâche prévue ce jour.</div>'}
    <button class="row acc" onclick="A.addTask()" style="justify-content:flex-start">+ Ajouter une tâche pour aujourd'hui</button></div>` +
    `<h2>Alertes</h2>${al.length ? al.map(([k, t, h]) => `<a class="alert a-${k}" style="display:block;text-decoration:none" href="${h}">${t}</a>`).join('') : '<div class="alert a-ok">Aucune alerte.</div>'}` +
    `<h2>Hier</h2><div class="grid2">
      <div class="kpi"><div class="v ${yUndone ? 'warn' : ''}">${yUndone}</div><div class="l">tâche${yUndone > 1 ? 's' : ''} non faite${yUndone > 1 ? 's' : ''}</div></div>
      <a class="kpi" href="#/ruptures-stats" style="color:inherit;text-decoration:none"><div class="v">${yRupt}</div><div class="l">ruptures</div></a>
      <a class="kpi" href="#/obs" style="color:inherit;text-decoration:none"><div class="v">${yProb}</div><div class="l">problèmes relevés</div></a>
      <a class="kpi" href="#/journal/${y}" style="color:inherit;text-decoration:none"><div class="v">${yNotes}</div><div class="l">notes</div></a>
      <a class="kpi" href="#/bilan/${y}" style="color:inherit;text-decoration:none;grid-column:1/-1"><div class="v">${yPh}</div><div class="l">photos de fermeture</div></a></div>` +
    `<h2>À venir</h2><div class="list">${cur ? `<a class="row" href="#/plan"><span class="grow">Étape en cours : ${esc(cur.t)}</span><span class="small muted">jusqu'au ${fDate(cur.au, { day: 'numeric', month: 'short' })}</span></a>` : ''}${ag.map(([dt, t]) => `<div class="row"><span class="grow">${esc(t)}</span><span class="small muted">${fDate(dt, { weekday: 'short', day: 'numeric', month: 'short' })}</span></div>`).join('')}</div>`;
};
A.addTask = () => sheet(`<h2 style="margin-top:0">Tâche pour aujourd'hui</h2><div class="field"><span>Intitulé</span><input type="text" id="tt"></div><div class="field"><span>Heure</span><input type="time" id="th" value="${nowHM()}" style="width:100%;font:16px Barlow;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink)"></div><div class="btns"><button class="btn sec" onclick="A.close()">Annuler</button><button class="btn" onclick="A.saveTask()">Ajouter</button></div>`, '#tt');
A.saveTask = () => { const t = $('#tt').value.trim(); if (!t) { $('#tt').style.borderColor = 'var(--bad)'; return; } const d = today(), dd = day(d); db.put('days', { ...dd, extra: [...(dd.extra || []), { id: 'x' + db.newId(), t, h: $('#th').value || nowHM(), go: 'libre' }] }); A.close(); toast('Tâche ajoutée'); };

// ---------- Saisir ----------
V['saisir'] = () => hdr('Saisir', 'l\'heure et le rayon se remplissent tout seuls') +
  `<div class="tiles"><a class="tile main" href="#/tournee">Démarrer ma tournée<small>Les rayons s'enchaînent dans ton ordre de passage</small></a>
  <a class="tile" href="#/ruptures">Rupture<small>scan ou favori</small></a><button class="tile" onclick="A.note()">Note<small>dictée possible</small></button>
  <button class="tile" onclick="A.photoNote()">Photo<small>avec une note</small></button><a class="tile" href="#/suivis">Suivis<small>problèmes ouverts</small></a>
  <a class="tile main" href="#/bilan" style="background:var(--card);color:var(--ink);border-color:var(--line)">Bilan de fin de journée<small style="color:var(--muted)">compléter ce qui manque</small></a></div>
  <div class="small muted mt">Casse, lots du soir et absences arrivent avec les versions suivantes.</div><div class="mt">${lk('#/raccourcis', 'Raccourcis iPhone et Siri')}</div>`;

// ---------- Tournée guidée ----------
let T = null;
const lastObs = r => db.all('obs').filter(o => o.rayon === r).sort((a, b) => b.ts - a.ts)[0];
const openSuivi = (r, crit, type) => db.all('suivis').find(s => !s.closeTs && s.rayon === r && s.crit === crit && (s.type || 'obs') === type);
V['tournee'] = () => {
  if (!T) T = { i: 0, res: [] };
  const ord = rayons();
  if (T.i >= ord.length) {
    const html = hdr('Tournée terminée', `${ord.length} rayons · ${T.res.reduce((n, x) => n + x.n, 0)} points à suivre`, 1) +
      `<div class="alert a-ok">Observations enregistrées. Les problèmes ont créé ou mis à jour des suivis.</div><div class="list">${T.res.map(x => `<div class="row"><span class="grow">${tag(x.r)}${esc(R(x.r).nom)}</span>${x.n ? `<span class="pill p-warn">${x.n} à suivre</span>` : '<span class="pill p-ok">Tout OK</span>'}</div>`).join('')}</div><button class="btn mt" onclick="A.endTour()">Retour à ma journée</button>`;
    return html;
  }
  const r = ord[T.i].id, cs = cfg().criteres[r] || [];
  if (!T.cur || T.cur.r !== r) {
    const lo = lastObs(r);
    T.cur = { r, v: cs.map(c => { const it = lo && lo.items.find(i => i.c === c); return it ? it.s : null; }), prev: cs.map(c => { const it = lo && lo.items.find(i => i.c === c); return it ? it.s : null; }), com: {}, ph: {}, close: {}, temp: {}, tclose: {} };
  }
  const c = T.cur, miss = c.v.filter(x => !x).length, ch = c.v.filter((x, j) => x && c.prev[j] && x !== c.prev[j]).length;
  const mb = cfg().meubles.filter(m => m.rayon === r);
  const lastT = m => { const lo = lastObs(r); const t = lo && (lo.temps || []).find(x => x.m === m.id); return t ? t.v : null; };
  return hdr(esc(R(r).nom), `Tournée · rayon ${T.i + 1} sur ${ord.length}`, 1) +
    `<div class="steps">${ord.map((_, j) => `<i class="${j <= T.i ? 'on' : ''}"></i>`).join('')}</div>` +
    `<div class="small muted" style="margin-bottom:8px">${c.prev.some(Boolean) ? 'Chaque critère reprend l\'état du dernier passage. Touche pour changer.' : 'Premier passage : note chaque critère.'}</div>` +
    (cs.length ? cs.map((cr, j) => {
      const os = openSuivi(r, cr, 'obs');
      return `<div class="card" style="margin-bottom:8px"><div style="margin-bottom:6px">${esc(cr)}${c.prev[j] ? `<span class="prev">dernier : ${STL[c.prev[j]]}</span>` : ''}</div><div class="seg">${ST.map(s => `<button class="${c.v[j] === s ? 'on-' + s : ''}" onclick="A.tv(${j},'${s}')">${STL[s]}</button>`).join('')}</div>
      ${c.v[j] && c.v[j] !== 'ok' ? `<div style="display:flex;gap:8px;margin-top:8px"><input type="text" placeholder="Commentaire facultatif (un fait, pas une personne)" value="${esc(c.com[j] || '')}" oninput="T_com(${j},this.value)"><button class="chip ${c.ph[j] ? 'on' : ''}" onclick="A.tph(${j})">${c.ph[j] ? 'Photo ✓' : 'Photo'}</button></div>${os ? `<div class="small warn" style="margin-top:4px">Suivi déjà ouvert le ${fDate(os.date, { day: 'numeric', month: 'short' })} : il sera mis à jour</div>` : ''}` : ''}
      ${c.v[j] === 'ok' && os ? `<label class="small" style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" ${c.close[j] ? 'checked' : ''} onchange="T_close(${j},this.checked)" style="width:20px;height:20px"> Clôturer le suivi ouvert le ${fDate(os.date, { day: 'numeric', month: 'short' })}</label>` : ''}</div>`;
    }).join('') : empty('Aucun critère pour ce rayon. Ajoute-les dans Réglages.')) +
    (mb.length ? `<h2>Températures</h2><div class="list">${mb.map(m => { const os = openSuivi(r, m.nom, 'temp'); const v = c.temp[m.id]; const hot = v !== undefined && v !== '' && +v > m.max; return `<div class="row"><span class="grow">${esc(m.nom)}<div class="small muted">seuil ${m.max} °C${lastT(m) != null ? ` · dernier ${lastT(m)} °C` : ''}</div>${hot ? '<div class="small bad">Hors seuil : un suivi et une alerte seront créés</div>' : ''}${os && v !== undefined && v !== '' && !hot ? `<label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" ${c.tclose[m.id] ? 'checked' : ''} onchange="T_tclose('${m.id}',this.checked)"> Clôturer l'alerte en cours</label>` : ''}</span><input type="number" inputmode="decimal" step="0.1" placeholder="°C" value="${v ?? ''}" style="width:84px" onchange="A.tt('${m.id}',this.value)" aria-label="Température ${esc(m.nom)}"></div>`; }).join('')}</div>` : '') +
    `<div class="mt"><button class="btn" ${miss ? 'disabled style="opacity:.5"' : ''} onclick="A.tnext()">${miss ? `${miss} critère${miss > 1 ? 's' : ''} à noter` : ch ? `Valider (${ch} changement${ch > 1 ? 's' : ''}) et rayon suivant` : 'Valider et rayon suivant'}</button></div>` +
    `<div class="mt"><button class="btn sec" onclick="A.tskip()">Passer ce rayon</button></div>`;
};
window.T_com = (j, v) => { T.cur.com[j] = v; };
window.T_close = (j, v) => { T.cur.close[j] = v; };
window.T_tclose = (id, v) => { T.cur.tclose[id] = v; };
A.tv = (j, s) => { T.cur.v[j] = s; render(); };
A.tt = (id, v) => { T.cur.temp[id] = v.replace(',', '.'); render(); };
A.tph = j => takePhoto(id => { if (id) { T.cur.ph[j] = id; render(); } });
A.tskip = () => { T.i++; T.cur = null; render(); scrollTo(0, 0); };
A.tnext = () => {
  const c = T.cur, r = c.r, cs = cfg().criteres[r] || [], d = today(), ts = Date.now();
  const items = cs.map((cr, j) => ({ c: cr, s: c.v[j], com: c.com[j] || '', ph: c.ph[j] || null }));
  const temps = Object.entries(c.temp).filter(([, v]) => v !== '').map(([m, v]) => ({ m, v: +v }));
  const ob = db.put('obs', { date: d, ts, rayon: r, items, temps });
  let n = 0;
  items.forEach((it, j) => {
    const os = openSuivi(r, it.c, 'obs');
    if (it.s !== 'ok') {
      n++;
      if (os) db.put('suivis', { ...os, s: it.s, last: ts, com: it.com ? (os.com ? os.com + ' · ' : '') + it.com : os.com, ph: it.ph || os.ph, obs: ob.id });
      else db.put('suivis', { type: 'obs', rayon: r, crit: it.c, s: it.s, com: it.com, ph: it.ph, date: d, openTs: ts, last: ts, obs: ob.id });
    } else if (os && c.close[j]) db.put('suivis', { ...os, closeTs: ts });
  });
  cfg().meubles.filter(m => m.rayon === r).forEach(m => {
    const t = temps.find(x => x.m === m.id); if (!t) return;
    const os = openSuivi(r, m.nom, 'temp');
    if (t.v > m.max) { n++; if (os) db.put('suivis', { ...os, val: t.v, last: ts }); else db.put('suivis', { type: 'temp', rayon: r, crit: m.nom, val: t.v, max: m.max, s: 'bad', date: d, openTs: ts, last: ts }); }
    else if (os && c.tclose[m.id]) db.put('suivis', { ...os, closeTs: ts });
  });
  T.res.push({ r, n }); T.i++; T.cur = null;
  if (T.i >= rayons().length) markTask('tournee');
  render(); scrollTo(0, 0);
};
A.endTour = () => { T = null; location.hash = '#/'; };

// ---------- Suivis ----------
V['suivis'] = () => {
  const f = S.suF || 'open';
  const l = db.all('suivis').filter(s => f === 'open' ? !s.closeTs : !!s.closeTs).sort((a, b) => (b.last || b.openTs) - (a.last || a.openTs));
  return hdr('Suivis', 'problèmes relevés et températures', 1) + `<div class="seg two" style="margin-bottom:12px"><button class="${f === 'open' ? 'on-acc' : ''}" onclick="S.suF='open';render()">Ouverts</button><button class="${f === 'clos' ? 'on-acc' : ''}" onclick="S.suF='clos';render()">Clôturés</button></div>` +
    (l.length ? `<div class="list">${l.map(s => `<div class="row"><span class="grow">${tag(s.rayon)}${esc(s.crit)}${s.type === 'temp' ? ` · ${s.val} °C` : ''}<div class="small muted">${esc(R(s.rayon).court)} · ouvert le ${fDate(s.date, { day: 'numeric', month: 'short' })}${s.com ? ' · ' + esc(s.com) : ''}</div>${s.ph ? `<img class="lazy" data-ph="${s.ph}" style="width:64px;height:64px;object-fit:cover;border-radius:6px;margin-top:4px" alt="">` : ''}</span>${s.closeTs ? `<span class="pill p-ok">Clôturé</span>` : `<span class="pill ${s.s === 'bad' ? 'p-bad' : 'p-warn'}">${STL[s.s]}</span><button class="chip" onclick="A.closeSu('${s.id}')">Clôturer</button>`}</div>`).join('')}</div>` : empty(f === 'open' ? 'Aucun problème ouvert.' : 'Aucun suivi clôturé.'));
};
A.closeSu = id => { if (confirm('Clôturer ce suivi ?')) { db.put('suivis', { ...db.get('suivis', id), closeTs: Date.now() }); toast('Suivi clôturé'); } };

// ---------- Ruptures ----------
S.rs = {};
const prods = r => (cfg().produits || []).filter(p => p.rayon === r).sort((a, b) => (b.uses || 0) - (a.uses || 0));
V['ruptures'] = () => {
  const r = lastRayon, s = S.rs, open = db.all('ruptures').filter(x => x.st === 'open' && x.rayon === r).sort((a, b) => a.ts - b.ts);
  const fav = prods(r).slice(0, 10);
  return hdr('Relevé des ruptures', fmtH(nowHM()), 1) + chipsRay(r, 'rsRay') +
    `<h2>Encore ouvertes · ${open.length}</h2>${open.length ? open.map(x => `<div class="card" style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px"><span>${esc(x.p)} <span class="small muted">· ${hm(x.ts)}</span></span><span class="small ${x.type === 'Totale' ? 'bad' : 'warn'}">${x.type === 'Totale' ? 'Totale' : 'Quasi vide'}${x.cause ? '' : ' · cause à compléter'}</span></div><div class="seg two"><button onclick="A.back('${x.id}')">Revenu</button><button onclick="A.still('${x.id}')">${x.chk ? 'Toujours absent ✓' : 'Toujours absent'}</button></div></div>`).join('') : empty('Aucune rupture ouverte dans ce rayon.')}` +
    `<h2>Nouvelle rupture</h2><button class="btn sec" onclick="A.scan()">Scanner l'étiquette</button>
    <div class="small muted" style="margin:10px 0 6px">${fav.length ? 'Ou choisir un produit' : 'Ou saisir le produit (il deviendra un favori)'}</div>
    <div class="chips">${fav.map(p => `<button class="chip ${s.p === p.nom ? 'on' : ''}" onclick="A.rsP('${p.id}')">${esc(p.nom)}</button>`).join('')}<button class="chip" onclick="A.rsFree()">+ Autre produit</button></div>
    ${s.p ? `<div class="alert a-acc mt">Produit : <b style="font-weight:600">${esc(s.p)}</b></div>` : ''}
    <div class="small muted" style="margin:12px 0 6px">Type</div><div class="seg two">${[['Totale', 'Rupture totale'], ['Quasi', 'Quasi vide']].map(([k, l]) => `<button class="${s.type === k ? 'on-acc' : ''}" onclick="S.rs.type='${k}';render()">${l}</button>`).join('')}</div>
    <div class="small muted" style="margin:12px 0 6px">Cause (facultatif, à compléter plus tard)</div><div class="chips">${cfg().causes.map((c, i) => `<button class="chip ${s.cause === c ? 'on' : ''}" onclick="A.rsC(${i})">${esc(c)}</button>`).join('')}</div>
    <div class="mt"><button class="btn" onclick="A.saveRupt()">Enregistrer</button></div><div class="mt">${lk('#/ruptures-stats', 'Statistiques des ruptures')}</div>`;
};
A.rsC = i => { const c = cfg().causes[i]; S.rs.cause = S.rs.cause === c ? null : c; render(); };
A.rsRay = id => { setRay(id); S.rs = {}; render(); };
A.rsP = id => { const p = cfg().produits.find(x => x.id === id); S.rs.p = p.nom; S.rs.pid = id; render(); };
A.rsFree = () => sheet(`<h2 style="margin-top:0">Autre produit</h2><input type="text" id="pn" placeholder="Nom du produit"><div class="btns"><button class="btn sec" onclick="A.close()">Annuler</button><button class="btn" onclick="A.rsFreeOk()">Choisir</button></div>`, '#pn');
A.rsFreeOk = (code) => {
  const n = $('#pn').value.trim(); if (!n) { $('#pn').style.borderColor = 'var(--bad)'; return; }
  const c = cfg(); const p = { id: 'p' + db.newId(), nom: n, rayon: lastRayon, uses: 0, code: code || S.scanCode || null };
  setCfg({ produits: [...c.produits, p] }); S.scanCode = null; S.rs.p = n; S.rs.pid = p.id; A.close(); render();
};
A.saveRupt = () => {
  const s = S.rs; if (!s.p) { toast('Choisis ou scanne un produit'); return; }
  const ts = Date.now();
  db.put('ruptures', { date: today(), ts, rayon: lastRayon, p: s.p, pid: s.pid || null, type: s.type || 'Totale', cause: s.cause || null, st: 'open' });
  const c = cfg(); setCfg({ produits: c.produits.map(p => p.id === s.pid ? { ...p, uses: (p.uses || 0) + 1 } : p) });
  const hNow = new Date().getHours(); const rt = routine(today()), dd = day(today());
  const t = rt.find(x => x.go === 'ruptures' && !dd.done[x.id] && Math.abs(+x.h.slice(0, 2) - hNow) <= 2);
  if (t) db.put('days', { ...dd, done: { ...dd.done, [t.id]: ts } });
  S.rs = {}; toast('Rupture enregistrée'); render();
};
A.back = id => { db.put('ruptures', { ...db.get('ruptures', id), st: 'back', backTs: Date.now() }); toast('Retour en rayon noté'); };
A.still = id => { db.put('ruptures', { ...db.get('ruptures', id), chk: Date.now() }); };

// Scan de code-barres (bibliothèque ZXing, fonctionne sur iPhone)
let reader = null, ctrl = null;
A.scan = async () => {
  sheet(`<h2 style="margin-top:0">Scanner l'étiquette</h2><video class="scan" id="vid" playsinline muted></video><div class="small muted mt">Vise le code-barres de l'étiquette du rayon.</div><button class="btn sec mt" onclick="A.close()">Annuler</button>`);
  try {
    if (!window.ZXingBrowser) throw new Error('lib');
    reader = reader || new ZXingBrowser.BrowserMultiFormatReader();
    ctrl = await reader.decodeFromVideoDevice(undefined, $('#vid'), (res) => {
      if (!res) return;
      const code = res.getText(); stopScan();
      const p = (cfg().produits || []).find(x => x.code === code);
      if (p) { S.rs.p = p.nom; S.rs.pid = p.id; if (p.rayon !== lastRayon) setRay(p.rayon); A.close(); render(); toast(p.nom); }
      else { S.scanCode = code; $('#sheetIn').innerHTML = `<h2 style="margin-top:0">Nouveau produit</h2><div class="small muted" style="margin-bottom:8px">Code ${esc(code)} · il sera reconnu les prochaines fois</div><input type="text" id="pn" placeholder="Nom du produit"><div class="btns"><button class="btn sec" onclick="A.close()">Annuler</button><button class="btn" onclick="A.rsFreeOk()">Enregistrer</button></div>`; setTimeout(() => $('#pn') && $('#pn').focus(), 50); }
    });
  } catch (e) { $('#sheetIn').innerHTML = `<h2 style="margin-top:0">Appareil photo indisponible</h2><p class="muted">Autorise l'accès à l'appareil photo pour cette appli dans les réglages de l'iPhone, ou choisis le produit dans la liste.</p><button class="btn sec" onclick="A.close()">Fermer</button>`; }
};
function stopScan() { try { ctrl && ctrl.stop(); } catch (e) {} ctrl = null; }

V['ruptures-stats'] = () => {
  const since = Date.now() - 28 * 864e5, l = db.all('ruptures').filter(x => x.ts > since), n = l.length || 1;
  const by = f => { const m = {}; l.forEach(x => { const k = f(x); m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const bar = (lbl, v, max) => `<div style="display:grid;grid-template-columns:112px 1fr 44px;gap:8px;align-items:center;margin-bottom:6px"><span>${lbl}</span><div class="bar"><i style="width:${Math.round(v / max * 100)}%"></i></div><span class="r">${v}</span></div>`;
  const back = l.filter(x => x.backTs), avg = back.length ? back.reduce((s, x) => s + x.backTs - x.ts, 0) / back.length / 6e4 : null;
  const J = ['Dim.', 'Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.'];
  const days = [1, 2, 3, 4, 5, 6, 0].map(i => [J[i], l.filter(x => new Date(x.ts).getDay() === i).length]), dm = Math.max(1, ...days.map(x => x[1]));
  const am = l.filter(x => new Date(x.ts).getHours() < 14).length;
  if (!l.length) return hdr('Statistiques ruptures', '4 dernières semaines', 1) + empty('Pas encore de rupture enregistrée.');
  const top = by(x => x.p).slice(0, 8), tm = top[0][1];
  const ca = by(x => x.cause || 'Non renseignée'), cm = ca[0][1];
  return hdr('Statistiques ruptures', `4 dernières semaines · ${l.length} ruptures`, 1) +
    `<h2>Produits les plus touchés</h2>${top.map(([p, v]) => bar(esc(p), v, tm)).join('')}
    <h2>Par cause</h2>${ca.map(([c, v]) => bar(esc(c), v, cm)).join('')}
    <h2>Par jour</h2>${days.map(([d, v]) => bar(d, v, dm)).join('')}
    <h2>Par créneau et durée</h2><div class="grid2"><div class="kpi"><div class="l">Avant 14 h</div><div class="v">${Math.round(am / n * 100)} %</div></div><div class="kpi"><div class="l">Après 14 h</div><div class="v">${Math.round((l.length - am) / n * 100)} %</div></div><div class="kpi" style="grid-column:1/-1"><div class="l">Durée moyenne avant retour en rayon</div><div class="v">${avg == null ? '—' : avg >= 60 ? `${Math.floor(avg / 60)} h ${pad(Math.round(avg % 60))}` : Math.round(avg) + ' min'}</div></div></div>`;
};

// ---------- Journal ----------
V['journal'] = p => {
  const d = p || today(), q = (S.q || '').toLowerCase();
  const l = (q ? db.all('notes').filter(n => (n.t + ' ' + (n.k || []).join(' ')).toLowerCase().includes(q)) : db.all('notes').filter(n => n.date === d)).sort((a, b) => b.ts - a.ts);
  return hdr('Journal', q ? `recherche : ${esc(S.q)}` : cap(fDate(d)), 1) +
    `<div style="display:flex;gap:8px;margin-bottom:12px"><input type="text" placeholder="Rechercher dans toutes les notes" value="${esc(S.q || '')}" onchange="S.q=this.value;render()">${q ? '<button class="chip" onclick="S.q=\'\';render()">Effacer</button>' : ''}</div>` +
    (q ? '' : `<div class="seg two" style="margin-bottom:12px"><button onclick="location.hash='#/journal/${addDays(d, -1)}'">‹ Veille</button><button ${d >= today() ? 'disabled style="opacity:.4"' : ''} onclick="location.hash='#/journal/${addDays(d, 1)}'">Lendemain ›</button></div>`) +
    (l.length ? l.map(n => `<div class="note"><div class="small muted">${q ? fDate(n.date, { day: 'numeric', month: 'short' }) + ' · ' : ''}${hm(n.ts)} · ${n.rayon ? esc(R(n.rayon).court) : 'Général'}</div><div style="white-space:pre-wrap">${esc(n.t)}</div>${n.ph ? `<img class="lazy" data-ph="${n.ph}" style="width:96px;height:96px;object-fit:cover;border-radius:8px;margin-top:4px" alt="">` : ''}<div style="display:flex;gap:6px;align-items:center;margin-top:4px;flex-wrap:wrap">${(n.k || []).map(k => `<span class="pill p-acc">${esc(k)}</span>`).join('')}<span style="margin-left:auto" class="small">${n.action ? '<a class="ok" href="#/actions" style="text-decoration:none">Action créée</a>' : `<a href="javascript:void 0" class="acc" onclick="A.toAction('${n.id}')">Créer une action</a>`}</span><button class="del" onclick="A.delNote('${n.id}')" aria-label="Supprimer">Supprimer</button></div></div>`).join('') : empty(q ? 'Aucune note trouvée.' : 'Aucune note ce jour. Utilise le bouton + pour en ajouter.'));
};
A.note = (ph) => sheet(`<h2 style="margin-top:0">Note rapide</h2><textarea id="nt" placeholder="Dicte avec le micro du clavier ou écris"></textarea><div class="chips" style="margin:10px 0" id="nr"><button class="chip" data-r="">Général</button>${rayons().map(r => `<button class="chip ${r.id === lastRayon ? 'on' : ''}" data-r="${r.id}">${esc(r.court)}</button>`).join('')}</div><input type="text" id="nk" placeholder="Mots-clés, séparés par des virgules"><div style="margin-top:10px"><button class="chip" id="nph" onclick="A.notePh()">${ph ? 'Photo ✓' : 'Ajouter une photo'}</button></div><div class="btns"><button class="btn sec" onclick="A.close()">Annuler</button><button class="btn" onclick="A.saveNote()">Enregistrer</button></div>`, '#nt', () => { S.nph = ph || null; document.querySelectorAll('#nr .chip').forEach(c => c.onclick = () => { document.querySelectorAll('#nr .chip').forEach(x => x.classList.remove('on')); c.classList.add('on'); }); });
A.photoNote = () => takePhoto(id => { if (id) A.note(id); });
A.notePh = () => takePhoto(id => { if (id) { S.nph = id; $('#nph').textContent = 'Photo ✓'; } });
A.saveNote = () => {
  const t = $('#nt').value.trim(); if (!t && !S.nph) { $('#nt').style.borderColor = 'var(--bad)'; $('#nt').placeholder = 'Écris ou dicte une note avant d\'enregistrer'; return; }
  const r = document.querySelector('#nr .chip.on'); const ts = Date.now();
  db.put('notes', { date: today(), ts, rayon: r && r.dataset.r ? r.dataset.r : null, t, k: $('#nk').value.split(',').map(x => x.trim()).filter(Boolean), ph: S.nph || null });
  S.nph = null; A.close(); toast('Note enregistrée');
};
A.delNote = id => { if (confirm('Supprimer cette note ? Elle restera 30 jours dans la corbeille.')) db.del('notes', id); };
A.toAction = id => { const n = db.get('notes', id); sheet(`<h2 style="margin-top:0">Créer une action</h2><div class="field"><span>Action</span><input type="text" id="at" value="${esc(n.t.slice(0, 120))}"></div><div class="field"><span>Échéance</span><input type="date" id="ae" value="${addDays(today(), 7)}" style="width:100%;font:16px Barlow;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink)"></div><div class="btns"><button class="btn sec" onclick="A.close()">Annuler</button><button class="btn" onclick="A.saveAction('${id}')">Créer</button></div>`, '#at'); };
A.saveAction = nid => { const n = db.get('notes', nid), t = $('#at').value.trim(); if (!t) return; const a = db.put('actions', { titre: t, rayon: n.rayon, origine: 'Note du ' + fDate(n.date, { day: 'numeric', month: 'short' }), echeance: $('#ae').value, statut: 'afaire', ts: Date.now() }); db.put('notes', { ...n, action: a.id }); A.close(); toast('Action créée'); };

// ---------- Actions (liste simple en V1) ----------
V['actions'] = () => {
  const l = db.all('actions').sort((a, b) => (a.statut === 'fait') - (b.statut === 'fait') || (a.echeance || '').localeCompare(b.echeance || '')), t = today();
  const P = { afaire: ['p-n', 'À faire'], cours: ['p-acc', 'En cours'], fait: ['p-ok', 'Terminée'] };
  return hdr('Actions', `${l.filter(a => a.statut !== 'fait').length} en cours`, 1) + (l.length ? `<div class="list">${l.map(a => { const late = a.statut !== 'fait' && a.echeance && a.echeance < t; return `<div class="row"><span class="grow ${a.statut === 'fait' ? 'done-t' : ''}">${tag(a.rayon)}${esc(a.titre)}<div class="small muted">${esc(a.origine || '')}${a.echeance ? ' · échéance ' + fDate(a.echeance, { day: 'numeric', month: 'short' }) : ''}</div></span><button class="pill ${late ? 'p-bad' : P[a.statut][0]}" style="border:0;cursor:pointer" onclick="A.cycle('${a.id}')">${late ? 'En retard' : P[a.statut][1]}</button></div>`; }).join('')}</div><div class="small muted mt">Touche le statut pour le faire avancer.</div>` : empty('Aucune action. Crée-en depuis une note du journal.'));
};
A.cycle = id => { const a = db.get('actions', id); const n = { afaire: 'cours', cours: 'fait', fait: 'afaire' }[a.statut]; db.put('actions', { ...a, statut: n }); };

// ---------- Bilan de fin de journée ----------
V['bilan'] = p => {
  const d = p || today(), dd = day(d), noc = db.all('ruptures').filter(x => x.date === d && !x.cause), todo = routine(d).filter(x => !dd.done[x.id]);
  return hdr(d === today() ? 'Bilan de la journée' : 'Bilan du ' + fDate(d, { day: 'numeric', month: 'long' }), dd.clos ? 'journée clôturée' : 'ce qui reste à compléter', 1) +
    `<h2>Causes de rupture manquantes · ${noc.length}</h2>${noc.length ? noc.map(x => `<div class="card" style="margin-bottom:8px"><div style="margin-bottom:6px">${tag(x.rayon)}${esc(x.p)} <span class="small muted">· ${hm(x.ts)}</span></div><div class="chips">${cfg().causes.map((c, i) => `<button class="chip" onclick="A.setCause('${x.id}',${i})">${esc(c)}</button>`).join('')}</div></div>`).join('') : '<div class="alert a-ok">Toutes les causes sont renseignées.</div>'}
    <h2>Tâches non faites · ${todo.length}</h2>${todo.length ? `<div class="list">${todo.map(x => `<div class="row"><span class="grow">${esc(x.t)} <span class="small muted">· ${fmtH(x.h)}</span></span><button class="chip" onclick="A.toggleTask('${d}','${x.id}')">Fait</button><button class="chip" onclick="A.report('${d}','${x.id}')">Demain</button></div>`).join('')}</div>` : '<div class="alert a-ok">Routine complète.</div>'}
    <h2>Photos de fermeture</h2><div class="tiles">${rayons().map(r => dd.photos && dd.photos[r.id] ? `<div class="tile" style="padding:6px;min-height:0"><img class="thumb lazy" data-ph="${dd.photos[r.id]}" alt="Fermeture ${esc(r.court)}"><small style="margin-top:4px">${esc(r.court)} · <a href="javascript:void 0" onclick="A.closePh('${d}','${r.id}')">refaire</a></small></div>` : `<button class="tile" style="min-height:72px" onclick="A.closePh('${d}','${r.id}')">${esc(r.court)}<small>prendre la photo</small></button>`).join('')}</div>
    ${dd.clos ? '<div class="alert a-ok mt">Journée clôturée.</div>' : `<button class="btn mt" onclick="A.clore('${d}')">Clôturer la journée</button>`}`;
};
A.setCause = (id, i) => { db.put('ruptures', { ...db.get('ruptures', id), cause: cfg().causes[i] }); };
A.report = (d, id) => { const dd = day(d), t = routine(d).find(x => x.id === id), n = addDays(d, 1), nd = day(n); db.put('days', { ...nd, extra: [...(nd.extra || []), { ...t, id: 'x' + db.newId(), t: t.t + ' (reporté)' }] }); db.put('days', { ...dd, done: { ...dd.done, [id]: 'reporte' } }); toast('Reporté à demain'); };
A.closePh = (d, r) => takePhoto(id => { if (!id) return; const dd = day(d); db.put('days', { ...dd, photos: { ...(dd.photos || {}), [r]: id } }); toast('Photo enregistrée'); });
A.clore = d => { const dd = day(d); const done = { ...dd.done }; routine(d).filter(x => x.go === 'bilan').forEach(x => (done[x.id] = done[x.id] || Date.now())); db.put('days', { ...dd, done, clos: true }); toast('Journée clôturée'); location.hash = '#/'; };

// ---------- Historique ----------
V['histo'] = () => hdr('Historique') + `<div class="list">${lk('#/obs', 'Observations par rayon et par date')}${lk('#/evolution', 'Évolution des observations')}${lk('#/galerie', 'Galerie photos')}${lk('#/suivis', 'Suivis', `<span class="pill p-warn">${db.all('suivis').filter(s => !s.closeTs).length}</span>`)}${lk('#/ruptures-stats', 'Statistiques des ruptures')}${lk('#/journal', 'Journal et recherche')}${lk('#/actions', 'Actions')}</div>`;
V['obs'] = () => {
  const r = S.obR || '', l = db.all('obs').filter(o => !r || o.rayon === r).sort((a, b) => b.ts - a.ts).slice(0, 80);
  return hdr('Observations', 'les plus récentes d\'abord', 1) + chipsRay(r, 'obR', 1) + (l.length ? `<div class="list">${l.map(o => { const p = o.items.filter(i => i.s === 'bad').length, w = o.items.filter(i => i.s === 'warn').length; return `<a class="row" href="#/obs-detail/${o.id}"><span class="grow">${tag(o.rayon)}${esc(R(o.rayon).court)}<div class="small muted">${fDate(o.date, { weekday: 'short', day: 'numeric', month: 'short' })} · ${hm(o.ts)}</div></span>${p ? `<span class="pill p-bad">${p}</span>` : ''}${w ? `<span class="pill p-warn">${w}</span>` : ''}${!p && !w ? '<span class="pill p-ok">OK</span>' : ''}<span class="chev">›</span></a>`; }).join('')}</div>` : empty('Aucune observation. Lance ta première tournée depuis Saisir.'));
};
A.obR = id => { S.obR = id; render(); };
V['obs-detail'] = id => {
  const o = db.get('obs', id); if (!o) return hdr('Observation', '', 1) + empty('Observation introuvable.');
  const mb = cfg().meubles;
  return hdr(esc(R(o.rayon).nom), cap(fDate(o.date)) + ' · ' + hm(o.ts), 1) + `<div class="list">${o.items.map(i => `<div class="row"><span class="grow">${esc(i.c)}${i.com ? `<div class="small muted">${esc(i.com)}</div>` : ''}${i.ph ? `<img class="lazy" data-ph="${i.ph}" style="width:72px;height:72px;object-fit:cover;border-radius:6px;margin-top:4px" alt="">` : ''}</span><span class="pill p-${i.s === 'ok' ? 'ok' : i.s}">${STL[i.s]}</span></div>`).join('')}</div>` +
    ((o.temps || []).length ? `<h2>Températures</h2><div class="list">${o.temps.map(t => { const m = mb.find(x => x.id === t.m); return `<div class="row"><span class="grow">${esc(m ? m.nom : 'Meuble')}</span><span class="${m && t.v > m.max ? 'bad' : ''}">${String(t.v).replace('.', ',')} °C</span></div>`; }).join('')}</div>` : '') + `<div class="small muted mt">Saisi sur ${esc(o.dev || '')}</div>`;
};
V['evolution'] = () => {
  const weeks = [...Array(8)].map((_, i) => { const e = new Date(); e.setHours(23, 59); e.setDate(e.getDate() - 7 * (7 - i)); const s = new Date(e); s.setDate(s.getDate() - 6); s.setHours(0, 0); return [s.getTime(), e.getTime()]; });
  const serie = r => weeks.map(([s, e]) => { const it = db.all('obs').filter(o => o.rayon === r && o.ts >= s && o.ts <= e).flatMap(o => o.items); return it.length ? Math.round(it.filter(i => i.s === 'ok').length / it.length * 100) : null; });
  const chart = v => { const pts = v.map((y, i) => y == null ? null : `${10 + i * 42},${70 - y * 0.6}`).filter(Boolean); return `<svg viewBox="0 0 320 84" width="100%" role="img" aria-label="Part de critères OK sur 8 semaines"><line x1="10" y1="10" x2="310" y2="10" stroke="var(--line)" stroke-dasharray="3 3"/><line x1="10" y1="70" x2="310" y2="70" stroke="var(--line)"/><text x="310" y="8" text-anchor="end" font-size="10" fill="var(--faint)">100 %</text>${pts.length > 1 ? `<polyline fill="none" stroke="var(--blue)" stroke-width="2" points="${pts.join(' ')}"/>` : ''}${pts.map(p => `<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="3" fill="var(--blue)"/>`).join('')}<text x="10" y="82" font-size="10" fill="var(--faint)">il y a 7 sem.</text><text x="310" y="82" text-anchor="end" font-size="10" fill="var(--faint)">cette semaine</text></svg>`; };
  return hdr('Évolution', 'part des critères OK, par semaine', 1) + rayons().map(r => { const v = serie(r.id), last = [...v].reverse().find(x => x != null); return `<div class="card" style="margin-bottom:8px"><div style="display:flex;justify-content:space-between"><span>${tag(r.id)}${esc(r.nom)}</span><b style="font-weight:600" class="${last == null ? 'muted' : last >= 85 ? 'ok' : last >= 70 ? 'warn' : 'bad'}">${last == null ? '—' : last + ' %'}</b></div>${v.some(x => x != null) ? chart(v) : '<div class="small muted">Pas encore de données.</div>'}</div>`; }).join('');
};
V['galerie'] = () => {
  const r = S.gaR || '', l = [];
  db.all('obs').forEach(o => o.items.forEach(i => i.ph && l.push({ ph: i.ph, r: o.rayon, ts: o.ts, t: i.c })));
  db.all('notes').forEach(n => n.ph && l.push({ ph: n.ph, r: n.rayon, ts: n.ts, t: n.t }));
  db.all('days').forEach(d => Object.entries(d.photos || {}).forEach(([rr, ph]) => l.push({ ph, r: rr, ts: new Date(d.id + 'T20:00').getTime(), t: 'Fermeture' })));
  const f = l.filter(x => !r || x.r === r).sort((a, b) => b.ts - a.ts).slice(0, 60);
  return hdr('Galerie photos', `${f.length} photo${f.length > 1 ? 's' : ''}`, 1) + chipsRay(r, 'gaR', 1) + (f.length ? `<div class="gal">${f.map(x => `<div><img class="thumb lazy" data-ph="${x.ph}" alt="${esc(x.t)}" onclick="A.zoom('${x.ph}')"><div class="small muted" style="line-height:1.2;margin-top:2px">${fDate(iso(new Date(x.ts)), { day: 'numeric', month: 'short' })} · ${esc((x.t || '').slice(0, 24))}</div></div>`).join('')}</div>` : empty('Aucune photo.'));
};
A.gaR = id => { S.gaR = id; render(); };
A.zoom = async id => { const d = await db.getPhoto(id); if (d) sheet(`<img src="${d}" style="width:100%;border-radius:10px" alt=""><button class="btn sec mt" onclick="A.close()">Fermer</button>`); };

// ---------- Plan ----------
const planL = () => { let l = db.all('plan'); if (!l.length) { PLAN.forEach(p => db.put('plan', { ...p })); l = db.all('plan'); } return l.sort((a, b) => a.du.localeCompare(b.du)); };
V['plan'] = () => {
  const l = planL(), t = today(), done = l.filter(p => p.fait).length, pc = l.length ? Math.round(done / l.length * 100) : 0;
  return hdr('Mon plan', `novembre à juin · ${pc} % réalisé`) + `<div class="bar" style="margin-bottom:12px"><i style="width:${pc}%"></i></div><div class="list">${l.map(p => { const cur = p.du <= t && p.au >= t && !p.fait, late = !p.fait && p.au < t; return `<div class="row" ${cur ? 'style="background:var(--blue-l)"' : ''}><button class="check ${p.fait ? 'done' : ''}" style="${p.fait ? '' : 'background:none;'}cursor:pointer;${cur ? 'border-color:var(--blue)' : ''}" onclick="A.planT('${p.id}')" aria-label="Cocher">${p.fait ? '✓' : ''}</button><span class="grow ${p.fait ? 'done-t' : ''}" onclick="A.planE('${p.id}')" style="cursor:pointer">${esc(p.t)}<div class="small ${late ? 'bad' : 'muted'}">${fDate(p.du, { day: 'numeric', month: 'short' })} → ${fDate(p.au, { day: 'numeric', month: 'short' })}${late ? ' · en retard' : ''}</div></span></div>`; }).join('')}</div><button class="btn sec mt" onclick="A.planE()">Ajouter une étape</button><div class="small muted mt">Touche une étape pour la modifier ou la décaler.</div>`;
};
A.planT = id => { const p = db.get('plan', id); db.put('plan', { ...p, fait: !p.fait }); };
A.planE = id => { const p = id ? db.get('plan', id) : { t: '', du: today(), au: addDays(today(), 7) }; const di = 'style="width:100%;font:16px Barlow;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink)"'; sheet(`<h2 style="margin-top:0">${id ? 'Modifier l\'étape' : 'Nouvelle étape'}</h2><div class="field"><span>Étape</span><input type="text" id="pt" value="${esc(p.t)}"></div><div class="grid2"><div class="field"><span>Du</span><input type="date" id="pd" value="${p.du}" ${di}></div><div class="field"><span>Au</span><input type="date" id="pa" value="${p.au}" ${di}></div></div><div class="btns"><button class="btn sec" onclick="A.close()">Annuler</button><button class="btn" onclick="A.planS('${id || ''}')">Enregistrer</button></div>${id ? `<button class="del mt" onclick="A.planD('${id}')">Supprimer l'étape</button>` : ''}`, '#pt'); };
A.planS = id => { const t = $('#pt').value.trim(); if (!t) return; db.put('plan', { ...(id ? { id } : {}), t, du: $('#pd').value, au: $('#pa').value }); A.close(); };
A.planD = id => { if (confirm('Supprimer cette étape ?')) { db.del('plan', id); A.close(); } };

// ---------- Plus et réglages ----------
V['plus'] = () => hdr('Plus') + `<div class="list">${lk('#/journal', 'Journal de bord')}${lk('#/actions', 'Actions')}${lk('#/suivis', 'Suivis')}${lk('#/raccourcis', 'Raccourcis iPhone et Siri')}${lk('#/reglages', 'Réglages')}</div><div class="small muted mt">Version 1 · ${db.MODE === 'local' ? 'mode essai sur cet appareil' : 'synchronisée'} · appareil ${esc(db.DEV)}</div>`;
V['raccourcis'] = () => { const base = location.href.split('#')[0]; return hdr('Raccourcis iPhone', 'saisir sans passer par les menus', 1) + `<div class="card">Pour chaque raccourci : ouvre l'app <b style="font-weight:600">Raccourcis</b>, touche +, ajoute l'action « Ouvrir les URL » et colle l'adresse ci-dessous. Donne-lui le nom indiqué : tu pourras le lancer par Siri ou l'ajouter à l'écran d'accueil.</div><div class="list mt">${[['Rupture', '#/ruptures'], ['Note frais', '#/note'], ['Tournée', '#/tournee'], ['Bilan', '#/bilan']].map(([n, h]) => `<div class="row" style="display:block"><div>« Dis Siri, ${n.toLowerCase()} »</div><div class="small muted" style="word-break:break-all">${esc(base + h)}</div><button class="chip" style="margin-top:6px" onclick="A.copy('${esc(base + h)}')">Copier l'adresse</button></div>`).join('')}</div>`; };
A.copy = t => { navigator.clipboard && navigator.clipboard.writeText(t).then(() => toast('Adresse copiée'), () => toast(t)); };
V['note'] = () => { setTimeout(() => A.note(), 50); location.replace('#/'); return ''; };

V['reglages'] = () => hdr('Réglages', '', 1) + `<h2>Référentiel</h2><div class="list">${lk('#/r-rayons', 'Rayons et ordre de tournée', `<span class="muted">${rayons().length}</span>`)}${lk('#/r-criteres', 'Critères d\'observation par rayon')}${lk('#/r-meubles', 'Meubles froids et seuils', `<span class="muted">${cfg().meubles.length}</span>`)}${lk('#/r-produits', 'Produits et favoris', `<span class="muted">${cfg().produits.length}</span>`)}${lk('#/r-causes', 'Causes de rupture', `<span class="muted">${cfg().causes.length}</span>`)}</div>
  <h2>Fonctionnement</h2><div class="list">${lk('#/r-routine', 'Routine par jour de la semaine')}<div class="row"><span class="grow">Alerte ruptures répétées<div class="small muted">même produit, sur 7 jours</div></span><input type="number" min="2" max="10" value="${cfg().seuilRuptures}" style="width:70px" onchange="A.setSeuil(this.value)" aria-label="Seuil"></div></div>
  <h2>Sécurité et données</h2><div class="list">${lk('#/r-securite', 'Code d\'accès et verrouillage')}${lk('#/r-donnees', 'Sauvegarde, restauration, effacement')}</div>`;
A.setSeuil = v => setCfg({ seuilRuptures: Math.max(2, +v || 3) });

// Rayons
V['r-rayons'] = () => hdr('Rayons', 'l\'ordre est celui de ta tournée', 1) + `<div class="list">${rayons().map((r, i, a) => `<div class="row"><span class="tag" style="background:${r.couleur};width:14px;height:14px"></span><span class="grow">${esc(r.nom)}<div class="small muted">abrégé : ${esc(r.court)}</div></span><button class="chip" ${i ? '' : 'disabled style="opacity:.3"'} onclick="A.rMove(${i},-1)" aria-label="Monter">↑</button><button class="chip" ${i < a.length - 1 ? '' : 'disabled style="opacity:.3"'} onclick="A.rMove(${i},1)" aria-label="Descendre">↓</button><button class="chip" onclick="A.rEdit('${r.id}')">Modifier</button></div>`).join('')}</div><button class="btn sec mt" onclick="A.rEdit()">Ajouter un rayon</button>`;
A.rMove = (i, d) => { const o = [...cfg().ordre]; [o[i], o[i + d]] = [o[i + d], o[i]]; setCfg({ ordre: o }); };
A.rEdit = id => { const r = id ? R(id) : { nom: '', court: '', couleur: '#5B6670' }; sheet(`<h2 style="margin-top:0">${id ? 'Modifier le rayon' : 'Nouveau rayon'}</h2><div class="field"><span>Nom</span><input type="text" id="rn" value="${esc(r.nom)}"></div><div class="field"><span>Nom abrégé</span><input type="text" id="rc" value="${esc(r.court)}"></div><div class="field"><span>Couleur</span><input type="color" id="rk" value="${r.couleur}" style="width:64px;height:40px;border:0;background:none"></div><div class="btns"><button class="btn sec" onclick="A.close()">Annuler</button><button class="btn" onclick="A.rSave('${id || ''}')">Enregistrer</button></div>${id ? `<button class="del mt" onclick="A.rDel('${id}')">Retirer ce rayon</button>` : ''}`, '#rn'); };
A.rSave = id => { const n = $('#rn').value.trim(); if (!n) return; const c = cfg(); const o = { nom: n, court: $('#rc').value.trim() || n, couleur: $('#rk').value }; if (id) setCfg({ rayons: c.rayons.map(r => r.id === id ? { ...r, ...o } : r) }); else { const nid = 'r' + db.newId(); setCfg({ rayons: [...c.rayons, { id: nid, ...o }], ordre: [...c.ordre, nid], criteres: { ...c.criteres, [nid]: [] } }); } A.close(); };
A.rDel = id => { if (!confirm('Retirer ce rayon de la tournée ? L\'historique est conservé.')) return; setCfg({ ordre: cfg().ordre.filter(x => x !== id) }); A.close(); };

// Critères
V['r-criteres'] = () => { const r = S.crR || rayons()[0].id, l = cfg().criteres[r] || []; return hdr('Critères d\'observation', 'par rayon', 1) + chipsRay(r, 'crR') + `<div class="list">${l.map((c, i) => `<div class="row"><span class="grow">${esc(c)}</span><button class="chip" ${i ? '' : 'disabled style="opacity:.3"'} onclick="A.cMove(${i},-1)" aria-label="Monter">↑</button><button class="chip" onclick="A.cEdit(${i})">Renommer</button><button class="del" onclick="A.cDel(${i})">Retirer</button></div>`).join('') || '<div class="empty">Aucun critère.</div>'}</div><button class="btn sec mt" onclick="A.cEdit()">Ajouter un critère</button><div class="small muted mt">Renommer un critère démarre un nouveau suivi pour ce critère.</div>`; };
A.crR = id => { S.crR = id; render(); };
const setCrit = l => { const c = cfg(), r = S.crR || rayons()[0].id; setCfg({ criteres: { ...c.criteres, [r]: l } }); };
const crit = () => [...(cfg().criteres[S.crR || rayons()[0].id] || [])];
A.cMove = (i, d) => { const l = crit(); [l[i], l[i + d]] = [l[i + d], l[i]]; setCrit(l); };
A.cDel = i => { if (confirm('Retirer ce critère ?')) { const l = crit(); l.splice(i, 1); setCrit(l); } };
A.cEdit = i => sheet(`<h2 style="margin-top:0">${i == null ? 'Nouveau critère' : 'Renommer'}</h2><input type="text" id="cn" value="${i == null ? '' : esc(crit()[i])}"><div class="btns"><button class="btn sec" onclick="A.close()">Annuler</button><button class="btn" onclick="A.cSave(${i == null ? 'null' : i})">Enregistrer</button></div>`, '#cn');
A.cSave = i => { const n = $('#cn').value.trim(); if (!n) return; const l = crit(); i == null ? l.push(n) : (l[i] = n); setCrit(l); A.close(); };

// Meubles
V['r-meubles'] = () => hdr('Meubles froids', 'seuils issus du plan de maîtrise sanitaire du magasin', 1) + `<div class="list">${cfg().meubles.map(m => `<div class="row"><span class="grow">${tag(m.rayon)}${esc(m.nom)}<div class="small muted">${esc(R(m.rayon).court)} · seuil ${m.max} °C</div></span><button class="chip" onclick="A.mEdit('${m.id}')">Modifier</button></div>`).join('') || '<div class="empty">Aucun meuble.</div>'}</div><button class="btn sec mt" onclick="A.mEdit()">Ajouter un meuble</button><div class="small muted mt">Tes relevés complètent le registre officiel du magasin, ils ne le remplacent pas.</div>`;
A.mEdit = id => { const m = id ? cfg().meubles.find(x => x.id === id) : { nom: '', rayon: lastRayon, max: 4 }; sheet(`<h2 style="margin-top:0">${id ? 'Modifier le meuble' : 'Nouveau meuble'}</h2><div class="field"><span>Nom</span><input type="text" id="mn" value="${esc(m.nom)}"></div><div class="field"><span>Rayon</span><select id="mr">${rayons().map(r => `<option value="${r.id}" ${r.id === m.rayon ? 'selected' : ''}>${esc(r.nom)}</option>`).join('')}</select></div><div class="field"><span>Température maximale (°C)</span><input type="number" step="0.5" id="mx" value="${m.max}"></div><div class="btns"><button class="btn sec" onclick="A.close()">Annuler</button><button class="btn" onclick="A.mSave('${id || ''}')">Enregistrer</button></div>${id ? `<button class="del mt" onclick="A.mDel('${id}')">Supprimer</button>` : ''}`, '#mn'); };
A.mSave = id => { const n = $('#mn').value.trim(); if (!n) return; const o = { nom: n, rayon: $('#mr').value, max: +$('#mx').value.replace(',', '.') }; const c = cfg(); setCfg({ meubles: id ? c.meubles.map(m => m.id === id ? { ...m, ...o } : m) : [...c.meubles, { id: 'm' + db.newId(), ...o }] }); A.close(); };
A.mDel = id => { if (confirm('Supprimer ce meuble ?')) { setCfg({ meubles: cfg().meubles.filter(m => m.id !== id) }); A.close(); } };

// Produits
V['r-produits'] = () => { const r = S.prR || lastRayon, l = prods(r); return hdr('Produits et favoris', 'classés par fréquence d\'utilisation', 1) + chipsRay(r, 'prR') + `<div class="list">${l.map(p => `<div class="row"><span class="grow">${esc(p.nom)}<div class="small muted">${p.code ? 'code ' + esc(p.code) + ' · ' : ''}utilisé ${p.uses || 0} fois</div></span><button class="chip" onclick="A.pEdit('${p.id}')">Modifier</button></div>`).join('') || '<div class="empty">Les produits s\'ajoutent tout seuls quand tu scannes ou saisis une rupture.</div>'}</div><button class="btn sec mt" onclick="A.pEdit()">Ajouter un produit</button>`; };
A.prR = id => { S.prR = id; render(); };
A.pEdit = id => { const p = id ? cfg().produits.find(x => x.id === id) : { nom: '', rayon: S.prR || lastRayon, code: '' }; sheet(`<h2 style="margin-top:0">${id ? 'Modifier le produit' : 'Nouveau produit'}</h2><div class="field"><span>Nom</span><input type="text" id="qn" value="${esc(p.nom)}"></div><div class="field"><span>Rayon</span><select id="qr">${rayons().map(r => `<option value="${r.id}" ${r.id === p.rayon ? 'selected' : ''}>${esc(r.nom)}</option>`).join('')}</select></div><div class="field"><span>Code-barres (facultatif)</span><input type="text" inputmode="numeric" id="qc" value="${esc(p.code || '')}"></div><div class="btns"><button class="btn sec" onclick="A.close()">Annuler</button><button class="btn" onclick="A.pSave('${id || ''}')">Enregistrer</button></div>${id ? `<button class="del mt" onclick="A.pDel('${id}')">Supprimer</button>` : ''}`, '#qn'); };
A.pSave = id => { const n = $('#qn').value.trim(); if (!n) return; const o = { nom: n, rayon: $('#qr').value, code: $('#qc').value.trim() || null }; const c = cfg(); setCfg({ produits: id ? c.produits.map(p => p.id === id ? { ...p, ...o } : p) : [...c.produits, { id: 'p' + db.newId(), uses: 0, ...o }] }); A.close(); };
A.pDel = id => { if (confirm('Supprimer ce produit ?')) { setCfg({ produits: cfg().produits.filter(p => p.id !== id) }); A.close(); } };

// Causes
V['r-causes'] = () => hdr('Causes de rupture', '', 1) + `<div class="list">${cfg().causes.map((c, i) => `<div class="row"><span class="grow">${esc(c)}</span><button class="chip" onclick="A.kEdit(${i})">Renommer</button><button class="del" onclick="A.kDel(${i})">Retirer</button></div>`).join('')}</div><button class="btn sec mt" onclick="A.kEdit()">Ajouter une cause</button>`;
A.kEdit = i => sheet(`<h2 style="margin-top:0">${i == null ? 'Nouvelle cause' : 'Renommer'}</h2><input type="text" id="kn" value="${i == null ? '' : esc(cfg().causes[i])}"><div class="btns"><button class="btn sec" onclick="A.close()">Annuler</button><button class="btn" onclick="A.kSave(${i == null ? 'null' : i})">Enregistrer</button></div>`, '#kn');
A.kSave = i => { const n = $('#kn').value.trim(); if (!n) return; const l = [...cfg().causes]; i == null ? l.push(n) : (l[i] = n); setCfg({ causes: l }); A.close(); };
A.kDel = i => { if (confirm('Retirer cette cause ?')) { const l = [...cfg().causes]; l.splice(i, 1); setCfg({ causes: l }); } };

// Routine
const JN = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const GOL = { tournee: 'Tournée guidée', ruptures: 'Relevé ruptures', bilan: 'Bilan du soir', journal: 'Journal', libre: 'Tâche simple' };
V['r-routine'] = () => { const w = S.rw ?? new Date().getDay(), l = [...(cfg().routine[w] || [])].sort((a, b) => a.h.localeCompare(b.h)); return hdr('Routine', 'une routine par jour de la semaine', 1) + `<div class="chips" style="margin-bottom:12px">${[1, 2, 3, 4, 5, 6, 0].map(i => `<button class="chip ${i === w ? 'on' : ''}" onclick="S.rw=${i};render()">${JN[i].slice(0, 3)}.</button>`).join('')}</div><h2>${JN[w]}</h2><div class="list">${l.map(t => `<div class="row"><span style="width:56px" class="acc">${fmtH(t.h)}</span><span class="grow">${esc(t.t)}<div class="small muted">${GOL[t.go] || ''}</div></span><button class="chip" onclick="A.rtEdit('${t.id}')">Modifier</button></div>`).join('') || '<div class="empty">Pas de routine ce jour (repos).</div>'}</div><button class="btn sec mt" onclick="A.rtEdit()">Ajouter une tâche</button><button class="btn sec mt" onclick="A.rtCopy()">Copier ce jour sur les autres jours travaillés</button><div class="small muted mt">Pense à créer les mêmes heures dans l'app Rappels de l'iPhone.</div>`; };
A.rtEdit = id => { const w = S.rw ?? new Date().getDay(), t = id ? cfg().routine[w].find(x => x.id === id) : { t: '', h: '08:00', go: 'libre' }; sheet(`<h2 style="margin-top:0">${id ? 'Modifier la tâche' : 'Nouvelle tâche'} · ${JN[w]}</h2><div class="field"><span>Intitulé</span><input type="text" id="ut" value="${esc(t.t)}"></div><div class="field"><span>Heure</span><input type="time" id="uh" value="${t.h}" style="width:100%;font:16px Barlow;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink)"></div><div class="field"><span>Ouvre</span><select id="ug">${Object.entries(GOL).map(([k, l]) => `<option value="${k}" ${k === t.go ? 'selected' : ''}>${l}</option>`).join('')}</select></div><div class="btns"><button class="btn sec" onclick="A.close()">Annuler</button><button class="btn" onclick="A.rtSave('${id || ''}')">Enregistrer</button></div>${id ? `<button class="del mt" onclick="A.rtDel('${id}')">Supprimer</button>` : ''}`, '#ut'); };
A.rtSave = id => { const w = S.rw ?? new Date().getDay(), n = $('#ut').value.trim(); if (!n) return; const c = cfg(), l = [...(c.routine[w] || [])], o = { t: n, h: $('#uh').value, go: $('#ug').value }; const nl = id ? l.map(x => x.id === id ? { ...x, ...o } : x) : [...l, { id: 't' + db.newId(), ...o }]; setCfg({ routine: { ...c.routine, [w]: nl } }); A.close(); };
A.rtDel = id => { const w = S.rw ?? new Date().getDay(), c = cfg(); setCfg({ routine: { ...c.routine, [w]: c.routine[w].filter(x => x.id !== id) } }); A.close(); };
A.rtCopy = () => { const w = S.rw ?? new Date().getDay(), c = cfg(); if (!confirm(`Copier la routine du ${JN[w].toLowerCase()} sur tous les jours qui ont déjà une routine ?`)) return; const r = { ...c.routine }; Object.keys(r).forEach(k => { if (+k !== w && (r[k] || []).length) r[k] = c.routine[w].map(x => ({ ...x })); }); setCfg({ routine: r }); toast('Routine copiée'); };

// Sécurité
V['r-securite'] = () => { const has = !!ls('frais_pin'), dl = ls('frais_lock') || '5'; return hdr('Code d\'accès', 'propre à chaque appareil', 1) + `<div class="list"><button class="row" onclick="A.pinSet()">${has ? 'Changer le code' : 'Créer un code à 4 chiffres'}</button>${has ? '<button class="row bad" onclick="A.pinOff()">Supprimer le code</button>' : ''}</div><h2>Verrouiller après</h2><div class="seg">${[['0', 'Immédiat'], ['5', '5 min'], ['30', '30 min']].map(([v, l]) => `<button class="${dl === v ? 'on-acc' : ''}" onclick="A.lockDelay('${v}')">${l}</button>`).join('')}</div>${db.MODE === 'cloud' ? '<div class="list mt"><button class="row bad" onclick="A.logout()">Se déconnecter de cet appareil</button></div>' : ''}`; };
const ls = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lset = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
const sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('frais:' + s)))].map(b => b.toString(16).padStart(2, '0')).join('');
A.pinSet = () => pinPad('Nouveau code', async p1 => pinPad('Confirme le code', async p2 => { if (p1 !== p2) { toast('Les deux codes sont différents'); hideLock(); return; } lset('frais_pin', await sha(p1)); hideLock(); toast('Code enregistré'); render(); }));
A.pinOff = () => { if (confirm('Supprimer le code d\'accès sur cet appareil ?')) { lset('frais_pin', null); render(); } };
A.lockDelay = v => { lset('frais_lock', v); render(); };
A.logout = async () => { if (confirm('Se déconnecter ? Les données restent en sécurité sur le serveur.')) { await db.logout(); location.reload(); } };

// Données
V['r-donnees'] = () => { const lb = (db.get('meta', 'backup') || {}).ts; return hdr('Données', '', 1) + `<div class="card">Dernière sauvegarde : <b style="font-weight:600">${lb ? new Date(lb).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'jamais'}</b><div class="small muted">Une sauvegarde par mois, gardée hors de l'appli (ordinateur, disque externe).</div></div><button class="btn mt" onclick="A.exp()">Télécharger une sauvegarde complète</button><label class="btn sec mt" style="display:block">Restaurer une sauvegarde<input type="file" accept="application/json,.json" style="display:none" onchange="A.imp(this.files[0])"></label><h2>Effacement</h2><div class="list" style="border-color:var(--bad)"><button class="row bad" onclick="A.wipe()">Effacer toutes les données</button></div><div class="small muted mt">Les éléments supprimés restent 30 jours dans la corbeille, puis sont effacés définitivement.</div>`; };
A.exp = async () => { toast('Préparation…'); const o = await db.exportAll(); const b = new Blob([JSON.stringify(o)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `rayons-frais-sauvegarde-${today()}.json`; document.body.appendChild(a); a.click(); a.remove(); db.put('meta', { id: 'backup', ts: Date.now() }); toast('Sauvegarde téléchargée'); };
A.imp = f => { if (!f) return; const r = new FileReader(); r.onload = async () => { try { const o = JSON.parse(r.result); if (!confirm(`Restaurer la sauvegarde du ${new Date(o.date).toLocaleDateString('fr-FR')} ? Les données actuelles seront complétées.`)) return; await db.importAll(o); toast('Sauvegarde restaurée'); } catch (e) { alert('Restauration impossible : ' + e.message); } }; r.readAsText(f); };
A.wipe = async () => { if (!confirm('Effacer TOUTES les données (observations, ruptures, notes, réglages, photos) ?')) return; if (prompt('Pour confirmer, écris EFFACER') !== 'EFFACER') return; await db.wipeAll(); toast('Données effacées'); location.hash = '#/'; };

// ---------- Photo : compression sur l'appareil ----------
function takePhoto(cb) {
  const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.capture = 'environment';
  i.onchange = () => { const f = i.files[0]; if (!f) return cb(null); const img = new Image(); img.onload = () => { const m = 1200, k = Math.min(1, m / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src); cb(db.putPhoto(c.toDataURL('image/jpeg', 0.7))); }; img.onerror = () => { toast('Photo illisible'); cb(null); }; img.src = URL.createObjectURL(f); };
  i.click();
}
async function lazyPhotos() { for (const el of document.querySelectorAll('img.lazy[data-ph]')) { const id = el.dataset.ph; el.removeAttribute('data-ph'); db.getPhoto(id).then(d => { if (d) el.src = d; }); } }

// ---------- Feuille (bas d'écran) ----------
function sheet(html, focus, after) { $('#sheetIn').innerHTML = html; $('#sheet').classList.add('show'); after && after(); if (focus) setTimeout(() => { const e = $(focus); e && e.focus(); }, 60); lazyPhotos(); }
A.close = () => { stopScan(); $('#sheet').classList.remove('show'); if (dirty) { dirty = false; render(); } };
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') A.close(); });

// ---------- Verrouillage ----------
function pinPad(title, cb) {
  let v = '';
  const draw = err => { $('#lock').innerHTML = `<h1>${title}</h1><div class="pin">${[0, 1, 2, 3].map(i => `<i class="${i < v.length ? 'on' : ''}"></i>`).join('')}</div>${err ? `<div class="bad small">${err}</div>` : '<div class="small muted">&nbsp;</div>'}<div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map(k => k === '' ? '<span></span>' : `<button data-k="${k}">${k}</button>`).join('')}</div>`; $('#lock').querySelectorAll('button').forEach(b => b.onclick = () => { const k = b.dataset.k; if (k === '⌫') v = v.slice(0, -1); else if (v.length < 4) v += k; draw(); if (v.length === 4) { const x = v; v = ''; cb(x, draw); } }); };
  $('#lock').style.display = 'flex'; draw();
}
const hideLock = () => { $('#lock').style.display = 'none'; };
function askPin() { const h = ls('frais_pin'); if (!h) return; pinPad('Code d\'accès', async (x, draw) => { if (await sha(x) === h) hideLock(); else draw('Code incorrect'); }); }
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => { if (document.hidden) hiddenAt = Date.now(); else if (ls('frais_pin') && Date.now() - hiddenAt >= (+(ls('frais_lock') || 5)) * 6e4) askPin(); });

// ---------- Navigation ----------
const ic = { home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>', plus: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>', histo: '<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="8"/>', plan: '<path d="M5 5h14M5 12h14M5 19h9"/><circle cx="19" cy="19" r="1.5"/>', more: '<path d="M4 7h16M4 12h16M4 17h16"/>' };
const tabs = [['', 'Journée', 'home'], ['saisir', 'Saisir', 'plus'], ['histo', 'Historique', 'histo'], ['plan', 'Plan', 'plan'], ['plus', 'Plus', 'more']];
const tabOf = { tournee: 'saisir', ruptures: 'saisir', bilan: 'saisir', suivis: 'histo', obs: 'histo', 'obs-detail': 'histo', evolution: 'histo', galerie: 'histo', 'ruptures-stats': 'histo', journal: 'histo', actions: 'histo', raccourcis: 'plus', reglages: 'plus' };
let dirty = false;
function render() {
  const [route, param] = (location.hash.replace(/^#\/?/, '') || '').split('/');
  const f = V[route] || V[''];
  const tab = route.startsWith('r-') ? 'plus' : tabOf[route] ?? route;
  $('#app').innerHTML = f(param ? decodeURIComponent(param) : undefined);
  $('#nav').innerHTML = tabs.map(([u, l, i]) => `<a href="#/${u}" class="${u === (V[tab] ? tab : '') ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${ic[i]}</svg>${l}</a>`).join('');
  lazyPhotos();
}
window.render = render; window.S = S;
db.onChange(() => {
  const a = document.activeElement;
  if ($('#sheet').classList.contains('show') || (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.type !== 'file')) { dirty = true; return; }
  render();
});
document.addEventListener('focusout', () => setTimeout(() => { if (dirty && !$('#sheet').classList.contains('show')) { const a = document.activeElement; if (!a || !/INPUT|TEXTAREA|SELECT/.test(a.tagName)) { dirty = false; render(); } } }, 200));
addEventListener('hashchange', () => { if (!location.hash.startsWith('#/tournee')) T = T && T.i >= rayons().length ? null : T; render(); scrollTo(0, 0); });
$('#fab').onclick = () => A.note();

// ---------- Démarrage ----------
(async () => {
  $('#app').innerHTML = '<div class="empty" style="padding-top:40vh">Chargement…</div>';
  try {
    const { user } = await db.init();
    if (!user) {
      $('#fab').style.display = 'none';
      $('#app').innerHTML = `<div class="lock" style="position:static;min-height:90vh"><h1>Rayons frais</h1><div class="login"><input type="email" id="le" placeholder="Adresse e-mail" autocomplete="username"><input type="password" id="lp" placeholder="Mot de passe" autocomplete="current-password" style="width:100%;font:16px Barlow;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink)"><button class="btn" id="lb">Se connecter</button><div class="small bad" id="lerr"></div></div></div>`;
      $('#lb').onclick = async () => { $('#lerr').textContent = ''; try { await db.login($('#le').value.trim(), $('#lp').value); location.reload(); } catch (e) { $('#lerr').textContent = 'Connexion refusée : vérifie l\'e-mail et le mot de passe.'; } };
      return;
    }
    await db.subscribe();
    db.purge();
    cfg(); planL();
    askPin();
    render();
  } catch (e) {
    console.error(e);
    $('#app').innerHTML = `<div class="card mt"><b style="font-weight:600">L'appli n'a pas pu démarrer.</b><div class="small muted">${esc(e.message)}</div><div class="small muted mt">Vérifie la connexion internet au premier lancement, puis recharge la page.</div></div>`;
  }
})();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
