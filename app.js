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
  const auto = inFetes(d) && db.all('fetes').length ? [{ id: 'fetes-auto', t: 'Pré-commandes fêtes', h: '14:00', go: 'fetes' }] : [];
  if (db.all('lots').some(l => l.date === addDays(d, -1))) auto.push({ id: 'dem-auto', t: 'Résultat démarque d\'hier', h: '07:00', go: 'demarque' });
  return base.concat(auto, day(d).extra || []).sort((a, b) => a.h.localeCompare(b.h));
}
function markTask(go) {
  const d = today(), dd = day(d);
  const t = routine(d).find(x => x.go === go && !dd.done[x.id]);
  if (t) db.put('days', { ...dd, done: { ...dd.done, [t.id]: Date.now() } });
}
A.toggleTask = (d, id) => { const dd = day(d); const done = { ...dd.done }; done[id] ? delete done[id] : (done[id] = Date.now()); db.put('days', { ...dd, done }); };
const GO = { tournee: '#/tournee', ruptures: '#/ruptures', bilan: '#/bilan', journal: '#/journal', fetes: '#/fetes', presents: '#/presents', demarque: '#/demarque', libre: '' };

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
  db.all('actions').filter(a => !['fait', 'abandon'].includes(a.statut) && a.echeance && a.echeance < t).forEach(a => out.push(['warn', `Échéance dépassée : ${esc(a.titre)}`, '#/action/' + a.id]));
  const lb = (db.get('meta', 'backup') || {}).ts;
  if (!lb || Date.now() - lb > 30 * 864e5) out.push(['acc', lb ? 'Sauvegarde mensuelle à faire' : 'Aucune sauvegarde encore faite', '#/r-donnees']);
  return out.concat(alertsV2(), alertsV34());
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
  <button class="tile" onclick="A.casseAdd()">Casse<small>produit, quantité, motif</small></button><button class="tile" onclick="A.lotAdd()">Lot du soir<small>−30 % / −50 %</small></button>
  <a class="tile" href="#/presents">Absence<small>sans motif</small></a><a class="tile" href="#/presents">Consigne<small>par rayon</small></a>
  <a class="tile" href="#/fetes">Fêtes<small>pré-commandes</small></a><a class="tile" href="#/carnet">Carnet des fêtes<small>à noter le soir</small></a>
  <a class="tile main" href="#/bilan" style="background:var(--card);color:var(--ink);border-color:var(--line)">Bilan de fin de journée<small style="color:var(--muted)">compléter ce qui manque</small></a></div>
  <div class="mt">${lk('#/raccourcis', 'Raccourcis iPhone et Siri')}</div>`;

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
V['plus'] = () => hdr('Plus') + `<div class="list">${lk('#/histo', 'Historique : observations, évolution, photos')}${lk('#/plan', 'Mon plan · novembre à juin')}${lk('#/fetes', 'Fêtes et retraits')}${lk('#/journal', 'Journal de bord')}${lk('#/actions', 'Actions')}${lk('#/suivis', 'Suivis')}${lk('#/raccourcis', 'Raccourcis iPhone et Siri')}${lk('#/reglages', 'Réglages')}</div><div class="small muted mt">Version 4 · ${db.MODE === 'local' ? 'mode essai sur cet appareil' : 'synchronisée'} · appareil ${esc(db.DEV)}</div>`;
V['raccourcis'] = () => { const base = location.href.split('#')[0]; return hdr('Raccourcis iPhone', 'saisir sans passer par les menus', 1) + `<div class="card">Pour chaque raccourci : ouvre l'app <b style="font-weight:600">Raccourcis</b>, touche +, ajoute l'action « Ouvrir les URL » et colle l'adresse ci-dessous. Donne-lui le nom indiqué : tu pourras le lancer par Siri ou l'ajouter à l'écran d'accueil.</div><div class="list mt">${[['Rupture', '#/ruptures'], ['Note frais', '#/note'], ['Tournée', '#/tournee'], ['Bilan', '#/bilan']].map(([n, h]) => `<div class="row" style="display:block"><div>« Dis Siri, ${n.toLowerCase()} »</div><div class="small muted" style="word-break:break-all">${esc(base + h)}</div><button class="chip" style="margin-top:6px" onclick="A.copy('${esc(base + h)}')">Copier l'adresse</button></div>`).join('')}</div>`; };
A.copy = t => { navigator.clipboard && navigator.clipboard.writeText(t).then(() => toast('Adresse copiée'), () => toast(t)); };
V['note'] = () => { setTimeout(() => A.note(), 50); location.replace('#/'); return ''; };

V['reglages'] = () => hdr('Réglages', '', 1) + `<h2>Référentiel</h2><div class="list">${lk('#/r-rayons', 'Rayons et ordre de tournée', `<span class="muted">${rayons().length}</span>`)}${lk('#/r-criteres', 'Critères d\'observation par rayon')}${lk('#/r-meubles', 'Meubles froids et seuils', `<span class="muted">${cfg().meubles.length}</span>`)}${lk('#/r-produits', 'Produits et favoris', `<span class="muted">${cfg().produits.length}</span>`)}${lk('#/r-causes', 'Causes de rupture', `<span class="muted">${cfg().causes.length}</span>`)}${lk('#/r-taches', 'Tâches de polyvalence')}${lk('#/r-objectifs/tot', 'Objectifs du total frais')}${lk('#/r-prod', 'Productivité et coûts horaires')}${lk('#/r-jours', 'Jours particuliers et effets')}${lk('#/r-affluence', 'Affluence et ventes par jour')}${lk('#/personnes', 'Équipes (prénoms) et plannings types', `<span class="muted">${db.all('people').filter(p => p.type !== 'interim').length}</span>`)}</div>
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
const GOL = { tournee: 'Tournée guidée', ruptures: 'Relevé ruptures', bilan: 'Bilan du soir', journal: 'Journal', presents: 'Présents et consignes', fetes: 'Pré-commandes fêtes', demarque: 'Démarque', libre: 'Tâche simple' };
V['r-routine'] = () => { const w = S.rw ?? new Date().getDay(), l = [...(cfg().routine[w] || [])].sort((a, b) => a.h.localeCompare(b.h)); return hdr('Routine', 'une routine par jour de la semaine', 1) + `<div class="chips" style="margin-bottom:12px">${[1, 2, 3, 4, 5, 6, 0].map(i => `<button class="chip ${i === w ? 'on' : ''}" onclick="S.rw=${i};render()">${JN[i].slice(0, 3)}.</button>`).join('')}</div><h2>${JN[w]}</h2><div class="list">${l.map(t => `<div class="row"><span style="width:56px" class="acc">${fmtH(t.h)}</span><span class="grow">${esc(t.t)}<div class="small muted">${GOL[t.go] || ''}</div></span><button class="chip" onclick="A.rtEdit('${t.id}')">Modifier</button></div>`).join('') || '<div class="empty">Pas de routine ce jour (repos).</div>'}</div><button class="btn sec mt" onclick="A.rtEdit()">Ajouter une tâche</button><button class="btn sec mt" onclick="A.rtCopy()">Copier ce jour sur les autres jours travaillés</button><div class="small muted mt">Pense à créer les mêmes heures dans l'app Rappels de l'iPhone.</div>`; };
A.rtEdit = id => { const w = S.rw ?? new Date().getDay(), t = id ? cfg().routine[w].find(x => x.id === id) : { t: '', h: '08:00', go: 'libre' }; sheet(`<h2 style="margin-top:0">${id ? 'Modifier la tâche' : 'Nouvelle tâche'} · ${JN[w]}</h2><div class="field"><span>Intitulé</span><input type="text" id="ut" value="${esc(t.t)}"></div><div class="field"><span>Heure</span><input type="time" id="uh" value="${t.h}" style="width:100%;font:16px Barlow;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink)"></div><div class="field"><span>Ouvre</span><select id="ug">${Object.entries(GOL).map(([k, l]) => `<option value="${k}" ${k === t.go ? 'selected' : ''}>${l}</option>`).join('')}</select></div><div class="btns"><button class="btn sec" onclick="A.close()">Annuler</button><button class="btn" onclick="A.rtSave('${id || ''}')">Enregistrer</button></div>${id ? `<button class="del mt" onclick="A.rtDel('${id}')">Supprimer</button>` : ''}`, '#ut'); };
A.rtSave = id => { const w = S.rw ?? new Date().getDay(), n = $('#ut').value.trim(); if (!n) return; const c = cfg(), l = [...(c.routine[w] || [])], o = { t: n, h: $('#uh').value, go: $('#ug').value }; const nl = id ? l.map(x => x.id === id ? { ...x, ...o } : x) : [...l, { id: 't' + db.newId(), ...o }]; setCfg({ routine: { ...c.routine, [w]: nl } }); A.close(); };
A.rtDel = id => { const w = S.rw ?? new Date().getDay(), c = cfg(); setCfg({ routine: { ...c.routine, [w]: c.routine[w].filter(x => x.id !== id) } }); A.close(); };
A.rtCopy = () => { const w = S.rw ?? new Date().getDay(), c = cfg(); if (!confirm(`Copier la routine du ${JN[w].toLowerCase()} sur tous les jours qui ont déjà une routine ?`)) return; const r = { ...c.routine }; Object.keys(r).forEach(k => { if (+k !== w && (r[k] || []).length) r[k] = c.routine[w].map(x => ({ ...x })); }); setCfg({ routine: r }); toast('Routine copiée'); };

// Sécurité
V['r-securite'] = () => { const has = !!ls('frais_pin'), dl = ls('frais_lock') || '5'; const bio = !!ls('frais_bio'); return hdr('Code d\'accès', 'propre à chaque appareil', 1) + `<div class="list"><button class="row" onclick="A.pinSet()">${has ? 'Changer le code' : 'Créer un code à 4 chiffres'}</button>${has ? '<button class="row bad" onclick="A.pinOff()">Supprimer le code</button>' : ''}</div><h2>Face ID ou Touch ID</h2><div class="list">${bio ? '<div class="row"><span class="grow">Activé sur cet appareil<div class="small muted">Le code à 4 chiffres reste en secours</div></span><span class="pill p-ok">Actif</span></div><button class="row" onclick="A.bioTest()">Tester le déverrouillage</button><button class="row bad" onclick="A.bioOff()">Désactiver Face ID</button>' : `<button class="row" onclick="A.bioOn()">Activer Face ID${has ? '' : '<div class=\'small muted\'>Un code à 4 chiffres sera d\'abord demandé, pour le secours</div>'}</button>`}</div><h2>Verrouiller après</h2><div class="seg">${[['0', 'Immédiat'], ['5', '5 min'], ['30', '30 min']].map(([v, l]) => `<button class="${dl === v ? 'on-acc' : ''}" onclick="A.lockDelay('${v}')">${l}</button>`).join('')}</div>${db.MODE === 'cloud' ? '<div class="list mt"><button class="row bad" onclick="A.logout()">Se déconnecter de cet appareil</button></div>' : ''}`; };
const ls = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lset = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
const sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('frais:' + s)))].map(b => b.toString(16).padStart(2, '0')).join('');
A.pinSet = (then) => pinPad('Nouveau code', async p1 => pinPad('Confirme le code', async p2 => { if (p1 !== p2) { toast('Les deux codes sont différents'); hideLock(); return; } lset('frais_pin', await sha(p1)); hideLock(); toast('Code enregistré'); render(); if (typeof then === 'function') then(); }));
A.pinOff = () => { if (confirm('Supprimer le code d\'accès sur cet appareil ? Face ID sera aussi désactivé.')) { lset('frais_pin', null); lset('frais_bio', null); render(); } };
A.lockDelay = v => { lset('frais_lock', v); render(); };
A.logout = async () => { if (confirm('Se déconnecter ? Les données restent en sécurité sur le serveur.')) { await db.logout(); location.reload(); } };

// ---------- Face ID / Touch ID (WebAuthn, clé d'accès propre à cet appareil) ----------
const b64 = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
async function bioAvailable() { try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (e) { return false; } }
async function bioCheck() {
  const id = ls('frais_bio'); if (!id) return false;
  try {
    const r = await navigator.credentials.get({ publicKey: { challenge: rnd(32), rpId: location.hostname, allowCredentials: [{ type: 'public-key', id: unb64(id), transports: ['internal'] }], userVerification: 'required', timeout: 60000 } });
    return !!r;
  } catch (e) { return false; }
}
A.bioOn = async () => {
  if (!(await bioAvailable())) { alert('Face ID ou Touch ID n\'est pas disponible dans cette appli sur cet appareil. Le code à 4 chiffres reste utilisable.'); return; }
  if (!ls('frais_pin')) { toast('Crée d\'abord un code de secours'); return A.pinSet(() => A.bioOn()); }
  try {
    const c = await navigator.credentials.create({ publicKey: { challenge: rnd(32), rp: { name: 'Rayons frais', id: location.hostname }, user: { id: rnd(16), name: 'frais-' + db.DEV, displayName: 'Rayons frais' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' }, attestation: 'none', timeout: 60000 } });
    lset('frais_bio', b64(c.rawId)); toast('Face ID activé'); render();
  } catch (e) { alert('Activation annulée ou impossible : ' + (e.name === 'NotAllowedError' ? 'demande refusée ou expirée.' : e.message)); }
};
A.bioOff = () => { if (confirm('Désactiver Face ID sur cet appareil ?')) { lset('frais_bio', null); render(); } };
A.bioTest = async () => { toast((await bioCheck()) ? 'Face ID fonctionne' : 'Échec : le code reste disponible'); };
A.bioUnlock = async () => { if (await bioCheck()) hideLock(); };

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
function pinPad(title, cb, extra) {
  let v = '';
  const draw = err => { $('#lock').innerHTML = `<h1>${title}</h1><div class="pin">${[0, 1, 2, 3].map(i => `<i class="${i < v.length ? 'on' : ''}"></i>`).join('')}</div>${err ? `<div class="bad small">${err}</div>` : '<div class="small muted">&nbsp;</div>'}<div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map(k => k === '' ? '<span></span>' : `<button data-k="${k}">${k}</button>`).join('')}</div>${extra || ''}`; $('#lock').querySelectorAll('button').forEach(b => b.onclick = () => { const k = b.dataset.k; if (k === '⌫') v = v.slice(0, -1); else if (v.length < 4) v += k; draw(); if (v.length === 4) { const x = v; v = ''; cb(x, draw); } }); };
  $('#lock').style.display = 'flex'; draw();
}
const hideLock = () => { $('#lock').style.display = 'none'; };
function askPin() { const h = ls('frais_pin'); if (!h) return; const bio = !!ls('frais_bio'); pinPad(bio ? 'Déverrouiller' : 'Code d\'accès', async (x, draw) => { if (await sha(x) === h) hideLock(); else draw('Code incorrect'); }, bio ? '<button class="btn" style="max-width:260px;margin-top:6px" onclick="A.bioUnlock()">Utiliser Face ID</button><div class="small muted">ou tape ton code</div>' : ''); if (bio) setTimeout(() => A.bioUnlock(), 250); }
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => { if (document.hidden) hiddenAt = Date.now(); else if (ls('frais_pin') && Date.now() - hiddenAt >= (+(ls('frais_lock') || 5)) * 6e4) askPin(); });

// =====================================================================
// V2 — Équipes (planning, présents, absences, intérimaires, consignes) et Fêtes
// Règles RGPD : prénoms uniquement, jamais de motif d'absence, aucun jugement.
// =====================================================================
const hMin = h => { if (!h) return 0; const [a, b] = h.split(':').map(Number); return a * 60 + (b || 0); };
const dur = (d, f) => Math.max(0, hMin(f) - hMin(d)) / 60;
const hh = h => (h || '').replace(':00', ' h').replace(':', ' h ');
const monday = s => { const d = new Date(s + 'T12:00'); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return iso(d); };
const people = () => db.all('people');
const P = id => db.get('people', id);
const activeOn = (p, d) => p.type !== 'interim' || ((!p.debut || p.debut <= d) && (!p.fin || p.fin >= d));
// Horaire d'une personne un jour donné : exception du jour, sinon planning type. null = repos.
function slot(p, d) {
  const dd = day(d), ex = (dd.horaires || {})[p.id];
  if (ex !== undefined) return ex;
  const t = (p.planning || {})[new Date(d + 'T12:00').getDay()];
  return t && t.d && t.f ? t : null;
}
const isAbs = (pid, d) => !!(day(d).absences || {})[pid];
function presents(r, d) {
  return people().filter(p => p.rayon === r && activeOn(p, d)).map(p => ({ p, s: slot(p, d), abs: isAbs(p.id, d), rep: (day(d).remplace || {})[p.id] })).filter(x => x.s || x.abs).sort((a, b) => ((a.s && a.s.d) || '99').localeCompare((b.s && b.s.d) || '99'));
}

// ---------- Équipes : accueil du module ----------
V['equipes'] = () => {
  const d = today(), inter = people().filter(p => p.type === 'interim' && activeOn(p, d));
  const abs = people().filter(p => isAbs(p.id, d)).length;
  return hdr('Équipes', cap(fDate(d))) + `<div class="grid2">${rayons().map(r => { const l = presents(r.id, d); const n = l.filter(x => !x.abs).length, a = l.filter(x => x.abs).length; return `<a class="kpi" href="#/presents/${r.id}" style="color:inherit;text-decoration:none"><div class="l">${tag(r.id)}${esc(r.court)}</div><div class="v">${n}</div><div class="s">présent${n > 1 ? 's' : ''}${a ? ` · <span class="bad">${a} absent${a > 1 ? 's' : ''}</span>` : ''}</div></a>`; }).join('')}</div>
  <div class="list mt">${lk('#/presents', 'Présents du jour et consignes', abs ? `<span class="pill p-bad">${abs} absent${abs > 1 ? 's' : ''}</span>` : '')}${lk('#/planning', 'Planning de la semaine')}${lk('#/interim', 'Intérimaires', inter.length ? `<span class="pill p-acc">${inter.length}</span>` : '')}${lk('#/couverture', 'Couverture heure par heure')}${lk('#/poly', 'Polyvalence et formations')}${lk('#/entretiens', 'Entretiens chefs de rayon')}${lk('#/personnes', 'Liste des équipes (prénoms)', `<span class="muted">${people().filter(p => p.type !== 'interim').length}</span>`)}</div>`;
};

// ---------- Présents du jour ----------
V['presents'] = (r0) => {
  const r = r0 || S.prR2 || lastRayon, d = S.prD || today(), l = presents(r, d);
  const cons = ((day(d).consignes || {})[r] || []);
  const fin = people().filter(p => p.type === 'interim' && p.rayon === r && p.fin && p.fin >= d && p.fin <= addDays(d, 3));
  const nP = l.filter(x => !x.abs).length, hrs = l.filter(x => !x.abs).reduce((t, x) => t + dur(x.s.d, x.s.f), 0);
  return hdr('Présents', cap(fDate(d)), 1) + chipsRay(r, 'prRay') +
    `<div class="seg" style="margin-bottom:12px"><button onclick="A.prDay(-1)">‹ Veille</button><button class="${d === today() ? 'on-acc' : ''}" onclick="S.prD=null;render()">Aujourd'hui</button><button onclick="A.prDay(1)">Lendemain ›</button></div>` +
    `<div class="grid2" style="margin-bottom:10px"><div class="kpi"><div class="l">Présents</div><div class="v">${nP}</div></div><div class="kpi"><div class="l">Heures prévues</div><div class="v">${String(Math.round(hrs * 10) / 10).replace('.', ',')} h</div></div></div>` +
    (l.length ? `<div class="list">${l.map(({ p, s, abs, rep }) => `<div class="row"><span class="grow ${abs ? 'done-t' : ''}">${esc(p.prenom)}${p.type === 'interim' ? ' <span class="pill p-acc">Intérim</span>' : ''}${rep && P(rep) ? `<div class="small muted">remplace ${esc(P(rep).prenom)}</div>` : ''}</span>${abs ? '<span class="pill p-bad">Absent</span>' : `<span class="small muted">${hh(s.d)} – ${hh(s.f)}</span>`}<button class="chip" onclick="A.prEdit('${p.id}','${d}')">Modifier</button></div>`).join('')}</div>` : empty('Personne de prévu dans ce rayon ce jour. Ajoute les équipes dans la liste des prénoms.')) +
    fin.map(p => `<div class="alert a-acc mt">Fin de mission de ${esc(p.prenom)} le ${fDate(p.fin, { day: 'numeric', month: 'short' })}</div>`).join('') +
    `<div class="btns"><button class="btn sec" onclick="A.absSheet('${r}','${d}')">Déclarer une absence</button><button class="btn sec" onclick="A.renfort('${r}','${d}')">Ajouter un renfort</button></div>` +
    `<h2>Consignes du jour · ${esc(R(r).court)}</h2>${cons.length ? `<div class="list">${cons.map((c, i) => `<label class="row"><input type="checkbox" ${c.ok ? 'checked' : ''} onchange="A.consT('${r}','${d}',${i})" style="width:22px;height:22px"><span class="grow ${c.ok ? 'done-t' : ''}">${esc(c.t)}</span><button class="del" onclick="event.preventDefault();A.consD('${r}','${d}',${i})" aria-label="Supprimer">×</button></label>`).join('')}</div>` : '<div class="small muted">Aucune consigne pour ce rayon.</div>'}
    <div style="display:flex;gap:8px;margin-top:8px"><input type="text" id="cn2" placeholder="Nouvelle consigne" onkeydown="if(event.key==='Enter')A.consAdd('${r}','${d}')"><button class="chip" onclick="A.consAdd('${r}','${d}')">Ajouter</button></div>
    ${cons.length ? `<button class="btn mt" onclick="A.consShare('${r}','${d}')">Partager les consignes</button>` : ''}`;
};
A.prRay = id => { S.prR2 = id; setRay(id); location.hash = '#/presents/' + id; };
A.prDay = n => { S.prD = addDays(S.prD || today(), n); render(); };
const setDay = (d, patch) => db.put('days', { ...day(d), ...patch });
A.prEdit = (pid, d) => {
  const p = P(pid), s = slot(p, d) || { d: '', f: '' }, ti = 'style="width:100%;font:16px Barlow;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink)"';
  sheet(`<h2 style="margin-top:0">${esc(p.prenom)} · ${fDate(d, { weekday: 'long', day: 'numeric', month: 'short' })}</h2><div class="grid2"><div class="field"><span>Début</span><input type="time" id="hd" value="${s.d || ''}" ${ti}></div><div class="field"><span>Fin</span><input type="time" id="hf" value="${s.f || ''}" ${ti}></div></div>
  <button class="btn" onclick="A.slotSave('${pid}','${d}')">Enregistrer cet horaire</button>
  <div class="btns"><button class="btn sec" onclick="A.slotRepos('${pid}','${d}')">Repos ce jour</button><button class="btn sec" onclick="A.absSet('${pid}','${d}')">${isAbs(pid, d) ? 'Annuler l\'absence' : 'Absent'}</button></div>
  <button class="btn sec mt" onclick="A.slotReset('${pid}','${d}')">Revenir au planning type</button><div class="small muted mt">Aucun motif n'est enregistré pour une absence.</div>`);
};
A.slotSave = (pid, d) => { const a = $('#hd').value, b = $('#hf').value; if (!a || !b || hMin(b) <= hMin(a)) { toast('Horaire incomplet'); return; } const dd = day(d); setDay(d, { horaires: { ...(dd.horaires || {}), [pid]: { d: a, f: b } } }); A.close(); toast('Horaire enregistré'); };
A.slotRepos = (pid, d) => { const dd = day(d); setDay(d, { horaires: { ...(dd.horaires || {}), [pid]: null } }); A.close(); };
A.slotReset = (pid, d) => { const dd = day(d), h = { ...(dd.horaires || {}) }, a = { ...(dd.absences || {}) }; delete h[pid]; delete a[pid]; setDay(d, { horaires: h, absences: a }); A.close(); };
A.absSet = (pid, d) => { const dd = day(d), a = { ...(dd.absences || {}) }; if (a[pid]) { delete a[pid]; setDay(d, { absences: a }); A.close(); return; } a[pid] = true; setDay(d, { absences: a }); A.close(); toast('Absence notée, sans motif'); setTimeout(() => A.replSheet(pid, d), 250); };
A.absSheet = (r, d) => { const l = presents(r, d).filter(x => !x.abs); if (!l.length) { toast('Personne à déclarer absent'); return; } sheet(`<h2 style="margin-top:0">Qui est absent ?</h2><div class="list">${l.map(({ p, s }) => `<button class="row" onclick="A.absSet('${p.id}','${d}')"><span class="grow">${esc(p.prenom)}</span><span class="small muted">${hh(s.d)} – ${hh(s.f)}</span></button>`).join('')}</div><div class="small muted mt">Aucun motif n'est demandé ni enregistré.</div><button class="btn sec mt" onclick="A.close()">Annuler</button>`); };
A.replSheet = (pid, d) => {
  const ab = P(pid), s = slot(ab, d); if (!s) return;
  const cand = people().filter(p => p.id !== pid && activeOn(p, d) && !isAbs(p.id, d) && !slot(p, d));
  sheet(`<h2 style="margin-top:0">Remplacer ${esc(ab.prenom)} ?</h2><div class="small muted" style="margin-bottom:8px">${hh(s.d)} – ${hh(s.f)} · personnes non prévues ce jour</div>${cand.length ? `<div class="list">${cand.map(p => `<button class="row" onclick="A.replSet('${p.id}','${pid}','${d}')"><span class="grow">${esc(p.prenom)} <span class="small muted">· ${esc(R(p.rayon).court)}</span>${p.type === 'interim' ? ' <span class="pill p-acc">Intérim</span>' : ''}</span></button>`).join('')}</div>` : '<div class="card muted">Personne de disponible dans la liste.</div>'}<button class="btn sec mt" onclick="A.close()">Pas de remplacement</button>`);
};
A.replSet = (rid, pid, d) => { const dd = day(d), s = slot(P(pid), d); setDay(d, { horaires: { ...(dd.horaires || {}), [rid]: { d: s.d, f: s.f } }, remplace: { ...(dd.remplace || {}), [rid]: pid } }); A.close(); toast('Remplacement noté'); };
A.renfort = (r, d) => { const cand = people().filter(p => activeOn(p, d) && !slot(p, d) && !isAbs(p.id, d)); const ti = 'style="width:100%;font:16px Barlow;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink)"'; sheet(`<h2 style="margin-top:0">Renfort · ${esc(R(r).court)}</h2>${cand.length ? `<div class="field"><span>Qui</span><select id="rp">${cand.map(p => `<option value="${p.id}">${esc(p.prenom)} · ${esc(R(p.rayon).court)}${p.type === 'interim' ? ' (intérim)' : ''}</option>`).join('')}</select></div><div class="grid2"><div class="field"><span>Début</span><input type="time" id="hd" value="14:00" ${ti}></div><div class="field"><span>Fin</span><input type="time" id="hf" value="19:00" ${ti}></div></div><button class="btn" onclick="A.slotSave($('#rp').value,'${d}')">Ajouter</button>` : '<div class="card muted">Personne de disponible. Ajoute un intérimaire dans Intérimaires.</div>'}<button class="btn sec mt" onclick="A.close()">Annuler</button>`); };
A.consAdd = (r, d) => { const t = $('#cn2').value.trim(); if (!t) return; const dd = day(d), c = { ...(dd.consignes || {}) }; c[r] = [...(c[r] || []), { t, ok: false }]; setDay(d, { consignes: c }); };
A.consT = (r, d, i) => { const dd = day(d), c = { ...(dd.consignes || {}) }; c[r] = c[r].map((x, j) => j === i ? { ...x, ok: !x.ok } : x); setDay(d, { consignes: c }); };
A.consD = (r, d, i) => { const dd = day(d), c = { ...(dd.consignes || {}) }; c[r] = c[r].filter((_, j) => j !== i); setDay(d, { consignes: c }); };
A.consShare = async (r, d) => { const c = ((day(d).consignes || {})[r] || []).filter(x => !x.ok); const txt = `Consignes ${R(r).court} · ${fDate(d, { weekday: 'long', day: 'numeric', month: 'long' })}\n` + c.map(x => '• ' + x.t).join('\n'); try { if (navigator.share) { await navigator.share({ text: txt }); return; } } catch (e) { if (e.name === 'AbortError') return; } location.href = 'sms:&body=' + encodeURIComponent(txt); };

// ---------- Planning de la semaine ----------
V['planning'] = () => {
  const r = S.plR || lastRayon, w0 = S.plW || monday(today()), days = [...Array(7)].map((_, i) => addDays(w0, i));
  const l = people().filter(p => p.rayon === r && days.some(d => activeOn(p, d)));
  const tot = days.reduce((t, d) => t + presents(r, d).filter(x => !x.abs).reduce((u, x) => u + dur(x.s.d, x.s.f), 0), 0);
  const cell = (p, d) => { if (!activeOn(p, d)) return '<span class="pc off"></span>'; if (isAbs(p.id, d)) return `<button class="pc abs" onclick="A.prEdit('${p.id}','${d}')">abs</button>`; const s = slot(p, d); const ex = (day(d).horaires || {})[p.id] !== undefined; return `<button class="pc ${s ? (hMin(s.d) < 720 ? 'am' : 'pm') : ''} ${ex ? 'ex' : ''}" onclick="A.prEdit('${p.id}','${d}')">${s ? `${s.d.slice(0, 2).replace(/^0/, '')}–${s.f.slice(0, 2).replace(/^0/, '')}` : '·'}</button>`; };
  return hdr('Planning · ' + esc(R(r).court), `semaine du ${fDate(w0, { day: 'numeric', month: 'long' })} · ${String(Math.round(tot * 10) / 10).replace('.', ',')} h prévues`, 1) + chipsRay(r, 'plRay') +
    `<div class="seg" style="margin-bottom:10px"><button onclick="S.plW=addDays(S.plW||monday(today()),-7);render()">‹ Préc.</button><button class="${w0 === monday(today()) ? 'on-acc' : ''}" onclick="S.plW=null;render()">Cette semaine</button><button onclick="S.plW=addDays(S.plW||monday(today()),7);render()">Suiv. ›</button></div>` +
    (l.length ? `<div style="overflow-x:auto"><div class="pg"><span></span>${days.map(d => `<span class="h ${d === today() ? 'acc' : ''}">${fDate(d, { weekday: 'short' }).slice(0, 3)}<br>${+d.slice(8)}</span>`).join('')}${l.map(p => `<span class="pn">${esc(p.prenom)}${p.type === 'interim' ? '<span class="acc"> ·i</span>' : ''}</span>${days.map(d => cell(p, d)).join('')}`).join('')}</div></div><div class="small muted mt">Horaires en heures (6–13 = 6 h à 13 h) · bleu matin, vert après-midi · cadre pointillé = modifié ce jour · ·i = intérim. Touche une case pour la modifier.</div>` : empty('Aucune personne dans ce rayon. Ajoute les prénoms dans la liste des équipes.')) +
    `<div class="mt">${lk('#/personnes', 'Modifier les plannings types')}</div>`;
};
A.plRay = id => { S.plR = id; setRay(id); render(); };
window.addDays = addDays; window.monday = monday; window.today = today;

// ---------- Liste des équipes (prénoms) ----------
const JC = [1, 2, 3, 4, 5, 6, 0];
V['personnes'] = () => {
  const r = S.peR || '', l = people().filter(p => p.type !== 'interim' && (!r || p.rayon === r)).sort((a, b) => a.prenom.localeCompare(b.prenom));
  return hdr('Équipes', 'prénoms uniquement · aucun commentaire sur les personnes', 1) + chipsRay(r, 'peR', 1) +
    (l.length ? `<div class="list">${l.map(p => { const h = JC.reduce((t, w) => { const s = (p.planning || {})[w]; return t + (s && s.d ? dur(s.d, s.f) : 0); }, 0); return `<a class="row" href="#/personne/${p.id}"><span class="grow">${tag(p.rayon)}${esc(p.prenom)}<div class="small muted">${esc(R(p.rayon).court)} · planning type ${String(h).replace('.', ',')} h / semaine</div></span><span class="chev">›</span></a>`; }).join('')}</div>` : empty('Aucune personne. Ajoute les prénoms de tes équipes.')) +
    `<a class="btn sec mt" href="#/personne/new">Ajouter une personne</a><div class="mt">${lk('#/interim', 'Intérimaires')}</div>`;
};
A.peR = id => { S.peR = id; render(); };
V['personne'] = id => {
  const isNew = id === 'new' || id === 'newi', p = isNew ? { prenom: '', rayon: lastRayon, type: id === 'newi' ? 'interim' : 'salarie', planning: {} } : P(id);
  if (!p) return hdr('Personne', '', 1) + empty('Personne introuvable.');
  S.pe = S.pe && S.pe.id === (p.id || id) ? S.pe : { id: p.id || id, planning: JSON.parse(JSON.stringify(p.planning || {})) };
  const ti = 'style="font:16px Barlow;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);width:100%"';
  const it = p.type === 'interim';
  return hdr(isNew ? (it ? 'Nouvel intérimaire' : 'Nouvelle personne') : esc(p.prenom), it ? 'mission d\'intérim' : 'équipe', 1) +
    `<div class="field"><span>Prénom</span><input type="text" id="pp" value="${esc(p.prenom)}" autocomplete="off"></div><div class="field"><span>Rayon</span><select id="pr">${rayons().map(r => `<option value="${r.id}" ${r.id === p.rayon ? 'selected' : ''}>${esc(r.nom)}</option>`).join('')}</select></div>` +
    (!it ? `<label class="row" style="padding:8px 0"><input type="checkbox" id="pch" ${p.chef ? 'checked' : ''} style="width:22px;height:22px"><span class="grow">Chef de rayon (pour les entretiens)</span></label>` : '') + (it ? `<div class="field"><span>Agence</span><input type="text" id="pag" value="${esc(p.agence || '')}"></div><div class="grid2"><div class="field"><span>Début de mission</span><input type="date" id="pdb" value="${p.debut || today()}" ${ti}></div><div class="field"><span>Fin de mission</span><input type="date" id="pfn" value="${p.fin || addDays(today(), 14)}" ${ti}></div></div>` : '') +
    `<h2>Planning type</h2><div class="small muted" style="margin-bottom:6px">Horaires habituels. Laisse vide les jours de repos.</div><div class="list">${JC.map(w => { const s = S.pe.planning[w] || {}; return `<div class="row" style="gap:6px"><span style="width:42px">${JN[w].slice(0, 3)}.</span><input type="time" value="${s.d || ''}" ${ti} onchange="A.peT(${w},'d',this.value)" aria-label="Début ${JN[w]}"><input type="time" value="${s.f || ''}" ${ti} onchange="A.peT(${w},'f',this.value)" aria-label="Fin ${JN[w]}"></div>`; }).join('')}</div>` +
    (it && !isNew ? `<h2>Accueil (premier jour)</h2><div class="list">${ACC.map((a, i) => `<label class="row"><input type="checkbox" ${(p.accueil || {})[i] ? 'checked' : ''} onchange="A.accT('${p.id}',${i})" style="width:22px;height:22px"><span class="grow">${a}</span></label>`).join('')}</div>` : '') +
    `<button class="btn mt" onclick="A.peSave('${isNew ? '' : p.id}','${p.type}')">Enregistrer</button>` +
    (isNew ? '' : `<button class="btn sec mt" onclick="A.peErase('${p.id}')" style="color:var(--bad)">Effacer cette personne (RGPD)</button><div class="small muted mt">L'effacement supprime la fiche et toutes les mentions de cette personne, définitivement.</div>`);
};
const ACC = ['Poste et personne référente', 'Hygiène et tenue', 'Sécurité, chambre froide, couteaux', 'Horaires, pauses, badge', 'Visite du rayon et de la réserve'];
A.peT = (w, k, v) => { S.pe.planning[w] = { ...(S.pe.planning[w] || {}), [k]: v }; };
A.accT = (id, i) => { const p = P(id); db.put('people', { ...p, accueil: { ...(p.accueil || {}), [i]: !(p.accueil || {})[i] } }); };
A.peSave = (id, type) => {
  const n = $('#pp').value.trim(); if (!n) { $('#pp').style.borderColor = 'var(--bad)'; return; }
  const pl = {}; Object.entries(S.pe.planning).forEach(([w, s]) => { if (s && s.d && s.f && hMin(s.f) > hMin(s.d)) pl[w] = { d: s.d, f: s.f }; });
  const o = { prenom: n, rayon: $('#pr').value, type, planning: pl, chef: !!($('#pch') && $('#pch').checked) };
  if (type === 'interim') Object.assign(o, { agence: $('#pag').value.trim(), debut: $('#pdb').value, fin: $('#pfn').value });
  db.put('people', id ? { id, ...o } : o); S.pe = null; toast('Enregistré'); history.back();
};
A.peErase = id => { const p = P(id); if (!confirm(`Effacer définitivement ${p.prenom} et toutes ses mentions ?`)) return; eraseP(id); S.pe = null; toast('Personne effacée'); history.back(); };
function eraseP(id) {
  db.all('days').forEach(d => { let ch = false; const o = { ...d }; ['horaires', 'absences', 'remplace'].forEach(k => { if (o[k] && (id in o[k] || Object.values(o[k]).includes(id))) { o[k] = Object.fromEntries(Object.entries(o[k]).filter(([a, b]) => a !== id && b !== id)); ch = true; } }); if (o.retrait) ch = true; if (ch) db.put('days', o); });
  db.all('retraits').forEach(r => { if ((r.creneaux || []).some(c => (c.pers || []).includes(id))) db.put('retraits', { ...r, creneaux: r.creneaux.map(c => ({ ...c, pers: (c.pers || []).filter(x => x !== id) })) }); });
  db.erase('people', id);
}
// Intérimaires : fiche effacée automatiquement 3 mois après la fin de mission (RGPD)
function purgeInterim() { const lim = addDays(today(), -90); people().filter(p => p.type === 'interim' && p.fin && p.fin < lim).forEach(p => eraseP(p.id)); }

// ---------- Intérimaires ----------
V['interim'] = () => {
  const d = today(), l = people().filter(p => p.type === 'interim');
  const cur = l.filter(p => activeOn(p, d)), fut = l.filter(p => p.debut > d), past = l.filter(p => p.fin && p.fin < d);
  const w0 = monday(d), wd = [...Array(7)].map((_, i) => addDays(w0, i));
  const hrs = rayons().map(r => [r, wd.reduce((t, x) => t + l.filter(p => p.rayon === r.id && activeOn(p, x) && !isAbs(p.id, x)).reduce((u, p) => { const s = slot(p, x); return u + (s ? dur(s.d, s.f) : 0); }, 0), 0)]).filter(([, h]) => h > 0);
  const row = p => { const acc = Object.values(p.accueil || {}).filter(Boolean).length; return `<a class="row" href="#/personne/${p.id}"><span class="grow">${tag(p.rayon)}${esc(p.prenom)} <span class="small muted">· ${esc(R(p.rayon).court)}</span><div class="small muted">${esc(p.agence || 'agence ?')} · ${fDate(p.debut, { day: 'numeric', month: 'short' })} → ${fDate(p.fin, { day: 'numeric', month: 'short' })}${activeOn(p, d) && acc < ACC.length ? ` · accueil ${acc}/${ACC.length}` : ''}</div></span><span class="chev">›</span></a>`; };
  return hdr('Intérimaires', `${cur.length} en mission`, 1) +
    `<h2>En mission</h2>${cur.length ? `<div class="list">${cur.map(row).join('')}</div>` : '<div class="small muted">Aucun intérimaire en mission.</div>'}` +
    (fut.length ? `<h2>À venir</h2><div class="list">${fut.map(row).join('')}</div>` : '') +
    `<h2>Heures d'intérim · cette semaine</h2>${hrs.length ? `<div class="grid2">${hrs.map(([r, h]) => `<div class="kpi"><div class="l">${tag(r.id)}${esc(r.court)}</div><div class="v">${String(Math.round(h * 10) / 10).replace('.', ',')} h</div></div>`).join('')}</div>` : '<div class="small muted">Aucune heure d\'intérim prévue.</div>'}` +
    `<a class="btn mt" href="#/personne/newi">Ajouter un intérimaire</a>` +
    (past.length ? `<h2>Missions terminées</h2><div class="list">${past.map(row).join('')}</div><div class="small muted mt">Chaque fiche est effacée automatiquement 3 mois après la fin de mission.</div>` : '');
};

// ---------- Fêtes : pré-commandes ----------
const inFetes = d => { const m = +d.slice(5, 7), j = +d.slice(8); return (m === 11 && j >= 16) || m === 12; };
const fetesL = () => db.all('fetes').sort((a, b) => a.rayon.localeCompare(b.rayon) || a.nom.localeCompare(b.nom));
const lastCum = f => { const e = Object.entries(f.cumuls || {}).sort((a, b) => a[0].localeCompare(b[0])); return e.length ? e[e.length - 1][1] : 0; };
function proj(f, target) {
  const e = Object.entries(f.cumuls || {}).sort((a, b) => a[0].localeCompare(b[0]));
  if (e.length < 7) return null;
  const last = e.slice(-10), x0 = new Date(last[0][0] + 'T12:00').getTime(), xs = last.map(([d]) => (new Date(d + 'T12:00').getTime() - x0) / 864e5), ys = last.map(([, v]) => v);
  const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n, sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (!sxx) return null;
  const k = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx;
  const tx = (new Date(target + 'T12:00').getTime() - x0) / 864e5;
  return Math.max(ys[n - 1], Math.round(my + k * (tx - mx)));
}
function fetStatus(f) { const c = lastCum(f); if (f.capacite && c > f.capacite) return ['bad', 'Capacité dépassée']; if (f.commande && c >= f.commande * 0.8) return ['warn', c >= f.commande ? 'Commande dépassée' : 'Recommander']; return ['ok', 'OK']; }
V['fetes'] = () => {
  const d = today(), y = +d.slice(0, 4) + (+d.slice(5, 7) < 7 ? -1 : 0), t24 = `${y}-12-24`, t31 = `${y}-12-31`;
  const j = Math.round((new Date(t24 + 'T12:00') - new Date(d + 'T12:00')) / 864e5), l = fetesL();
  return hdr('Fêtes · pré-commandes', `${cap(fDate(d))}${j >= 0 ? ` · J-${j} avant le 24` : ''}`, 1) +
    (l.length ? l.map(f => { const c = lastCum(f), [st, lb] = fetStatus(f), ref = f.capacite || f.commande || Math.max(c, 1), p24 = proj(f, t24), p31 = proj(f, t31); return `<div class="card" style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;gap:8px"><b style="font-weight:600">${tag(f.rayon)}${esc(f.nom)}</b><span class="small">${c} réservé${c > 1 ? 's' : ''}${f.commande ? ` / ${f.commande} commandés` : ''}${f.capacite ? ` · capacité ${f.capacite}` : ''}</span></div><div class="bar" style="margin:7px 0"><i style="width:${Math.min(100, Math.round(c / ref * 100))}%;background:var(--${st})"></i></div><div style="display:flex;justify-content:space-between;gap:8px" class="small"><span class="${st}">${lb}</span><span class="muted">${p24 != null ? `Estimation : ~${p24} au 24 · ~${p31} au 31` : 'Estimation : pas encore assez de jours'}</span></div><div style="margin-top:6px"><button class="chip" onclick="A.fetEdit('${f.id}')">Modifier</button></div></div>`; }).join('') : empty('Aucun produit festif. Ajoute les produits suivis (chapons, plateaux, foie gras…).')) +
    (l.length ? `<button class="btn mt" onclick="A.fetMaj()">Mettre à jour les cumuls du jour</button>` : '') +
    `<button class="btn sec mt" onclick="A.fetEdit()">Ajouter un produit festif</button>` +
    `<div class="list mt">${lk('#/retrait', 'Retrait des commandes du 24 et du 31')}${lk('#/carnet', 'Carnet des fêtes', `<span class="muted">${db.all('carnet').filter(c => c.date.slice(0, 4) == y || c.date.slice(0, 4) == y + 1).length}</span>`)}</div>` +
    `<div class="small muted mt">Seuls les cumuls par produit sont saisis, recopiés du registre du magasin. Aucune donnée client.</div>`;
};
A.fetEdit = id => { const f = id ? db.get('fetes', id) : { nom: '', rayon: lastRayon, commande: '', capacite: '' }; sheet(`<h2 style="margin-top:0">${id ? 'Modifier' : 'Nouveau produit festif'}</h2><div class="field"><span>Produit</span><input type="text" id="fn" value="${esc(f.nom)}"></div><div class="field"><span>Rayon</span><select id="fr">${rayons().map(r => `<option value="${r.id}" ${r.id === f.rayon ? 'selected' : ''}>${esc(r.nom)}</option>`).join('')}</select></div><div class="grid2"><div class="field"><span>Quantité commandée au fournisseur</span><input type="number" inputmode="numeric" id="fc" value="${f.commande || ''}"></div><div class="field"><span>Capacité de préparation (facultatif)</span><input type="number" inputmode="numeric" id="fk" value="${f.capacite || ''}"></div></div><div class="btns"><button class="btn sec" onclick="A.close()">Annuler</button><button class="btn" onclick="A.fetSave('${id || ''}')">Enregistrer</button></div>${id ? `<button class="del mt" onclick="A.fetDel('${id}')">Supprimer ce produit</button>` : ''}`, '#fn'); };
A.fetSave = id => { const n = $('#fn').value.trim(); if (!n) return; db.put('fetes', { ...(id ? { id } : {}), nom: n, rayon: $('#fr').value, commande: +$('#fc').value || null, capacite: +$('#fk').value || null }); A.close(); };
A.fetDel = id => { if (confirm('Supprimer ce produit et ses cumuls ?')) { db.del('fetes', id); A.close(); } };
A.fetMaj = () => { const d = today(); sheet(`<h2 style="margin-top:0">Cumuls au ${fDate(d, { day: 'numeric', month: 'long' })}</h2><div class="small muted" style="margin-bottom:8px">Total des réservations depuis le début, recopié du registre du magasin.</div><div class="list">${fetesL().map(f => `<div class="row"><span class="grow">${tag(f.rayon)}${esc(f.nom)}<div class="small muted">dernier : ${lastCum(f)}</div></span><input type="number" inputmode="numeric" data-f="${f.id}" value="${(f.cumuls || {})[d] ?? ''}" placeholder="${lastCum(f)}" style="width:90px"></div>`).join('')}</div><div class="btns"><button class="btn sec" onclick="A.close()">Annuler</button><button class="btn" onclick="A.fetMajOk()">Enregistrer</button></div>`, '[data-f]'); };
A.fetMajOk = () => { const d = today(); document.querySelectorAll('[data-f]').forEach(i => { if (i.value === '') return; const f = db.get('fetes', i.dataset.f); db.put('fetes', { ...f, cumuls: { ...(f.cumuls || {}), [d]: +i.value } }); }); markTask('fetes'); A.close(); toast('Cumuls enregistrés'); };

// ---------- Retrait des commandes ----------
V['retrait'] = () => {
  const y = +today().slice(0, 4) + (+today().slice(5, 7) < 7 ? -1 : 0), d = S.reD || `${y}-12-24`;
  const r = db.get('retraits', d) || { id: d, creneaux: [] }, tot = r.creneaux.reduce((t, c) => t + (+c.n || 0), 0);
  return hdr('Retrait des commandes', cap(fDate(d)), 1) + `<div class="seg two" style="margin-bottom:12px"><button class="${d.endsWith('12-24') ? 'on-acc' : ''}" onclick="S.reD='${y}-12-24';render()">24 décembre</button><button class="${d.endsWith('12-31') ? 'on-acc' : ''}" onclick="S.reD='${y}-12-31';render()">31 décembre</button></div>` +
    (r.creneaux.length ? `<div class="list">${r.creneaux.map((c, i) => { const np = (c.pers || []).length, per = np ? c.n / np : c.n, warn = c.n > 0 && (!np || per > 40); return `<div class="row"><span style="width:96px">${hh(c.d)} – ${hh(c.f)}</span><span class="grow">${(c.pers || []).map(x => P(x) ? esc(P(x).prenom) : '').filter(Boolean).join(', ') || '<span class="bad">personne</span>'}</span><span class="${warn ? 'warn' : ''}">${c.n || 0} cdes</span><button class="chip" onclick="A.creEdit('${d}',${i})">Modifier</button></div>`; }).join('')}</div><div class="small muted mt">${tot} commandes prévues · alerte au-delà de 40 retraits par personne et par créneau</div>` : empty('Aucun créneau. Ajoute les créneaux de retrait.')) +
    r.creneaux.filter(c => c.n > 0 && (!(c.pers || []).length || c.n / c.pers.length > 40)).map(c => `<div class="alert a-warn mt">${hh(c.d)} – ${hh(c.f)} : ${c.n} retraits, prévoir ${Math.ceil(c.n / 40)} personne${Math.ceil(c.n / 40) > 1 ? 's' : ''}</div>`).join('') +
    `<button class="btn sec mt" onclick="A.creEdit('${d}')">Ajouter un créneau</button>`;
};
A.creEdit = (d, i) => {
  const r = db.get('retraits', d) || { id: d, creneaux: [] }, c = i != null ? r.creneaux[i] : { d: '10:00', f: '12:00', n: '', pers: [] };
  const ti = 'style="width:100%;font:16px Barlow;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink)"';
  const cand = people().filter(p => activeOn(p, d));
  sheet(`<h2 style="margin-top:0">Créneau de retrait</h2><div class="grid2"><div class="field"><span>Début</span><input type="time" id="cd" value="${c.d}" ${ti}></div><div class="field"><span>Fin</span><input type="time" id="cf" value="${c.f}" ${ti}></div></div><div class="field"><span>Commandes prévues sur le créneau</span><input type="number" inputmode="numeric" id="cnb" value="${c.n || ''}"></div><div class="small muted" style="margin:6px 0">Personnel affecté</div><div class="chips" id="cpers">${cand.map(p => `<button class="chip ${(c.pers || []).includes(p.id) ? 'on' : ''}" data-p="${p.id}" onclick="this.classList.toggle('on')">${esc(p.prenom)}</button>`).join('') || '<span class="small muted">Ajoute d\'abord les équipes.</span>'}</div><div class="btns"><button class="btn sec" onclick="A.close()">Annuler</button><button class="btn" onclick="A.creSave('${d}',${i ?? 'null'})">Enregistrer</button></div>${i != null ? `<button class="del mt" onclick="A.creDel('${d}',${i})">Supprimer le créneau</button>` : ''}`);
};
A.creSave = (d, i) => { const r = db.get('retraits', d) || { id: d, creneaux: [] }, l = [...r.creneaux], o = { d: $('#cd').value, f: $('#cf').value, n: +$('#cnb').value || 0, pers: [...document.querySelectorAll('#cpers .chip.on')].map(x => x.dataset.p) }; i == null ? l.push(o) : (l[i] = o); l.sort((a, b) => a.d.localeCompare(b.d)); db.put('retraits', { id: d, creneaux: l }); A.close(); };
A.creDel = (d, i) => { const r = db.get('retraits', d); db.put('retraits', { id: d, creneaux: r.creneaux.filter((_, j) => j !== i) }); A.close(); };

// ---------- Carnet des fêtes ----------
V['carnet'] = () => {
  const l = db.all('carnet').sort((a, b) => b.ts - a.ts);
  return hdr('Carnet des fêtes', 'ce qui a manqué, débordé ou mal fonctionné', 1) + (l.length ? `<div class="list">${l.map(c => `<div class="row" style="display:block"><div class="small muted">${fDate(c.date, { day: 'numeric', month: 'short', year: 'numeric' })} · ${c.rayon ? esc(R(c.rayon).court) : 'Général'}</div><div>${esc(c.pb)}</div>${c.cause ? `<div class="small muted">Cause : ${esc(c.cause)}</div>` : ''}${c.idee ? `<div class="small acc">L'an prochain : ${esc(c.idee)}</div>` : ''}${c.ph ? `<img class="lazy" data-ph="${c.ph}" style="width:72px;height:72px;object-fit:cover;border-radius:6px;margin-top:4px" alt="">` : ''}<div><button class="del" onclick="A.carDel('${c.id}')">Supprimer</button></div></div>`).join('')}</div>` : empty('Carnet vide. Note chaque soir ce qui n\'a pas fonctionné.')) + `<button class="btn mt" onclick="A.carAdd()">Ajouter une entrée</button>`;
};
A.carAdd = () => { S.cph = null; sheet(`<h2 style="margin-top:0">Carnet des fêtes</h2><div class="field"><span>Rayon</span><select id="ka"><option value="">Général</option>${rayons().map(r => `<option value="${r.id}" ${r.id === lastRayon ? 'selected' : ''}>${esc(r.nom)}</option>`).join('')}</select></div><div class="field"><span>Problème constaté</span><textarea id="kb"></textarea></div><div class="field"><span>Cause probable</span><input type="text" id="kc"></div><div class="field"><span>Idée pour l'an prochain</span><input type="text" id="kd"></div><button class="chip" id="kph" onclick="takePhoto(id=>{if(id){S.cph=id;document.getElementById('kph').textContent='Photo ✓'}})">Ajouter une photo</button><div class="btns"><button class="btn sec" onclick="A.close()">Annuler</button><button class="btn" onclick="A.carSave()">Enregistrer</button></div>`, '#kb'); };
window.takePhoto = takePhoto;
A.carSave = () => { const pb = $('#kb').value.trim(); if (!pb) { $('#kb').style.borderColor = 'var(--bad)'; return; } db.put('carnet', { date: today(), ts: Date.now(), rayon: $('#ka').value || null, pb, cause: $('#kc').value.trim(), idee: $('#kd').value.trim(), ph: S.cph || null }); A.close(); toast('Ajouté au carnet'); };
A.carDel = id => { if (confirm('Supprimer cette entrée ?')) db.del('carnet', id); };

// ---------- Alertes V2 (ajoutées à l'accueil) ----------
function alertsV2() {
  const out = [], d = today();
  people().filter(p => p.type === 'interim' && p.fin && p.fin >= d && p.fin <= addDays(d, 3)).forEach(p => out.push(['acc', `Fin de mission de ${esc(p.prenom)} le ${fDate(p.fin, { weekday: 'short', day: 'numeric', month: 'short' })}`, '#/interim']));
  people().filter(p => p.type === 'interim' && activeOn(p, d) && Object.values(p.accueil || {}).filter(Boolean).length < ACC.length && p.debut >= addDays(d, -2)).forEach(p => out.push(['acc', `Accueil de ${esc(p.prenom)} à compléter`, '#/personne/' + p.id]));
  const ab = people().filter(p => isAbs(p.id, d) && !Object.values(day(d).remplace || {}).includes(p.id)); if (ab.length) out.push(['warn', `${ab.length} absence${ab.length > 1 ? 's' : ''} non remplacée${ab.length > 1 ? 's' : ''} aujourd'hui`, '#/presents']);
  if (inFetes(d)) fetesL().forEach(f => { const [st, lb] = fetStatus(f); if (st !== 'ok') out.push([st, `${esc(f.nom)} : ${lb.toLowerCase()} (${lastCum(f)}${f.capacite && st === 'bad' ? ' / ' + f.capacite : f.commande ? ' / ' + f.commande : ''})`, '#/fetes']); });
  const m = +d.slice(5, 7), j = +d.slice(8), old = db.all('carnet').filter(c => +c.date.slice(0, 4) < +d.slice(0, 4) - (m < 7 ? 1 : 0) && c.idee);
  if (m === 11 && j <= 15 && old.length) out.push(['acc', `${old.length} idée${old.length > 1 ? 's' : ''} du carnet des fêtes précédentes à relire`, '#/carnet']);
  return out;
}

// =====================================================================
// V3 — Polyvalence, entretiens, tableau de bord, actions et pilotes, plans par rayon, rapports
// V4 — Démarque, jours particuliers, prévisions ventes et personnel, couverture, optimisation, simulateur
// =====================================================================
const nf = (v, d = 1) => v == null || isNaN(v) ? '—' : (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('fr-FR');
const eur = v => v == null || isNaN(v) ? '—' : Math.round(v).toLocaleString('fr-FR') + ' €';
const pct = (v, d = 1) => v == null || isNaN(v) ? '—' : (v > 0 ? '+' : '') + nf(v, d) + ' %';
const tiS = 'style="width:100%;font:16px Barlow;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink)"';
let discret = true;
const money = (v, alt) => discret ? `<span class="eye" onclick="event.stopPropagation();this.outerHTML='${String(v).replace(/'/g, '')}'">${alt}</span>` : v;
A.discretT = () => { discret = !discret; render(); };
const C = () => cfg();
const cget = (k, def) => (C()[k] ?? def);

// ---------- Semaines et agrégats ----------
const wk = d => monday(d);
const semDoc = (w, r) => db.get('semaines', `${w}_${r}`) || { id: `${w}_${r}`, w, r };
const weekDays = w => [...Array(7)].map((_, i) => addDays(w, i));
const ruptW = (w, r) => { const e = addDays(w, 7); return db.all('ruptures').filter(x => x.date >= w && x.date < e && (!r || x.rayon === r)).length; };
const obsOkW = (w, r) => { const e = addDays(w, 7); const it = db.all('obs').filter(o => o.date >= w && o.date < e && (!r || o.rayon === r)).flatMap(o => o.items); return it.length ? it.filter(i => i.s === 'ok').length / it.length * 100 : null; };
function kpiW(w, r) {
  const s = semDoc(w, r), ca = +s.ca || null, n1 = +s.can1 || null, h = +s.heures || null;
  return { ca, n1, ecart: ca && n1 ? (ca / n1 - 1) * 100 : null, marge: s.marge != null && s.marge !== '' ? +s.marge : null, dem: s.demarque != null && s.demarque !== '' ? +s.demarque : null, rupt: ruptW(w, r), h, cah: ca && h ? ca / h : null, obs: obsOkW(w, r) };
}
function kpiTot(w) {
  const rs = rayons().map(r => ({ r, k: kpiW(w, r.id) })), f = rs.filter(x => x.k.ca);
  const ca = f.reduce((t, x) => t + x.k.ca, 0), n1 = f.filter(x => x.k.n1).reduce((t, x) => t + x.k.n1, 0), n1ca = f.filter(x => x.k.n1).reduce((t, x) => t + x.k.ca, 0);
  const wAvg = key => { const g = f.filter(x => x.k[key] != null); const c = g.reduce((t, x) => t + x.k.ca, 0); return c ? g.reduce((t, x) => t + x.k[key] * x.k.ca, 0) / c : null; };
  const h = rs.reduce((t, x) => t + (x.k.h || 0), 0);
  return { ca: ca || null, ecart: n1 ? (n1ca / n1 - 1) * 100 : null, marge: wAvg('marge'), dem: wAvg('dem'), rupt: ruptW(w), h: h || null, cah: ca && h ? ca / h : null, obs: obsOkW(w) };
}
// Couleur : objectif s'il existe (vert atteint, orange à moins de 5 %, rouge au-delà), sinon N-1 pour le CA
const IND = { ecart: { l: 'CA vs N-1', up: true, f: v => pct(v) }, marge: { l: 'Marge', up: true, f: v => nf(v) + ' %' }, dem: { l: 'Démarque', up: false, f: v => nf(v, 2) + ' %' }, rupt: { l: 'Ruptures', up: false, f: v => nf(v, 0) }, cah: { l: 'CA / heure', up: true, f: v => eur(v) }, obs: { l: 'Observations OK', up: true, f: v => nf(v, 0) + ' %' } };
function col(key, v, r) {
  if (v == null) return 'muted';
  const o = ((cget('objectifs', {})[r || 'tot']) || {})[key];
  if (o != null && o !== '') { const ok = IND[key].up ? v >= o : v <= o; if (ok) return 'ok'; const gap = Math.abs(v - o) / Math.max(Math.abs(o), 0.0001); return gap <= 0.05 ? 'warn' : 'bad'; }
  if (key === 'ecart') return v >= 0 ? 'ok' : v > -5 ? 'warn' : 'bad';
  return '';
}

// ---------- Tableau de bord ----------
V['pilotage'] = () => hdr('Pilotage') + `<div class="list">${lk('#/tdb', 'Tableau de bord de la semaine')}${lk('#/tendances', 'Évolution sur 52 semaines')}${lk('#/previsions', 'Prévisions ventes et personnel')}${lk('#/couverture', 'Couverture heure par heure')}${lk('#/simulateur', 'Simulateur d\'heures')}${lk('#/demarque', 'Démarque et lots du soir')}${lk('#/actions', 'Actions et pilotes', (() => { const n = db.all('actions').filter(a => !['fait', 'abandon'].includes(a.statut) && a.echeance && a.echeance < today()).length; return n ? `<span class="pill p-bad">${n} en retard</span>` : ''; })())}${lk('#/plans', 'Plans d\'action par rayon')}${lk('#/rapports', 'Rapports')}</div>`;
V['tdb'] = () => {
  const w = S.tdW || addDays(wk(today()), -7), prev = addDays(w, -7);
  const avg4 = (r, key) => { const v = [1, 2, 3, 4].map(i => kpiW(addDays(w, -7 * i), r)[key]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b) / v.length : null; };
  const t = kpiTot(w);
  const row = (r, k, bold) => `<span style="${bold ? 'font-weight:600' : ''}">${r ? tag(r.id) + esc(r.court) : 'Total frais'}</span><span class="r ${col('ecart', k.ecart, r && r.id)}" ${bold ? 'style="font-weight:600"' : ''}>${k.ca ? money(eur(k.ca), pct(k.ecart)) : '—'}</span><span class="r ${col('marge', k.marge, r && r.id)}">${k.marge == null ? '—' : nf(k.marge) + ' %'}</span><span class="r ${col('dem', k.dem, r && r.id)}">${k.dem == null ? '—' : nf(k.dem, 2) + ' %'}</span><span class="r ${col('rupt', k.rupt, r && r.id)}">${k.rupt}</span><span class="r ${col('cah', k.cah, r && r.id)}">${k.cah ? money(eur(k.cah), nf(k.cah, 0)) : '—'}</span>`;
  const pk = kpiTot(prev);
  return hdr('Tableau de bord', `semaine du ${fDate(w, { day: 'numeric', month: 'long' })}`, 1) +
    `<div class="seg" style="margin-bottom:10px"><button onclick="S.tdW=addDays(S.tdW||addDays(monday(today()),-7),-7);render()">‹ Préc.</button><button onclick="S.tdW=null;render()">Dernière</button><button onclick="S.tdW=addDays(S.tdW||addDays(monday(today()),-7),7);render()">Suiv. ›</button></div>` +
    `<div class="grid2">${['ecart', 'marge', 'dem', 'rupt'].map(k => `<div class="kpi"><div class="l">${IND[k].l}</div><div class="v ${col(k, t[k])}">${t[k] == null ? '—' : IND[k].f(t[k])}</div><div class="s">sem. préc. ${pk[k] == null ? '—' : IND[k].f(pk[k])}</div></div>`).join('')}</div>` +
    `<div class="card mt" style="overflow-x:auto"><div class="tbl" style="grid-template-columns:1.3fr repeat(5,minmax(52px,1fr));min-width:380px"><span class="h">Rayon</span><span class="h r">CA N-1</span><span class="h r">Marge</span><span class="h r">Dém.</span><span class="h r">Rupt.</span><span class="h r">CA/h</span>${rayons().map(r => row(r, kpiW(w, r.id))).join('')}${row(null, t, 1)}</div></div>` +
    `<div class="small muted mt">${discret ? 'Mode discret : touche un chiffre en pointillé pour voir le montant.' : 'Montants affichés.'} <a href="javascript:void 0" onclick="A.discretT()">${discret ? 'Tout afficher' : 'Masquer'}</a> · Couleurs : objectif du rayon s'il existe, sinon l'an dernier.</div>` +
    `<h2>Repères par rayon</h2><div class="list">${rayons().map(r => { const k = kpiW(w, r.id), p = kpiW(prev, r.id); return `<div class="row"><span class="grow">${tag(r.id)}${esc(r.court)}<div class="small muted">Démarque : sem. préc. ${p.dem == null ? '—' : nf(p.dem, 2) + ' %'} · moy. 4 sem. ${avg4(r.id, 'dem') == null ? '—' : nf(avg4(r.id, 'dem'), 2) + ' %'}</div><div class="small muted">Ruptures : sem. préc. ${p.rupt} · moy. 4 sem. ${nf(avg4(r.id, 'rupt'), 1)}</div></span></div>`; }).join('')}</div>` +
    `<div class="btns"><a class="btn sec" href="#/chiffres/${w}">Saisir les chiffres</a><a class="btn" href="#/r-mardi/${w}">Point du mardi</a></div>`;
};
V['chiffres'] = (w0) => {
  const w = w0 || addDays(wk(today()), -7);
  return hdr('Chiffres de la semaine', `du ${fDate(w, { day: 'numeric', month: 'long' })} au ${fDate(addDays(w, 6), { day: 'numeric', month: 'long' })}`, 1) +
    `<div class="seg" style="margin-bottom:10px"><button onclick="location.hash='#/chiffres/${addDays(w, -7)}'">‹ Préc.</button><button onclick="location.hash='#/chiffres/${addDays(wk(today()), -7)}'">Dernière</button><button onclick="location.hash='#/chiffres/${addDays(w, 7)}'">Suiv. ›</button></div>` +
    rayons().map(r => { const s = semDoc(w, r.id); return `<div class="card" style="margin-bottom:8px"><div style="margin-bottom:6px">${tag(r.id)}${esc(r.nom)}</div><div class="grid2">${[['ca', 'CA semaine (€)'], ['can1', 'CA même semaine N-1 (€)'], ['marge', 'Marge %'], ['demarque', 'Démarque %'], ['heures', 'Heures travaillées']].map(([k, l]) => `<label class="small muted">${l}<input type="number" inputmode="decimal" step="any" data-w="${r.id}" data-k="${k}" value="${s[k] ?? ''}"></label>`).join('')}<div class="small muted" style="align-self:end">Ruptures : ${ruptW(w, r.id)} (auto)</div></div></div>`; }).join('') +
    `<button class="btn" onclick="A.chSave('${w}')">Enregistrer</button><div class="small muted mt">Tu peux saisir à l'avance le CA N-1 des semaines à venir : il sert de base aux prévisions.</div>`;
};
A.chSave = w => { const m = {}; document.querySelectorAll('[data-w]').forEach(i => { (m[i.dataset.w] = m[i.dataset.w] || {})[i.dataset.k] = i.value === '' ? null : +i.value.replace(',', '.'); }); Object.entries(m).forEach(([r, o]) => db.put('semaines', { ...semDoc(w, r), ...o })); toast('Chiffres enregistrés'); history.back(); };
V['tendances'] = () => {
  const r = S.teR || '', key = S.teK || 'dem', ws = [...Array(52)].map((_, i) => addDays(wk(today()), -7 * (52 - i)));
  const v = ws.map(w => r ? kpiW(w, r)[key] : kpiTot(w)[key]);
  const pts = v.map((y, i) => y == null ? null : [i, y]).filter(Boolean);
  let svg = '<div class="small muted">Pas encore de données.</div>';
  if (pts.length) { const ys = pts.map(p => p[1]), mn = Math.min(...ys), mx = Math.max(...ys), sp = mx - mn || 1; const P2 = pts.map(([i, y]) => `${10 + i * 5.9},${70 - (y - mn) / sp * 58}`); const o = ((cget('objectifs', {})[r || 'tot']) || {})[key]; const oy = o != null && o !== '' ? 70 - (o - mn) / sp * 58 : null; svg = `<svg viewBox="0 0 320 92" width="100%" role="img" aria-label="${IND[key].l} sur 52 semaines">${oy != null && oy >= 8 && oy <= 72 ? `<line x1="10" y1="${oy}" x2="310" y2="${oy}" stroke="var(--line)" stroke-dasharray="4 4"/>` : ''}${pts.length > 1 ? `<polyline fill="none" stroke="var(--blue)" stroke-width="2" points="${P2.join(' ')}"/>` : ''}${P2.map(p => `<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="2" fill="var(--blue)"/>`).join('')}<text x="10" y="88" font-size="10" fill="var(--faint)">il y a 52 sem.</text><text x="310" y="88" text-anchor="end" font-size="10" fill="var(--faint)">dernière</text><text x="310" y="8" text-anchor="end" font-size="10" fill="var(--faint)">max ${IND[key].f(mx)}</text></svg>`; }
  return hdr('Évolution', '52 semaines', 1) + chipsRay(r, 'teR', 1) + `<div class="chips" style="margin-bottom:12px">${Object.entries(IND).map(([k, o]) => `<button class="chip ${k === key ? 'on' : ''}" onclick="S.teK='${k}';render()">${o.l}</button>`).join('')}</div><div class="card">${svg}</div>`;
};
A.teR = id => { S.teR = id; render(); };

// ---------- Polyvalence et formations ----------
const TACH = { fl: ['Réception', 'Tri', 'Mise en rayon', 'Commande', 'Étiquetage prix'], bo: ['Réception', 'Découpe', 'Vitrine', 'Préparation commandes', 'Commande'], tr: ['Réception', 'Coupe', 'Vitrine', 'Préparation plateaux', 'Commande'], cr: ['Réception', 'Mise en rayon', 'Rotation dates', 'Commande'], bl: ['Cuisson', 'Mise en rayon', 'Commande'] };
const taches = r => (cget('taches', {})[r]) || TACH[r] || ['Réception', 'Mise en rayon', 'Commande'];
const NIV = ['Non formé', 'En formation', 'Autonome', 'Peut former'], NCOL = ['var(--line)', '#B5D4F4', '#378ADD', '#185FA5'];
V['poly'] = () => {
  const r = S.poR || lastRayon, T = taches(r), l = people().filter(p => p.rayon === r && p.type !== 'interim' || (p.rayon === r && p.type === 'interim' && activeOn(p, today()) && p.niv));
  const fragile = T.filter(t => l.filter(p => ((p.niv || {})[t] || 0) >= 2).length <= 1);
  return hdr('Polyvalence', 'niveau sur une tâche, jamais une appréciation', 1) + chipsRay(r, 'poR') +
    (l.length ? `<div style="overflow-x:auto"><div class="tbl" style="grid-template-columns:110px repeat(${l.length},minmax(44px,1fr));text-align:center;min-width:${110 + l.length * 48}px"><span></span>${l.map(p => `<span class="h">${esc(p.prenom)}</span>`).join('')}${T.map(t => `<span style="text-align:left" class="${fragile.includes(t) ? 'bad' : ''}">${esc(t)}</span>${l.map(p => { const v = (p.niv || {})[t] || 0; return `<button style="background:${NCOL[v]};color:${v >= 2 ? '#fff' : 'var(--ink)'};border:0;border-radius:5px;padding:8px 0;font:500 14px Barlow;cursor:pointer" onclick="A.nivC('${p.id}','${esc(t)}')" aria-label="${esc(p.prenom)} ${esc(t)} : ${NIV[v]}">${v}</button>`; }).join('')}`).join('')}</div></div><div class="small muted mt">0 non formé · 1 en formation · 2 autonome · 3 peut former. Touche une case pour changer le niveau.</div>` : empty('Ajoute d\'abord les prénoms de ce rayon.')) +
    fragile.map(t => `<div class="alert a-bad mt">${esc(t)} : ${l.filter(p => ((p.niv || {})[t] || 0) >= 2).length ? 'une seule personne autonome' : 'personne d\'autonome'}</div>`).join('') +
    `<h2>Formations faites</h2>${(() => { const f = db.all('formations').filter(x => x.rayon === r).sort((a, b) => b.date.localeCompare(a.date)); return f.length ? `<div class="list">${f.map(x => `<div class="row"><span class="grow">${esc(x.geste)}<div class="small muted">${x.pers.map(id => P(id) ? esc(P(id).prenom) : '').filter(Boolean).join(', ')}</div></span><span class="small muted">${fDate(x.date, { day: 'numeric', month: 'short' })}</span></div>`).join('')}</div>` : '<div class="small muted">Aucune formation enregistrée.</div>'; })()}` +
    `<button class="btn sec mt" onclick="A.formAdd('${r}')">Enregistrer une formation de 15 min</button><div class="mt">${lk('#/r-taches', 'Modifier la liste des tâches')}</div>`;
};
A.poR = id => { S.poR = id; setRay(id); render(); };
A.nivC = (pid, t) => { const p = P(pid), n = { ...(p.niv || {}) }; n[t] = ((n[t] || 0) + 1) % 4; db.put('people', { ...p, niv: n }); };
A.formAdd = r => { const l = people().filter(p => p.rayon === r && activeOn(p, today())); sheet(`<h2 style="margin-top:0">Formation · ${esc(R(r).court)}</h2><div class="field"><span>Tâche</span><select id="fg">${taches(r).map(t => `<option>${esc(t)}</option>`).join('')}</select></div><div class="field"><span>Geste enseigné</span><input type="text" id="fgt" placeholder="ex. tri des tomates"></div><div class="small muted" style="margin:6px 0">Participants</div><div class="chips" id="fp">${l.map(p => `<button class="chip" data-p="${p.id}" onclick="this.classList.toggle('on')">${esc(p.prenom)}</button>`).join('')}</div><div class="btns"><button class="btn sec" onclick="A.close()">Annuler</button><button class="btn" onclick="A.formSave('${r}')">Enregistrer</button></div>`); };
A.formSave = r => { const t = $('#fg').value, g = $('#fgt').value.trim() || t, ps = [...document.querySelectorAll('#fp .chip.on')].map(x => x.dataset.p); if (!ps.length) { toast('Choisis au moins un participant'); return; } db.put('formations', { date: today(), rayon: r, tache: t, geste: g, pers: ps }); const low = ps.filter(id => ((P(id).niv || {})[t] || 0) < 1); A.close(); if (low.length && confirm(`Passer ${low.map(id => P(id).prenom).join(', ')} au niveau « en formation » sur « ${t} » ?`)) low.forEach(id => { const p = P(id); db.put('people', { ...p, niv: { ...(p.niv || {}), [t]: 1 } }); }); toast('Formation enregistrée'); };
V['r-taches'] = () => { const r = S.poR || lastRayon, l = taches(r); return hdr('Tâches de polyvalence', esc(R(r).nom), 1) + chipsRay(r, 'poR') + `<div class="list">${l.map((t, i) => `<div class="row"><span class="grow">${esc(t)}</span><button class="del" onclick="A.taD(${i})">Retirer</button></div>`).join('')}</div><div style="display:flex;gap:8px;margin-top:10px"><input type="text" id="tan" placeholder="Nouvelle tâche"><button class="chip" onclick="A.taA()">Ajouter</button></div>`; };
const setTaches = l => { const r = S.poR || lastRayon; setCfg({ taches: { ...cget('taches', {}), [r]: l } }); };
A.taA = () => { const t = $('#tan').value.trim(); if (t) setTaches([...taches(S.poR || lastRayon), t]); };
A.taD = i => { const l = [...taches(S.poR || lastRayon)]; l.splice(i, 1); setTaches(l); };

// ---------- Entretiens ----------
const chefs = () => people().filter(p => p.chef && p.type !== 'interim');
V['entretiens'] = () => {
  const l = chefs();
  return hdr('Entretiens', 'chefs de rayon · besoins et engagements, aucune appréciation', 1) +
    (l.length ? `<div class="list">${l.map(p => { const e = db.all('entretiens').filter(x => x.pid === p.id).sort((a, b) => b.date.localeCompare(a.date)); const last = e[0]; const late = last && last.prochain && last.prochain <= today(); return `<a class="row" href="#/entretien/${p.id}"><span class="grow">${tag(p.rayon)}${esc(p.prenom)} <span class="small muted">· ${esc(R(p.rayon).court)}</span><div class="small ${late ? 'warn' : 'muted'}">${last ? `dernier : ${fDate(last.date, { day: 'numeric', month: 'short' })}` : 'aucun entretien'}${last && last.prochain ? ` · prochain : ${fDate(last.prochain, { day: 'numeric', month: 'short' })}` : ''}</div></span><span class="chev">›</span></a>`; }).join('')}</div>` : empty('Indique qui est chef de rayon dans la fiche de chaque personne (Équipes, liste des prénoms).'));
};
V['entretien'] = pid => {
  const p = P(pid); if (!p) return hdr('Entretien', '', 1) + empty('Personne introuvable.');
  const e = db.all('entretiens').filter(x => x.pid === pid).sort((a, b) => b.date.localeCompare(a.date));
  return hdr(esc(p.prenom), `chef de rayon ${esc(R(p.rayon).court)}`, 1) + `<a class="btn" href="#/entretien-new/${pid}">Nouvel entretien</a>` +
    (e.length ? e.map(x => `<div class="card mt"><div style="display:flex;justify-content:space-between"><b style="font-weight:600">${fDate(x.date, { day: 'numeric', month: 'long', year: 'numeric' })}</b><button class="del" onclick="A.entD('${x.id}')">Supprimer</button></div>${ETQ.map(([k, l]) => x[k] ? `<div class="small muted" style="margin-top:6px">${l}</div><div>${esc(x[k])}</div>` : '').join('')}${(x.eng || []).length ? `<div class="small muted" style="margin-top:8px">Mes engagements</div>${x.eng.map((g, i) => `<div class="row" style="padding:6px 0;min-height:0"><span class="grow ${g.fait ? 'done-t' : ''}">${esc(g.t)}</span><button class="pill ${g.fait ? 'p-ok' : g.retour && g.retour < today() ? 'p-bad' : 'p-warn'}" style="border:0;cursor:pointer" onclick="A.engT('${x.id}',${i})">${g.fait ? 'Fait' : 'Retour ' + (g.retour ? fDate(g.retour, { day: 'numeric', month: 'short' }) : '?')}</button></div>`).join('')}` : ''}${x.prochain ? `<div class="small mt">Prochain entretien : <b style="font-weight:600">${fDate(x.prochain, { day: 'numeric', month: 'long' })}</b></div>` : ''}</div>`).join('') : '<div class="small muted mt">Aucun entretien.</div>');
};
const ETQ = [['bilan', 'Bilan (fêtes ou période)'], ['marche', 'Ce qui marche'], ['perte', 'Ce qui fait perdre du temps'], ['changer', 'Ce qu\'il changerait'], ['besoins', 'Besoins']];
V['entretien-new'] = pid => { const p = P(pid); S.eng = S.eng && S.eng.pid === pid ? S.eng : { pid, l: [] }; return hdr('Entretien · ' + esc(p.prenom), cap(fDate(today())), 1) + `<div class="small muted" style="margin-bottom:8px">Note les faits et les besoins exprimés. Aucune appréciation sur la personne.</div>` + ETQ.map(([k, l]) => `<div class="field"><span>${l}</span><textarea id="e_${k}"></textarea></div>`).join('') + `<h2>Mes engagements</h2><div id="engl">${S.eng.l.map((g, i) => `<div class="row"><span class="grow">${esc(g.t)}<div class="small muted">retour le ${fDate(g.retour, { day: 'numeric', month: 'short' })}</div></span><button class="del" onclick="S.eng.l.splice(${i},1);render()">×</button></div>`).join('')}</div><div class="grid2"><input type="text" id="egt" placeholder="Engagement"><input type="date" id="egd" value="${addDays(today(), 14)}" ${tiS}></div><button class="chip mt" onclick="A.engAdd()">Ajouter l'engagement</button><div class="field mt"><span>Prochain entretien</span><input type="date" id="epr" value="${addDays(today(), 28)}" ${tiS}></div><button class="btn" onclick="A.entSave('${pid}')">Enregistrer l'entretien</button>`; };
A.engAdd = () => { const t = $('#egt').value.trim(); if (!t) return; const keep = {}; ETQ.forEach(([k]) => keep[k] = $('#e_' + k).value); S.eng.l.push({ t, retour: $('#egd').value, fait: false }); render(); ETQ.forEach(([k]) => $('#e_' + k).value = keep[k]); };
A.entSave = pid => { const o = { pid, date: today(), eng: S.eng.l, prochain: $('#epr').value }; ETQ.forEach(([k]) => o[k] = $('#e_' + k).value.trim()); db.put('entretiens', o); S.eng = null; toast('Entretien enregistré'); history.back(); };
A.engT = (id, i) => { const e = db.get('entretiens', id); db.put('entretiens', { ...e, eng: e.eng.map((g, j) => j === i ? { ...g, fait: !g.fait } : g) }); };
A.entD = id => { if (confirm('Supprimer cet entretien ?')) db.del('entretiens', id); };

// ---------- Actions complètes et pilotes ----------
const ST_A = { afaire: ['p-n', 'À faire'], cours: ['p-acc', 'En cours'], fait: ['p-ok', 'Terminée'], abandon: ['p-n', 'Abandonnée'] };
const PIND = { dem: 'Démarque %', rupt: 'Ruptures', ecart: 'CA vs N-1', obs: 'Observations OK', cah: 'CA / heure' };
function pilotVal(a, du, au) {
  const r = a.rayon, k = a.ind;
  if (k === 'rupt') { const n = db.all('ruptures').filter(x => x.date >= du && x.date <= au && (!r || x.rayon === r)).length; const days = (new Date(au) - new Date(du)) / 864e5 + 1; return n / days * 7; }
  if (k === 'obs') { const it = db.all('obs').filter(o => o.date >= du && o.date <= au && (!r || o.rayon === r)).flatMap(o => o.items); return it.length ? it.filter(i => i.s === 'ok').length / it.length * 100 : null; }
  const ws = []; for (let w = wk(du); w <= au; w = addDays(w, 7)) ws.push(w);
  const v = ws.map(w => r ? kpiW(w, r)[k] : kpiTot(w)[k]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b) / v.length : null;
}
V['actions'] = () => {
  const f = S.acF || 'ouv', t = today();
  let l = db.all('actions');
  if (f === 'ouv') l = l.filter(a => !['fait', 'abandon'].includes(a.statut)); else if (f === 'ret') l = l.filter(a => !['fait', 'abandon'].includes(a.statut) && a.echeance && a.echeance < t); else if (f === 'pil') l = l.filter(a => a.pilote); else l = l.filter(a => ['fait', 'abandon'].includes(a.statut));
  l.sort((a, b) => (a.echeance || '9').localeCompare(b.echeance || '9'));
  return hdr('Actions et pilotes', '', 1) + `<div class="chips" style="margin-bottom:10px">${[['ouv', 'En cours'], ['ret', 'En retard'], ['pil', 'Pilotes'], ['fin', 'Terminées']].map(([k, n]) => `<button class="chip ${f === k ? 'on' : ''}" onclick="S.acF='${k}';render()">${n}</button>`).join('')}</div>` +
    (l.length ? `<div class="list">${l.map(a => { const late = !['fait', 'abandon'].includes(a.statut) && a.echeance && a.echeance < t; return `<a class="row" href="#/action/${a.id}"><span class="grow">${tag(a.rayon)}${esc(a.titre)}<div class="small muted">${esc(a.resp || '')}${a.origine ? ' · ' + esc(a.origine) : ''}${a.echeance ? ' · ' + fDate(a.echeance, { day: 'numeric', month: 'short' }) : ''}</div></span>${a.pilote ? '<span class="pill p-acc">Pilote</span>' : ''}<span class="pill ${late ? 'p-bad' : ST_A[a.statut || 'afaire'][0]}">${late ? 'En retard' : ST_A[a.statut || 'afaire'][1]}</span></a>`; }).join('')}</div>` : empty('Aucune action ici.')) + `<a class="btn mt" href="#/action/new">Nouvelle action</a>`;
};
V['action'] = id => {
  if (S.aFor !== id) { S.aSt = null; S.aFor = id; }
  const a = id === 'new' ? { titre: '', rayon: lastRayon, statut: 'afaire', echeance: addDays(today(), 14) } : db.get('actions', id);
  if (!a) return hdr('Action', '', 1) + empty('Action introuvable.');
  const avant = a.pilote && a.refDu ? pilotVal(a, a.refDu, a.refAu) : null, apres = a.pilote && a.testDu ? pilotVal(a, a.testDu, a.testAu <= today() ? a.testAu : today()) : null;
  const dlt = avant != null && apres != null ? apres - avant : null, good = dlt == null ? '' : (IND[a.ind] && !IND[a.ind].up) || a.ind === 'rupt' || a.ind === 'dem' ? (dlt < 0 ? 'ok' : 'bad') : (dlt > 0 ? 'ok' : 'bad');
  return hdr(id === 'new' ? 'Nouvelle action' : 'Action', a.origine ? esc(a.origine) : '', 1) +
    `<div class="field"><span>Action</span><input type="text" id="aT" value="${esc(a.titre)}"></div><div class="field"><span>Constat de départ</span><input type="text" id="aC" value="${esc(a.constat || '')}"></div><div class="grid2"><div class="field"><span>Rayon</span><select id="aR"><option value="">Général</option>${rayons().map(r => `<option value="${r.id}" ${r.id === a.rayon ? 'selected' : ''}>${esc(r.court)}</option>`).join('')}</select></div><div class="field"><span>Échéance</span><input type="date" id="aE" value="${a.echeance || ''}" ${tiS}></div></div><div class="field"><span>Responsable (toi ou un rôle)</span><input type="text" id="aP" value="${esc(a.resp || '')}" placeholder="ex. chef de rayon F&L"></div><div class="field"><span>Statut</span><div class="seg" style="grid-template-columns:repeat(4,1fr)">${Object.entries(ST_A).map(([k, [, l]]) => `<button class="stb ${(S.aSt || a.statut || 'afaire') === k ? 'on-acc' : ''}" onclick="S.aSt='${k}';document.querySelectorAll('.stb').forEach(b=>b.classList.remove('on-acc'));this.classList.add('on-acc')">${l}</button>`).join('')}</div></div><div class="field"><span>Résultat constaté</span><input type="text" id="aRe" value="${esc(a.resultat || '')}"></div>` +
    `<label class="row" style="padding:10px 0"><input type="checkbox" id="aPi" ${a.pilote ? 'checked' : ''} onchange="document.getElementById('pil').style.display=this.checked?'block':'none'" style="width:22px;height:22px"><span class="grow">C'est un pilote (test mesuré avant/après)</span></label><div id="pil" style="display:${a.pilote ? 'block' : 'none'}"><div class="field"><span>Indicateur</span><select id="aI">${Object.entries(PIND).map(([k, l]) => `<option value="${k}" ${a.ind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div><div class="grid2"><div class="field"><span>Référence du</span><input type="date" id="a1" value="${a.refDu || addDays(today(), -7)}" ${tiS}></div><div class="field"><span>au</span><input type="date" id="a2" value="${a.refAu || addDays(today(), -1)}" ${tiS}></div><div class="field"><span>Test du</span><input type="date" id="a3" value="${a.testDu || today()}" ${tiS}></div><div class="field"><span>au</span><input type="date" id="a4" value="${a.testAu || addDays(today(), 27)}" ${tiS}></div></div>` +
    (a.pilote ? `<div class="card"><div class="small muted">${PIND[a.ind]}${a.ind === 'rupt' ? ' par semaine' : ''}</div><div style="display:flex;justify-content:space-between;margin-top:4px"><span>Avant : <b style="font-weight:600">${avant == null ? '—' : nf(avant, 2)}</b></span><span>Après : <b style="font-weight:600">${apres == null ? '—' : nf(apres, 2)}</b></span><span class="${good}">${dlt == null ? '' : (dlt > 0 ? '+' : '') + nf(dlt, 2)}</span></div><div class="small muted mt">Calculé automatiquement à partir des données saisies.</div></div><div class="seg mt"><button onclick="A.pilDec('${a.id}','etendre')">Étendre</button><button onclick="A.pilDec('${a.id}','prolonger')">Prolonger</button><button onclick="A.pilDec('${a.id}','abandon')">Abandonner</button></div>${a.decision ? `<div class="small muted mt">Décision : ${esc(a.decision)}</div>` : ''}${a.id ? `<a class="btn sec mt" href="#/r-pilote/${a.id}">Bilan du pilote</a>` : ''}` : '') + `</div>` +
    `<button class="btn mt" onclick="A.actSave('${id}')">Enregistrer</button>${id !== 'new' ? `<button class="del mt" onclick="A.actDel('${id}')">Supprimer l'action</button>` : ''}`;
};
A.actSave = id => { const t = $('#aT').value.trim(); if (!t) { $('#aT').style.borderColor = 'var(--bad)'; return; } const a = id === 'new' ? {} : db.get('actions', id); const o = { ...a, titre: t, constat: $('#aC').value.trim(), rayon: $('#aR').value || null, echeance: $('#aE').value, resp: $('#aP').value.trim(), statut: S.aSt || a.statut || 'afaire', resultat: $('#aRe').value.trim(), pilote: $('#aPi').checked, ts: a.ts || Date.now(), origine: a.origine || 'Créée directement' }; if (o.pilote) Object.assign(o, { ind: $('#aI').value, refDu: $('#a1').value, refAu: $('#a2').value, testDu: $('#a3').value, testAu: $('#a4').value }); S.aSt = null; db.put('actions', o); toast('Action enregistrée'); history.back(); };
A.actDel = id => { if (confirm('Supprimer cette action ?')) { db.del('actions', id); history.back(); } };
A.pilDec = (id, d) => { const a = db.get('actions', id); if (d === 'prolonger') db.put('actions', { ...a, testAu: addDays(a.testAu || today(), 14), decision: 'prolongé de 2 semaines' }); else if (d === 'abandon') db.put('actions', { ...a, statut: 'abandon', decision: 'abandonné' }); else { db.put('actions', { ...a, statut: 'fait', decision: 'étendu' }); rayons().filter(r => r.id !== a.rayon).forEach(r => { if (confirm(`Créer la même action pour ${r.court} ?`)) db.put('actions', { titre: a.titre, rayon: r.id, statut: 'afaire', echeance: addDays(today(), 21), origine: 'Extension du pilote', ts: Date.now() }); }); } toast('Décision enregistrée'); };
// L'ancienne liste simple renvoie vers la nouvelle
A.cycle = id => { location.hash = '#/action/' + id; };

// ---------- Plans d'action par rayon ----------
const planPct = r => { const l = db.all('actions').filter(a => a.rayon === r && a.statut !== 'abandon'); return l.length ? Math.round(l.filter(a => a.statut === 'fait').length / l.length * 100) : null; };
V['plans'] = () => hdr('Plans par rayon', '', 1) + `<div class="list">${rayons().map(r => { const v = planPct(r.id); return `<a class="row" href="#/plan-rayon/${r.id}"><span style="width:118px">${tag(r.id)}${esc(r.court)}</span><div class="bar grow"><i style="width:${v || 0}%"></i></div><span class="small" style="width:40px;text-align:right">${v == null ? '—' : v + ' %'}</span><span class="chev">›</span></a>`; }).join('')}</div>`;
V['plan-rayon'] = r => {
  const o = (cget('objectifs', {})[r]) || {}, dep = (cget('depart', {})[r]) || {}, w = addDays(wk(today()), -7), k = kpiW(w, r);
  const acts = db.all('actions').filter(a => a.rayon === r && a.statut !== 'abandon').sort((a, b) => (a.statut === 'fait') - (b.statut === 'fait') || (a.echeance || '').localeCompare(b.echeance || ''));
  const v = planPct(r), nx = acts.filter(a => a.statut !== 'fait' && a.echeance).map(a => a.echeance).sort()[0];
  const ch = chefs().find(p => p.rayon === r), en = ch && db.all('entretiens').filter(x => x.pid === ch.id).sort((a, b) => b.date.localeCompare(a.date))[0];
  const cur = { dem: k.dem, rupt: k.rupt, ecart: k.ecart, obs: k.obs, cah: k.cah, marge: k.marge };
  return hdr('Plan · ' + esc(R(r).nom), ch ? 'responsable : ' + esc(ch.prenom) : '', 1) + `<h2>Objectifs</h2><div class="grid2">${['dem', 'rupt', 'ecart', 'obs'].map(x => `<div class="kpi"><div class="l">${IND[x].l}</div><div class="v ${col(x, cur[x], r)}">${cur[x] == null ? '—' : IND[x].f(cur[x])}</div><div class="s">${dep[x] != null ? 'départ ' + IND[x].f(dep[x]) + ' · ' : ''}${o[x] != null && o[x] !== '' ? 'cible ' + IND[x].f(+o[x]) : 'pas de cible'}</div></div>`).join('')}</div><a class="small" href="#/r-objectifs/${r}" style="display:inline-block;margin-top:6px">Fixer les objectifs et le point de départ</a>` +
    `<div style="display:flex;justify-content:space-between" class="small muted mt"><span>Avancement · ${acts.filter(a => a.statut === 'fait').length} actions sur ${acts.length}</span><span>${v == null ? '—' : v + ' %'}</span></div><div class="bar" style="margin:4px 0 12px"><i style="width:${v || 0}%"></i></div>` +
    (acts.length ? `<div class="list">${acts.map(a => { const late = a.statut !== 'fait' && a.echeance && a.echeance < today(); return `<a class="row" href="#/action/${a.id}"><span class="grow ${a.statut === 'fait' ? 'done-t' : ''}">${esc(a.titre)}</span><span class="pill ${late ? 'p-bad' : ST_A[a.statut || 'afaire'][0]}">${late ? 'Retard · ' : ''}${a.statut === 'fait' ? 'Terminée' : a.echeance ? fDate(a.echeance, { day: 'numeric', month: 'short' }) : ST_A[a.statut || 'afaire'][1]}</span></a>`; }).join('')}</div>` : empty('Aucune action pour ce rayon.')) +
    `<div class="small muted mt">${nx ? 'Prochaine échéance : ' + fDate(nx, { day: 'numeric', month: 'long' }) : ''}${en && en.prochain ? ' · prochain point avec ' + esc(ch.prenom) + ' : ' + fDate(en.prochain, { day: 'numeric', month: 'long' }) : ''}</div><a class="btn sec mt" href="#/action/new" onclick="setRay('${r}')">Ajouter une action</a>`;
};
window.setRay = setRay;
V['r-objectifs'] = r => { const o = (cget('objectifs', {})[r]) || {}, d = (cget('depart', {})[r]) || {}; return hdr('Objectifs · ' + esc(r === 'tot' ? 'Total frais' : R(r).nom), 'laisse vide si pas d\'objectif', 1) + Object.entries(IND).map(([k, x]) => `<div class="card" style="margin-bottom:8px"><div style="margin-bottom:6px">${x.l} <span class="small muted">(${x.up ? 'plus haut = mieux' : 'plus bas = mieux'})</span></div><div class="grid2"><label class="small muted">Point de départ<input type="number" step="any" data-d="${k}" value="${d[k] ?? ''}"></label><label class="small muted">Cible<input type="number" step="any" data-o="${k}" value="${o[k] ?? ''}"></label></div></div>`).join('') + `<button class="btn" onclick="A.objSave('${r}')">Enregistrer</button>`; };
A.objSave = r => { const o = {}, d = {}; document.querySelectorAll('[data-o]').forEach(i => { if (i.value !== '') o[i.dataset.o] = +i.value; }); document.querySelectorAll('[data-d]').forEach(i => { if (i.value !== '') d[i.dataset.d] = +i.value; }); setCfg({ objectifs: { ...cget('objectifs', {}), [r]: o }, depart: { ...cget('depart', {}), [r]: d } }); toast('Objectifs enregistrés'); history.back(); };

// ---------- Démarque (V4) ----------
const lotsOf = d => db.all('lots').filter(l => l.date === d);
V['demarque'] = () => {
  const y = addDays(today(), -1), ly = lotsOf(y), lt = lotsOf(today()), r = S.dmR || lastRayon;
  const since = addDays(today(), -28), lots28 = db.all('lots').filter(l => l.date >= since && l.vendu != null), q = lots28.reduce((t, l) => t + (+l.qte || 0), 0), v = lots28.reduce((t, l) => t + (+l.vendu || 0), 0);
  const recup = lots28.reduce((t, l) => t + (l.valeur && l.qte ? l.valeur * (l.vendu / l.qte) * (1 - l.taux / 100) : 0), 0);
  const top = {}; db.all('casse').filter(c => c.date >= since && c.rayon === r).forEach(c => top[c.nom] = (top[c.nom] || 0) + (+c.valeur || +c.qte || 0)); db.all('lots').filter(l => l.date >= since && l.rayon === r && l.jete).forEach(l => top[l.nom] = (top[l.nom] || 0) + (l.valeur && l.qte ? l.valeur / l.qte * l.jete : l.jete));
  const tl = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 20), tt = tl.reduce((t, x) => t + x[1], 0) || 1;
  const lotRow = l => `<div class="card" style="margin-bottom:8px"><div style="display:flex;justify-content:space-between"><span>${tag(l.rayon)}${esc(l.nom)} · ${l.qte} × −${l.taux} %</span><span class="small muted">${hm(l.ts)}</span></div><div class="grid2" style="margin-top:6px"><label class="small muted">Vendu<input type="number" inputmode="numeric" value="${l.vendu ?? ''}" onchange="A.lotRes('${l.id}','vendu',this.value)"></label><label class="small muted">Jeté<input type="number" inputmode="numeric" value="${l.jete ?? ''}" onchange="A.lotRes('${l.id}','jete',this.value)"></label></div></div>`;
  return hdr('Démarque', 'casse et lots du soir', 1) + `<h2>Lots d'hier soir · à compléter</h2>${ly.length ? ly.map(lotRow).join('') : '<div class="small muted">Aucun lot hier.</div>'}` + (lt.length ? `<h2>Lots de ce soir</h2>${lt.map(l => `<div class="row" style="padding:6px 0"><span class="grow">${tag(l.rayon)}${esc(l.nom)} · ${l.qte} × −${l.taux} %</span><button class="del" onclick="A.lotD('${l.id}')">×</button></div>`).join('')}` : '') +
    `<div class="btns"><button class="btn sec" onclick="A.casseAdd()">Saisir une casse</button><button class="btn" onclick="A.lotAdd()">Nouveau lot −30/−50</button></div>` +
    `<div class="grid2 mt"><div class="kpi"><div class="l">Récupération 4 sem.</div><div class="v ${q && v / q >= 0.7 ? 'ok' : 'warn'}">${q ? nf(v / q * 100, 0) + ' %' : '—'}</div><div class="s">vendu sur démarqué</div></div><div class="kpi"><div class="l">Valeur récupérée</div><div class="v">${recup ? money(eur(recup), '•••• €') : '—'}</div><div class="s">si prix saisis</div></div></div>` +
    `<h2>Produits qui démarquent le plus · 4 sem.</h2>${chipsRay(r, 'dmR')}${tl.length ? `<div class="list">${tl.map(([n, x], i) => `<div class="row"><span class="muted" style="width:20px">${i + 1}</span><span class="grow">${esc(n)}</span><span class="${i < 3 ? 'bad' : ''}">${nf(x / tt * 100, 0)} %</span></div>`).join('')}</div><div class="small muted mt">% = part de la démarque suivie du rayon.</div>` : '<div class="small muted">Pas encore de casse saisie pour ce rayon.</div>'}`;
};
A.dmR = id => { S.dmR = id; setRay(id); render(); };
const prodSel = () => `<div class="field"><span>Rayon</span><select id="dr">${rayons().map(r => `<option value="${r.id}" ${r.id === lastRayon ? 'selected' : ''}>${esc(r.nom)}</option>`).join('')}</select></div><div class="field"><span>Produit</span><input type="text" id="dn" list="dpl" autocomplete="off"><datalist id="dpl">${(cfg().produits || []).map(p => `<option value="${esc(p.nom)}">`).join('')}</datalist></div>`;
A.casseAdd = () => sheet(`<h2 style="margin-top:0">Casse</h2>${prodSel()}<div class="grid2"><div class="field"><span>Quantité</span><input type="number" inputmode="decimal" id="dq"></div><div class="field"><span>Valeur (€, facultatif)</span><input type="number" inputmode="decimal" step="0.01" id="dv"></div></div><div class="field"><span>Motif</span><div class="chips" id="dm">${['Date dépassée', 'Abîmé', 'Casse', 'Autre'].map((m, i) => `<button class="chip ${i ? '' : 'on'}" onclick="document.querySelectorAll('#dm .chip').forEach(c=>c.classList.remove('on'));this.classList.add('on')">${m}</button>`).join('')}</div></div><div class="btns"><button class="btn sec" onclick="A.close()">Annuler</button><button class="btn" onclick="A.casseSave()">Enregistrer</button></div>`, '#dn');
A.casseSave = () => { const n = $('#dn').value.trim(); if (!n) { $('#dn').style.borderColor = 'var(--bad)'; return; } setRay($('#dr').value); db.put('casse', { date: today(), ts: Date.now(), rayon: $('#dr').value, nom: n, qte: +$('#dq').value || 0, valeur: +$('#dv').value || null, motif: document.querySelector('#dm .chip.on').textContent }); A.close(); toast('Casse enregistrée'); };
A.lotAdd = () => sheet(`<h2 style="margin-top:0">Lot du soir</h2>${prodSel()}<div class="grid2"><div class="field"><span>Quantité</span><input type="number" inputmode="numeric" id="dq"></div><div class="field"><span>Valeur avant remise (€, facultatif)</span><input type="number" inputmode="decimal" step="0.01" id="dv"></div></div><div class="field"><span>Remise</span><div class="seg two" id="dt"><button class="on-acc" data-t="30" onclick="this.classList.add('on-acc');this.nextElementSibling.classList.remove('on-acc')">−30 %</button><button data-t="50" onclick="this.classList.add('on-acc');this.previousElementSibling.classList.remove('on-acc')">−50 %</button></div></div><div class="btns"><button class="btn sec" onclick="A.close()">Annuler</button><button class="btn" onclick="A.lotSave()">Enregistrer</button></div>`, '#dn');
A.lotSave = () => { const n = $('#dn').value.trim(), q = +$('#dq').value; if (!n || !q) { toast('Produit et quantité requis'); return; } setRay($('#dr').value); db.put('lots', { date: today(), ts: Date.now(), rayon: $('#dr').value, nom: n, qte: q, valeur: +$('#dv').value || null, taux: +document.querySelector('#dt .on-acc').dataset.t }); A.close(); toast('Lot enregistré'); };
A.lotRes = (id, k, v) => { const l = db.get('lots', id); const o = { ...l, [k]: v === '' ? null : +v }; if (k === 'vendu' && o.jete == null && o.vendu != null) o.jete = Math.max(0, l.qte - o.vendu); db.put('lots', o); if (lotsOf(addDays(today(), -1)).every(x => (x.id === id ? o : x).vendu != null)) markTask('demarque'); };
A.lotD = id => db.del('lots', id);

// ---------- Jours particuliers (V4) ----------
function easter(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return `${y}-${pad(mo)}-${pad(da)}`; }
function feries(y) { const e = easter(y); return { [`${y}-01-01`]: 'Jour de l\'an', [addDays(e, 1)]: 'Lundi de Pâques', [`${y}-05-01`]: 'Fête du travail', [`${y}-05-08`]: 'Victoire 1945', [addDays(e, 39)]: 'Ascension', [addDays(e, 50)]: 'Lundi de Pentecôte', [`${y}-07-14`]: 'Fête nationale', [`${y}-08-15`]: 'Assomption', [`${y}-11-01`]: 'Toussaint', [`${y}-11-11`]: 'Armistice', [`${y}-12-25`]: 'Noël' }; }
const DEFJ = { ferie: 0.6, veille: 1.2, debutMois: 1.05, vacances: 0.97, d23: 1.4, d24: 1.8, d31: 1.6, paques: 1.15 };
const DEFVAC = [{ du: '2026-10-17', au: '2026-11-01', l: 'Vacances de la Toussaint' }, { du: '2026-12-19', au: '2027-01-03', l: 'Vacances de Noël' }];
function dayInfo(d) {
  const y = +d.slice(0, 4), F = feries(y), c = { ...DEFJ, ...cget('coefs', {}) }, tags = []; let k = 1;
  if (F[d]) { k *= c.ferie; tags.push(F[d]); }
  if (F[addDays(d, 1)]) { k *= c.veille; tags.push('Veille de férié'); }
  const md = d.slice(5); if (md === '12-23') { k *= c.d23; tags.push('Avant Noël'); } if (md === '12-24') { k *= c.d24; tags.push('Veille de Noël'); } if (md === '12-31') { k *= c.d31; tags.push('Réveillon'); }
  if (d === addDays(easter(y), -1)) { k *= c.paques; tags.push('Veille de Pâques'); }
  if (+d.slice(8) <= 3) { k *= c.debutMois; tags.push('Début de mois'); }
  (cget('vacances', DEFVAC)).forEach(v => { if (d >= v.du && d <= v.au) { k *= c.vacances; tags.push(v.l); } });
  (cget('evenements', [])).forEach(v => { if (d >= v.du && d <= (v.au || v.du) && (!v.r || v.r === S._r)) { k *= (+v.coef || 1); tags.push(v.l); } });
  return { k, tags };
}
V['r-jours'] = () => { const c = { ...DEFJ, ...cget('coefs', {}) }, L = { ferie: 'Jour férié (si ouvert)', veille: 'Veille de férié', debutMois: 'Début de mois (1er au 3)', vacances: 'Vacances scolaires', d23: '23 décembre', d24: '24 décembre', d31: '31 décembre', paques: 'Samedi de Pâques' }; return hdr('Jours particuliers', 'effet sur les ventes · 1 = normal, 1,2 = +20 %', 1) + `<div class="card small muted">La première année, ces effets sont des estimations à ajuster. Les fériés et Pâques sont calculés automatiquement chaque année.</div><div class="list mt">${Object.entries(L).map(([k, l]) => `<div class="row"><span class="grow">${l}</span><input type="number" step="0.05" value="${c[k]}" style="width:84px" onchange="A.coef('${k}',this.value)"></div>`).join('')}</div><h2>Vacances scolaires (zone A)</h2><div class="list">${cget('vacances', DEFVAC).map((v, i) => `<div class="row"><span class="grow">${esc(v.l)}<div class="small muted">${fDate(v.du, { day: 'numeric', month: 'short', year: 'numeric' })} → ${fDate(v.au, { day: 'numeric', month: 'short', year: 'numeric' })}</div></span><button class="del" onclick="A.vacD(${i})">×</button></div>`).join('')}</div><button class="btn sec mt" onclick="A.evAdd('vacances')">Ajouter des vacances</button><div class="small muted mt">Dates à vérifier sur le calendrier officiel de l'Éducation nationale.</div><h2>Événements locaux</h2><div class="list">${cget('evenements', []).map((v, i) => `<div class="row"><span class="grow">${esc(v.l)} · ×${nf(v.coef, 2)}<div class="small muted">${fDate(v.du, { day: 'numeric', month: 'short' })}${v.au && v.au !== v.du ? ' → ' + fDate(v.au, { day: 'numeric', month: 'short' }) : ''}${v.r ? ' · ' + esc(R(v.r).court) : ''}</div></span><button class="del" onclick="A.evD(${i})">×</button></div>`).join('') || '<div class="empty">Foire, marché, promo, travaux…</div>'}</div><button class="btn sec mt" onclick="A.evAdd('evenements')">Ajouter un événement</button>`; };
A.coef = (k, v) => setCfg({ coefs: { ...cget('coefs', {}), [k]: +v.replace(',', '.') || 1 } });
A.vacD = i => { const l = [...cget('vacances', DEFVAC)]; l.splice(i, 1); setCfg({ vacances: l }); };
A.evD = i => { const l = [...cget('evenements', [])]; l.splice(i, 1); setCfg({ evenements: l }); };
A.evAdd = t => sheet(`<h2 style="margin-top:0">${t === 'vacances' ? 'Vacances scolaires' : 'Événement'}</h2><div class="field"><span>Nom</span><input type="text" id="el"></div><div class="grid2"><div class="field"><span>Du</span><input type="date" id="e1" value="${today()}" ${tiS}></div><div class="field"><span>Au</span><input type="date" id="e2" value="${today()}" ${tiS}></div></div>${t === 'evenements' ? `<div class="grid2"><div class="field"><span>Effet (1,25 = +25 %)</span><input type="number" step="0.05" id="ec" value="1.2"></div><div class="field"><span>Rayon</span><select id="er"><option value="">Tous</option>${rayons().map(r => `<option value="${r.id}">${esc(r.court)}</option>`).join('')}</select></div></div>` : ''}<div class="btns"><button class="btn sec" onclick="A.close()">Annuler</button><button class="btn" onclick="A.evSave('${t}')">Ajouter</button></div>`, '#el');
A.evSave = t => { const l = $('#el').value.trim(); if (!l) return; const o = { l, du: $('#e1').value, au: $('#e2').value }; if (t === 'evenements') Object.assign(o, { coef: +$('#ec').value.replace(',', '.') || 1, r: $('#er').value || null }); setCfg({ [t]: [...cget(t, t === 'vacances' ? DEFVAC : []), o] }); A.close(); };

// ---------- Prévisions ventes et personnel (V4) ----------
const PROFJ = { 1: 0.12, 2: 0.12, 3: 0.14, 4: 0.14, 5: 0.19, 6: 0.25, 0: 0.04 };
const AFF = { 8: 4, 9: 6, 10: 9, 11: 11, 12: 9, 13: 6, 14: 6, 15: 7, 16: 9, 17: 12, 18: 13, 19: 8 };
const hasTeam = r => people().some(p => p.rayon === r && p.type !== 'interim');
const prodR = r => ({ fixes: 20, cible: 180, cout: 22, coutI: 30, ...((cget('prod', {}))[r] || {}) });
function trend(r) { const w0 = wk(today()); let a = 0, b = 0; for (let i = 1; i <= 4; i++) { const s = semDoc(addDays(w0, -7 * i), r); if (+s.ca && +s.can1) { a += +s.ca; b += +s.can1; } } return b ? a / b : 1; }
function baseN1(w, r) { const ly = semDoc(addDays(w, -364), r); if (+ly.ca) return +ly.ca; const s = semDoc(w, r); return +s.can1 || null; }
function forecast(w, r) {
  S._r = r; const base = baseN1(w, r); if (!base) return null;
  const pj = { ...PROFJ, ...((cget('profilJour', {}))[r] || {}) }, days = weekDays(w);
  const num = days.reduce((t, d) => t + pj[new Date(d + 'T12:00').getDay()] * dayInfo(d).k, 0), den = days.reduce((t, d) => t + pj[new Date(d + 'T12:00').getDay()] * dayInfo(addDays(d, -364)).k, 0);
  const tr = trend(r), ca = base * tr * (den ? num / den : 1), sum = days.reduce((t, d) => t + pj[new Date(d + 'T12:00').getDay()] * dayInfo(d).k, 0);
  const byDay = days.map(d => ({ d, ca: ca * pj[new Date(d + 'T12:00').getDay()] * dayInfo(d).k / (sum || 1), tags: dayInfo(d).tags }));
  const pr = prodR(r), need = pr.fixes + ca / pr.cible;
  const plan = days.reduce((t, d) => t + presents(r, d).filter(x => !x.abs).reduce((u, x) => u + dur(x.s.d, x.s.f), 0), 0);
  return { base, tr, ca, byDay, need, plan, gap: plan - need, pr };
}
V['previsions'] = () => {
  const w = S.pvW || addDays(wk(today()), 7), f = rayons().map(r => ({ r, x: forecast(w, r.id) })), seuil = cget('seuilEcart', 10);
  const tags = weekDays(w).map(d => { S._r = null; return [d, dayInfo(d).tags]; }).filter(([, t]) => t.length);
  return hdr('Prévisions', `semaine du ${fDate(w, { day: 'numeric', month: 'long' })}`, 1) + `<div class="seg" style="margin-bottom:10px"><button onclick="S.pvW=addDays(S.pvW||addDays(monday(today()),7),-7);render()">‹ Préc.</button><button onclick="S.pvW=null;render()">Prochaine</button><button onclick="S.pvW=addDays(S.pvW||addDays(monday(today()),7),7);render()">Suiv. ›</button></div>` +
    `<div class="card" style="overflow-x:auto"><div class="tbl" style="grid-template-columns:1.2fr repeat(3,minmax(60px,1fr));min-width:330px"><span class="h">Rayon</span><span class="h r">Ventes</span><span class="h r">Heures</span><span class="h r">Écart</span>${f.map(({ r, x }) => x && !hasTeam(r.id) ? `<span>${tag(r.id)}${esc(r.court)}</span><span class="r">${money(eur(x.ca), pct((x.ca / x.base - 1) * 100, 0))}</span><span class="r muted" style="grid-column:span 2">équipe non saisie</span>` : x ? `<span>${tag(r.id)}${esc(r.court)}</span><span class="r">${money(eur(x.ca), pct((x.ca / x.base - 1) * 100, 0))}</span><span class="r">${nf(x.need, 0)} / ${nf(x.plan, 0)}</span><span class="r ${Math.abs(x.gap) / x.need * 100 > seuil ? (x.gap < 0 ? 'bad' : 'acc') : 'ok'}">${x.gap > 0 ? '+' : ''}${nf(x.gap, 0)} h</span>` : `<span>${tag(r.id)}${esc(r.court)}</span><span class="r muted" style="grid-column:span 3">base N-1 manquante</span>`).join('')}</div><div class="small muted mt">Ventes vs N-1 · heures nécessaires / planifiées (fixes + variables) · écart = planifié − nécessaire</div></div>` +
    f.filter(({ r, x }) => x && hasTeam(r.id) && Math.abs(x.gap) / x.need * 100 > seuil).map(({ r, x }) => { const byH = peakHint(w, r.id); return x.gap < 0 ? `<div class="alert a-bad mt">${esc(r.court)} : il manque environ ${nf(-x.gap, 0)} h, soit ${nf(-x.gap / 35, 1)} personne(s) à temps plein${byH ? ', surtout ' + byH : ''}.</div>` : `<div class="alert a-acc mt">${esc(r.court)} : environ ${nf(x.gap, 0)} h de plus que nécessaire. ${transferHint(r.id, x.gap, f)}</div>`; }).join('') +
    guardAlerts().map(t => `<div class="alert a-warn mt">${t}</div>`).join('') +
    (tags.length ? `<h2>Jours particuliers de la semaine</h2><div class="list">${tags.map(([d, t]) => `<div class="row"><span class="grow">${cap(fDate(d, { weekday: 'long', day: 'numeric' }))} · ${t.map(esc).join(', ')}</span><span class="small muted">×${nf(dayInfo(d).k, 2)}</span></div>`).join('')}</div>` : '') +
    `<h2>Efficacité · dernière semaine</h2><div class="card" style="overflow-x:auto"><div class="tbl" style="grid-template-columns:1.2fr repeat(3,minmax(64px,1fr));min-width:330px"><span class="h">Rayon</span><span class="h r">CA/h</span><span class="h r">Marge/h</span><span class="h r">Pers./CA</span>${rayons().map(r => { const k = kpiW(addDays(wk(today()), -7), r.id), pr = prodR(r.id), mh = k.ca && k.h && k.marge != null ? k.ca * k.marge / 100 / k.h : null, fp = k.ca && k.h ? k.h * pr.cout / k.ca * 100 : null; return `<span>${tag(r.id)}${esc(r.court)}</span><span class="r ${col('cah', k.cah, r.id)}">${k.cah ? money(eur(k.cah), nf(k.cah, 0)) : '—'}</span><span class="r">${mh ? money(eur(mh), nf(mh, 0)) : '—'}</span><span class="r">${fp ? nf(fp) + ' %' : '—'}</span>`; }).join('')}</div></div>` +
    `<div class="list mt">${lk('#/r-prod', 'Productivité cible et coûts horaires par rayon')}${lk('#/r-jours', 'Jours particuliers et effets')}${lk('#/r-affluence', 'Profil d\'affluence et de ventes')}${lk('#/chiffres/' + w, 'Saisir le CA N-1 de cette semaine')}</div><div class="small muted mt">Prévision = CA de l'an dernier (même semaine, jours alignés) × tendance des 4 dernières semaines × effet des jours particuliers. Indicative la première année.</div>`;
};
function needByHour(r, d) {
  const x = forecast(wk(d), r); if (!x) return null;
  const dc = x.byDay.find(y => y.d === d), dayVar = dc ? dc.ca / x.pr.cible : 0, dayFix = x.pr.fixes * (PROFJ[new Date(d + 'T12:00').getDay()] ? 1 / 6 : 0);
  const af = { ...AFF, ...cget('affluence', {}) }, tot = Object.values(af).reduce((a, b) => a + b, 0) || 1;
  const fx = { 6: 0.4, 7: 0.3, 8: 0.2, 20: 0.1 };
  const out = {}; for (let h = 6; h <= 20; h++) out[h] = (af[h] || 0) / tot * dayVar + (fx[h] || 0) * dayFix;
  return out;
}
function presByHour(r, d, delta) {
  const out = {}; for (let h = 6; h <= 20; h++) out[h] = 0;
  presents(r, d).filter(x => !x.abs).forEach(({ s }) => { for (let h = 6; h <= 20; h++) { const a = Math.max(hMin(s.d), h * 60), b = Math.min(hMin(s.f), (h + 1) * 60); if (b > a) out[h] += (b - a) / 60; } });
  if (delta) delta.forEach(({ d0, f0, n }) => { const span = (hMin(f0) - hMin(d0)) / 60; if (span <= 0) return; for (let h = 6; h <= 20; h++) { const a = Math.max(hMin(d0), h * 60), b = Math.min(hMin(f0), (h + 1) * 60); if (b > a) out[h] = Math.max(0, out[h] + n / span * (b - a) / 60); } });
  return out;
}
function peakHint(w, r) { const days = weekDays(w); let worst = null; days.forEach(d => { const n = needByHour(r, d), p = presByHour(r, d); if (!n) return; let run = []; for (let h = 6; h <= 20; h++) { if (n[h] - p[h] > 0.4) run.push(h); } if (run.length && (!worst || run.length > worst.run.length)) worst = { d, run }; }); return worst ? `${fDate(worst.d, { weekday: 'long' })} ${worst.run[0]} h – ${worst.run[worst.run.length - 1] + 1} h` : ''; }
function transferHint(r, gap, f) { const need = f.find(({ r: q, x }) => q.id !== r && x && x.gap < 0); if (!need) return ''; const poly = people().filter(p => p.rayon === r && Object.keys(p.niv || {}).length).length; return `Transférables vers ${need.r.court}${poly ? ` (${poly} personne${poly > 1 ? 's' : ''} polyvalente${poly > 1 ? 's' : ''})` : ''}.`; }
// Garde-fou : des heures retirées qui dégradent la qualité
function guardAlerts() {
  const w1 = addDays(wk(today()), -7), w2 = addDays(w1, -7), out = [];
  rayons().forEach(r => { const a = kpiW(w1, r.id), b = kpiW(w2, r.id); if (!a.h || !b.h || a.h >= b.h * 0.95) return; const why = []; if (a.rupt >= b.rupt + 3 && a.rupt > b.rupt * 1.3) why.push(`ruptures ${pct((a.rupt / Math.max(b.rupt, 1) - 1) * 100, 0)}`); if (a.obs != null && b.obs != null && a.obs < b.obs - 10) why.push(`observations OK −${nf(b.obs - a.obs, 0)} pts`); if (a.ecart != null && b.ecart != null && a.ecart < b.ecart - 3) why.push('CA en recul'); if (why.length) out.push(`Garde-fou · ${r.court} : ${nf(a.h - b.h, 0)} h la semaine dernière et ${why.join(', ')}. Économie probablement perdue en ventes.`); });
  return out;
}
function prodAlerts() { const out = []; rayons().forEach(r => { const v = [1, 2, 3, 4].map(i => kpiW(addDays(wk(today()), -7 * i), r.id).cah); if (v.every(x => x != null) && v[0] < v[1] && v[1] < v[2] && v[2] < v[3]) out.push(`Productivité en baisse 3 semaines de suite · ${r.court}`); }); return out; }

// Couverture heure par heure
V['couverture'] = () => {
  const r = S.cvR || lastRayon, d = S.cvD || today(), n = needByHour(r, d), p = presByHour(r, d);
  let svg = '';
  if (n) { const mx = Math.max(2, ...Object.values(n), ...Object.values(p)); const bars = []; const pts = []; for (let h = 6; h <= 20; h++) { const x = 30 + (h - 6) * 20, hp = p[h] / mx * 110, red = n[h] - p[h] > 0.4; bars.push(`<rect x="${x}" y="${130 - hp}" width="14" height="${hp}" rx="2" fill="${red ? '#E24B4A' : '#85B7EB'}"/>`); pts.push(`${x + 7},${130 - n[h] / mx * 110}`); } svg = `<svg viewBox="0 0 330 160" width="100%" role="img" aria-label="Présents et besoin par heure"><line x1="26" y1="130" x2="326" y2="130" stroke="var(--line)"/>${bars.join('')}<polyline fill="none" stroke="#BA7517" stroke-width="2" points="${pts.join(' ')}"/>${[6, 10, 14, 18].map(h => `<text x="${37 + (h - 6) * 20}" y="148" text-anchor="middle" font-size="11" fill="var(--faint)">${h}h</text>`).join('')}<text x="22" y="24" text-anchor="end" font-size="10" fill="var(--faint)">${nf(mx, 0)}</text></svg><div class="small muted"><span class="tag" style="background:#85B7EB"></span>présents <span class="tag" style="background:#E24B4A;margin-left:10px"></span>sous-couvert <span class="tag" style="background:#BA7517;height:3px;margin-left:10px"></span>besoin</div>`; }
  const holes = n ? Object.keys(n).filter(h => n[h] - p[h] > 0.4).map(Number) : [];
  return hdr('Couverture · ' + esc(R(r).court), cap(fDate(d)), 1) + chipsRay(r, 'cvRay') + `<div class="seg" style="margin-bottom:10px"><button onclick="S.cvD=addDays(S.cvD||today(),-1);render()">‹ Veille</button><button onclick="S.cvD=null;render()">Aujourd'hui</button><button onclick="S.cvD=addDays(S.cvD||today(),1);render()">Lendemain ›</button></div>` +
    (n && !hasTeam(r) ? empty('Ajoute d\'abord l\'équipe de ce rayon (Équipes, liste des prénoms).') : n ? `<div class="card">${svg}</div>${holes.length ? `<div class="alert a-bad mt">${holes[0]} h – ${holes[holes.length - 1] + 1} h : il manque jusqu'à ${nf(Math.max(...holes.map(h => n[h] - p[h])), 1)} personne(s) sur ce créneau. Décale un horaire ou ajoute un renfort sur ce créneau.</div>` : '<div class="alert a-ok mt">Tous les créneaux sont couverts.</div>'}` : empty('Pas de prévision possible : saisis le CA N-1 de cette semaine (Pilotage, Chiffres).')) + `<div class="mt">${lk('#/presents/' + r, 'Présents et renforts de ce rayon')}</div>`;
};
A.cvRay = id => { S.cvR = id; setRay(id); render(); };

// Simulateur
V['simulateur'] = () => {
  const r = S.siR || lastRayon, d = S.siD || addDays(wk(today()), 8), a = S.siA ?? -2, b = S.siB ?? 2;
  const cA = S.siCA || ['07:00', '12:00'], cB = S.siCB || ['14:00', '19:00'], pr = prodR(r);
  const n = needByHour(r, d);
  const cov = delta => { if (!n) return null; const p = presByHour(r, d, delta); let t = 0, c = 0; for (let h = 6; h <= 20; h++) { t += n[h]; c += Math.min(n[h], p[h]); } return t ? c / t * 100 : null; };
  const D = [{ d0: cA[0], f0: cA[1], n: a }, { d0: cB[0], f0: cB[1], n: b }];
  const c0 = cov([]), c1 = cov(D), pA = presByHour(r, d, D), low = n ? Object.keys(n).filter(h => hMin(cA[0]) <= h * 60 && h * 60 < hMin(cA[1]) && n[h] - pA[h] > 0.4).length : 0;
  const x = forecast(wk(d), r), H = x ? x.plan : null, dc = x ? x.byDay.find(y => y.d === d) : null;
  return hdr('Simulateur · ' + esc(R(r).court), cap(fDate(d)), 1) + chipsRay(r, 'siRay') + `<div class="seg" style="margin-bottom:10px"><button onclick="S.siD=addDays(S.siD||addDays(monday(today()),8),-1);render()">‹ Jour</button><button onclick="S.siD=null;render()">Mardi proch.</button><button onclick="S.siD=addDays(S.siD||addDays(monday(today()),8),1);render()">Jour ›</button></div>` +
    `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:6px"><span>Créneau A</span><input type="time" value="${cA[0]}" onchange="S.siCA=[this.value,(S.siCA||['07:00','12:00'])[1]];render()" style="width:100px"><input type="time" value="${cA[1]}" onchange="S.siCA=[(S.siCA||['07:00','12:00'])[0],this.value];render()" style="width:100px"><b id="sa">${a > 0 ? '+' : ''}${a} h</b></div><input type="range" min="-10" max="10" step="1" value="${a}" style="width:100%" oninput="S.siA=+this.value;render()"><div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-top:10px"><span>Créneau B</span><input type="time" value="${cB[0]}" onchange="S.siCB=[this.value,(S.siCB||['14:00','19:00'])[1]];render()" style="width:100px"><input type="time" value="${cB[1]}" onchange="S.siCB=[(S.siCB||['14:00','19:00'])[0],this.value];render()" style="width:100px"><b>${b > 0 ? '+' : ''}${b} h</b></div><input type="range" min="-10" max="10" step="1" value="${b}" style="width:100%" oninput="S.siB=+this.value;render()"></div>` +
    `<div class="grid2 mt"><div class="kpi"><div class="l">Coût de la journée</div><div class="v">${(a + b) * pr.cout > 0 ? '+' : ''}${eur((a + b) * pr.cout)}</div><div class="s">coût horaire ${eur(pr.cout)}</div></div><div class="kpi"><div class="l">Couverture des besoins</div><div class="v ${c1 == null ? '' : c1 >= 90 ? 'ok' : c1 >= 75 ? 'warn' : 'bad'}">${c1 == null ? '—' : nf(c1, 0) + ' %'}</div><div class="s">avant ${c0 == null ? '—' : nf(c0, 0) + ' %'}</div></div><div class="kpi"><div class="l">Créneau A</div><div class="v ${low ? 'bad' : 'ok'}">${low ? 'Trop juste' : 'OK'}</div></div><div class="kpi"><div class="l">CA / heure du jour</div><div class="v">${dc && H ? pct(((dc.ca / Math.max(1, H / 6 + a + b)) / (dc.ca / Math.max(1, H / 6)) - 1) * 100) : '—'}</div></div></div>` +
    (!n ? '<div class="alert a-warn mt">Sans CA N-1 pour cette semaine, la couverture ne peut pas être estimée.</div>' : c1 != null && c0 != null ? `<div class="alert mt ${low ? 'a-bad' : c1 >= c0 ? 'a-ok' : 'a-warn'}">${low ? 'Le créneau A devient sous-couvert.' : c1 >= c0 ? 'Équilibre favorable : meilleure couverture des besoins.' : 'La couverture baisse : vérifie les pics.'}</div>` : '') + `<div class="small muted mt">Simulation seulement : rien n'est modifié dans le planning.</div>`;
};
A.siRay = id => { S.siR = id; setRay(id); render(); };

// Réglages V4
V['r-prod'] = () => hdr('Productivité et coûts', 'par rayon · coût horaire moyen, jamais de salaire individuel', 1) + rayons().map(r => { const p = prodR(r.id); return `<div class="card" style="margin-bottom:8px"><div style="margin-bottom:6px">${tag(r.id)}${esc(r.nom)}</div><div class="grid2">${[['fixes', 'Heures fixes / semaine'], ['cible', 'CA cible par heure (€)'], ['cout', 'Coût horaire moyen chargé (€)'], ['coutI', 'Coût horaire intérim (€)']].map(([k, l]) => `<label class="small muted">${l}<input type="number" step="any" data-pr="${r.id}" data-k="${k}" value="${p[k]}"></label>`).join('')}</div></div>`; }).join('') + `<div class="field"><span>Alerte si l'écart dépasse (%)</span><input type="number" id="se" value="${cget('seuilEcart', 10)}"></div><button class="btn" onclick="A.prodSave()">Enregistrer</button><div class="small muted mt">Heures fixes : ouverture, réception, nettoyage, fermeture. Les heures variables suivent les ventes prévues.</div>`;
A.prodSave = () => { const m = { ...cget('prod', {}) }; document.querySelectorAll('[data-pr]').forEach(i => { (m[i.dataset.pr] = { ...(m[i.dataset.pr] || {}) })[i.dataset.k] = +i.value; }); setCfg({ prod: m, seuilEcart: +$('#se').value || 10 }); toast('Enregistré'); history.back(); };
V['r-affluence'] = () => { const af = { ...AFF, ...cget('affluence', {}) }, r = S.afR || lastRayon, pj = { ...PROFJ, ...((cget('profilJour', {}))[r] || {}) }; return hdr('Affluence et ventes', 'à ajuster avec les statistiques de caisse', 1) + `<h2>Affluence par heure (tous rayons)</h2><div class="small muted" style="margin-bottom:6px">Poids relatifs, par exemple le nombre de tickets par heure.</div><div class="grid2">${Object.keys(af).map(h => `<label class="small muted">${h} h – ${+h + 1} h<input type="number" data-af="${h}" value="${af[h]}"></label>`).join('')}</div><h2>Part des ventes par jour · ${esc(R(r).court)}</h2>${chipsRay(r, 'afRay')}<div class="grid2">${[1, 2, 3, 4, 5, 6, 0].map(w => `<label class="small muted">${JN[w]}<input type="number" step="0.01" data-pj="${w}" value="${pj[w]}"></label>`).join('')}</div><button class="btn mt" onclick="A.afSave('${r}')">Enregistrer</button>`; };
A.afRay = id => { S.afR = id; render(); };
A.afSave = r => { const af = {}, pj = {}; document.querySelectorAll('[data-af]').forEach(i => af[i.dataset.af] = +i.value || 0); document.querySelectorAll('[data-pj]').forEach(i => pj[i.dataset.pj] = +i.value.replace(',', '.') || 0); setCfg({ affluence: af, profilJour: { ...cget('profilJour', {}), [r]: pj } }); toast('Enregistré'); };

// ---------- Rapports (V3) ----------
const printBtn = '<button class="btn mt noprint" onclick="window.print()">Exporter en PDF</button><div class="small muted mt noprint">Sur iPhone : Imprimer, puis écarte deux doigts sur l\'aperçu et Partager pour enregistrer le PDF.</div>';
V['rapports'] = () => hdr('Rapports', 'export PDF en un geste', 1) + `<div class="list">${lk('#/r-mardi', 'Point du mardi')}${lk('#/r-mensuel', 'Bilan mensuel')}${lk('#/actions', 'Bilan d\'un pilote (depuis la fiche du pilote)')}${lk('#/r-restit', 'Restitution (3 mois)')}${lk('#/r-fetes', 'Bilan des fêtes')}</div><h2>Exports Excel</h2><div class="list">${[['ruptures', 'Ruptures'], ['obs', 'Observations'], ['semaines', 'Chiffres des semaines'], ['casse', 'Casse'], ['lots', 'Lots du soir'], ['actions', 'Actions']].map(([c, l]) => `<button class="row" onclick="A.csv('${c}')"><span class="grow">${l}</span><span class="small acc">CSV</span></button>`).join('')}</div><div class="small muted mt">Les fichiers CSV s'ouvrent dans Excel ou Numbers.</div>`;
A.csv = c => { const l = db.all(c); if (!l.length) { toast('Aucune donnée'); return; } const flat = o => Object.fromEntries(Object.entries(o).filter(([k]) => !['dev', 'upd', 'ph'].includes(k)).map(([k, v]) => [k, typeof v === 'object' && v ? JSON.stringify(v) : v])); const rows = l.map(flat), keys = [...new Set(rows.flatMap(Object.keys))]; const q = v => { const s = String(v ?? '').replace(/"/g, '""'); return /[;"\n]/.test(s) ? `"${s}"` : s; }; const txt = '\ufeff' + keys.join(';') + '\n' + rows.map(r => keys.map(k => q(r[k])).join(';')).join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv' })); a.download = `rayons-frais-${c}-${today()}.csv`; document.body.appendChild(a); a.click(); a.remove(); };
function faitsCand(w) {
  const out = [];
  rayons().forEach(r => { const k = kpiW(w, r.id), p = kpiW(addDays(w, -7), r.id); if (k.dem != null && p.dem != null && Math.abs(k.dem - p.dem) >= 0.3) out.push(`${r.court} : démarque ${k.dem < p.dem ? 'en baisse' : 'en hausse'} (${nf(p.dem, 2)} → ${nf(k.dem, 2)} %)`); if (k.rupt >= p.rupt + 3) out.push(`${r.court} : ${k.rupt} ruptures (${p.rupt} la semaine précédente)`); if (k.ecart != null && Math.abs(k.ecart) >= 3) out.push(`${r.court} : CA ${pct(k.ecart)} vs N-1`); });
  const su = db.all('suivis').filter(s => !s.closeTs); if (su.length) out.push(`${su.length} problème(s) relevé(s) non réglé(s)`);
  db.all('notes').filter(n => n.date >= w && n.date < addDays(w, 7) && (n.k || []).some(k => /important/i.test(k))).forEach(n => out.push(n.t.slice(0, 90)));
  return out;
}
V['r-mardi'] = (w0) => {
  const w = w0 || addDays(wk(today()), -7), t = kpiTot(w), pk = kpiTot(addDays(w, -7)), cand = faitsCand(w);
  S.rm = S.rm && S.rm.w === w ? S.rm : { w, f: cand.slice(0, 3), dec: '' };
  const acts = db.all('actions').filter(a => !['fait', 'abandon'].includes(a.statut));
  return hdr('Point du mardi', `semaine du ${fDate(w, { day: 'numeric', month: 'long' })}`, 1) + `<div class="grid2">${['ecart', 'marge', 'dem', 'rupt'].map(k => `<div class="kpi"><div class="l">${IND[k].l}</div><div class="v ${col(k, t[k])}">${t[k] == null ? '—' : IND[k].f(t[k])}</div><div class="s">sem. préc. ${pk[k] == null ? '—' : IND[k].f(pk[k])}</div></div>`).join('')}</div>` +
    `<h2>Par rayon</h2><div class="card"><div class="tbl" style="grid-template-columns:1.3fr repeat(3,1fr)"><span class="h">Rayon</span><span class="h r">CA N-1</span><span class="h r">Démarque</span><span class="h r">Plan</span>${rayons().map(r => { const k = kpiW(w, r.id), v = planPct(r.id); return `<span>${tag(r.id)}${esc(r.court)}</span><span class="r ${col('ecart', k.ecart, r.id)}">${pct(k.ecart)}</span><span class="r ${col('dem', k.dem, r.id)}">${k.dem == null ? '—' : nf(k.dem, 2) + ' %'}</span><span class="r">${v == null ? '—' : v + ' %'}</span>`; }).join('')}</div></div>` +
    `<h2>Actions en cours · ${acts.length}</h2><div class="list">${acts.slice(0, 8).map(a => { const late = a.echeance && a.echeance < today(); return `<div class="row"><span class="grow">${tag(a.rayon)}${esc(a.titre)}</span><span class="pill ${late ? 'p-bad' : ST_A[a.statut || 'afaire'][0]}">${late ? 'En retard' : ST_A[a.statut || 'afaire'][1]}</span></div>`; }).join('') || '<div class="empty">Aucune action en cours.</div>'}</div>` +
    `<h2>Faits marquants</h2><div class="noprint small muted" style="margin-bottom:6px">Propositions de l'appli : touche pour choisir (3 maximum), ou écris les tiens.</div><div class="chips noprint">${cand.map((c, i) => `<button class="chip ${S.rm.f.includes(c) ? 'on' : ''}" onclick="A.rmF(${i})">${esc(c)}</button>`).join('')}</div><div class="card mt">${S.rm.f.map((f, i) => `<div>${i + 1}. ${esc(f)}</div>`).join('') || '<span class="muted">Aucun fait choisi.</span>'}</div><div class="noprint" style="display:flex;gap:8px;margin-top:8px"><input type="text" id="rmx" placeholder="Ajouter un fait"><button class="chip" onclick="A.rmAdd()">Ajouter</button></div>` +
    `<h2>Décision demandée</h2><input type="text" class="noprint" placeholder="facultatif" value="${esc(S.rm.dec)}" oninput="S.rm.dec=this.value;document.getElementById('rmd').textContent=this.value">${`<div class="alert a-warn mt" id="rmd" style="${S.rm.dec ? '' : 'display:none'}">${esc(S.rm.dec)}</div>`}` + printBtn;
};
A.rmF = i => { const c = faitsCand(S.rm.w)[i], f = S.rm.f; f.includes(c) ? f.splice(f.indexOf(c), 1) : f.length < 3 && f.push(c); render(); };
A.rmAdd = () => { const t = $('#rmx').value.trim(); if (t && S.rm.f.length < 3) { S.rm.f.push(t); render(); } else if (t) toast('3 faits maximum'); };
V['r-mensuel'] = (m0) => {
  const m = m0 || (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return iso(d).slice(0, 7); })();
  const ws = []; for (let w = wk(m + '-01'); w < addDays(m + '-01', 31) && w.slice(0, 7) <= m; w = addDays(w, 7)) if (addDays(w, 3).slice(0, 7) === m) ws.push(w);
  const pm = (() => { const d = new Date(m + '-15'); d.setMonth(d.getMonth() - 1); return iso(d).slice(0, 7); })();
  const agg = (r, key, list) => { const v = list.map(w => r ? kpiW(w, r)[key] : kpiTot(w)[key]).filter(x => x != null); return v.length ? (key === 'rupt' ? v.reduce((a, b) => a + b) / v.length : v.reduce((a, b) => a + b) / v.length) : null; };
  const pws = []; for (let w = wk(pm + '-01'); w.slice(0, 7) <= pm; w = addDays(w, 7)) if (addDays(w, 3).slice(0, 7) === pm) pws.push(w);
  const doneM = db.all('actions').filter(a => a.statut === 'fait' && a.upd && iso(new Date(a.upd)).slice(0, 7) === m).length;
  const plan = planL(), dn = plan.filter(p => p.fait).length;
  return hdr('Bilan mensuel', cap(new Date(m + '-15').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })), 1) + `<div class="seg two noprint" style="margin-bottom:10px"><button onclick="location.hash='#/r-mensuel/${pm}'">‹ Mois préc.</button><button onclick="location.hash='#/r-mensuel'">Dernier mois</button></div>` +
    `<div class="grid2">${[['ecart', 'CA vs N-1'], ['dem', 'Démarque'], ['rupt', 'Ruptures / sem.'], ['obs', 'Observations OK']].map(([k, l]) => { const v = agg(null, k, ws), p = agg(null, k, pws); return `<div class="kpi"><div class="l">${l}</div><div class="v ${col(k, v)}">${v == null ? '—' : IND[k].f(v)}</div><div class="s">mois préc. ${p == null ? '—' : IND[k].f(p)}</div></div>`; }).join('')}</div>` +
    `<h2>Démarque par rayon</h2>${rayons().map(r => { const a = agg(r.id, 'dem', pws), b = agg(r.id, 'dem', ws), mx = Math.max(a || 0, b || 0, 0.1); return `<div style="display:grid;grid-template-columns:100px 1fr 90px;gap:8px;align-items:center;margin-bottom:6px"><span>${tag(r.id)}${esc(r.court)}</span><div><div class="bar" style="margin-bottom:2px"><i style="width:${(a || 0) / mx * 100}%;background:#B5D4F4"></i></div><div class="bar"><i style="width:${(b || 0) / mx * 100}%"></i></div></div><span class="r small ${a != null && b != null ? (b <= a ? 'ok' : 'bad') : ''}">${a == null ? '—' : nf(a, 2)} → ${b == null ? '—' : nf(b, 2)}</span></div>`; }).join('')}<div class="small muted">clair : mois précédent · foncé : ce mois</div>` +
    `<h2>Plan et actions</h2><div class="card">Plan général : ${dn} étapes sur ${plan.length} (${plan.length ? Math.round(dn / plan.length * 100) : 0} %) · ${doneM} action(s) terminée(s) ce mois · ${db.all('actions').filter(a => !['fait', 'abandon'].includes(a.statut) && a.echeance && a.echeance < today()).length} en retard</div>` +
    `<h2>Plans par rayon</h2>${rayons().map(r => { const v = planPct(r.id); return `<div style="display:grid;grid-template-columns:100px 1fr 40px;gap:8px;align-items:center;margin-bottom:6px"><span>${tag(r.id)}${esc(r.court)}</span><div class="bar"><i style="width:${v || 0}%"></i></div><span class="r small">${v == null ? '—' : v + ' %'}</span></div>`; }).join('')}` +
    `<h2>À retenir</h2><textarea placeholder="Ta synthèse du mois" oninput="document.getElementById('mret').textContent=this.value" class="noprint"></textarea><div id="mret" class="card mt" style="white-space:pre-wrap;min-height:40px"></div>` + printBtn;
};
V['r-pilote'] = id => { const a = db.get('actions', id); if (!a || !a.pilote) return hdr('Bilan du pilote', '', 1) + empty('Choisis un pilote dans Actions.'); const av = pilotVal(a, a.refDu, a.refAu), ap = pilotVal(a, a.testDu, a.testAu <= today() ? a.testAu : today()); const down = ['dem', 'rupt'].includes(a.ind), dl = av != null && ap != null ? ap - av : null, good = dl == null ? '' : (down ? dl < 0 : dl > 0) ? 'ok' : 'bad'; const mx = Math.max(av || 0, ap || 0, 0.01); let gain = null; if (a.ind === 'dem' && dl != null && a.rayon) { const k = [1, 2, 3, 4].map(i => kpiW(addDays(wk(today()), -7 * i), a.rayon).ca).filter(Boolean); if (k.length) gain = -dl / 100 * (k.reduce((x, y) => x + y) / k.length) * 52; }
  return hdr('Bilan du pilote', `${a.rayon ? esc(R(a.rayon).nom) + ' · ' : ''}${esc(a.titre)}`, 1) + `<div class="small muted">Référence ${fDate(a.refDu, { day: 'numeric', month: 'short' })} – ${fDate(a.refAu, { day: 'numeric', month: 'short' })} · test ${fDate(a.testDu, { day: 'numeric', month: 'short' })} – ${fDate(a.testAu, { day: 'numeric', month: 'short' })}</div><div class="card mt"><div style="display:flex;justify-content:space-between"><span>${PIND[a.ind]}${a.ind === 'rupt' ? ' / semaine' : ''}</span><b class="${good}" style="font-weight:600">${dl == null ? '—' : (dl > 0 ? '+' : '') + nf(dl, 2)}</b></div><div style="display:grid;grid-template-columns:50px 1fr 50px;gap:6px;align-items:center;font-size:13px;margin-top:8px"><span class="muted">Avant</span><div class="bar"><i style="width:${(av || 0) / mx * 100}%;background:var(--faint)"></i></div><span class="r">${av == null ? '—' : nf(av, 2)}</span><span class="muted">Après</span><div class="bar"><i style="width:${(ap || 0) / mx * 100}%"></i></div><span class="r">${ap == null ? '—' : nf(ap, 2)}</span></div></div>${gain && gain > 0 ? `<div class="alert a-ok mt"><div class="small">Gain estimé sur un an si maintenu</div><div style="font:600 24px 'Barlow Semi Condensed'">≈ ${eur(gain)}</div></div>` : ''}<h2>Constat de départ</h2><div class="card">${esc(a.constat || '—')}</div><h2>Résultat et recommandation</h2><div class="card">${esc(a.resultat || '—')}${a.decision ? `<div class="small muted mt">Décision : ${esc(a.decision)}</div>` : ''}</div>` + printBtn; };
V['r-restit'] = () => {
  const d1 = S.rsD || addDays(today(), -90), d2 = today();
  const obs = db.all('obs').filter(o => o.date >= d1), it = obs.flatMap(o => o.items), okp = it.length ? it.filter(i => i.s === 'ok').length / it.length * 100 : null;
  const ru = db.all('ruptures').filter(r => r.date >= d1), wks = Math.max(1, (new Date(d2) - new Date(d1)) / 6048e5), pm = ru.length ? ru.filter(r => new Date(r.ts).getHours() >= 14).length / ru.length * 100 : null;
  const causes = {}; ru.forEach(r => causes[r.cause || 'Non renseignée'] = (causes[r.cause || 'Non renseignée'] || 0) + 1); const c1 = Object.entries(causes).sort((a, b) => b[1] - a[1])[0];
  S.rst = S.rst || { c: ['', '', '', '', ''], a: ['', '', ''], dec: '' };
  return hdr('Restitution', `du ${fDate(d1, { day: 'numeric', month: 'long' })} au ${fDate(d2, { day: 'numeric', month: 'long' })}`, 1) + `<div class="noprint field"><span>Début de la période</span><input type="date" value="${d1}" onchange="S.rsD=this.value;render()" ${tiS}></div>` +
    `<h2>Le point de départ</h2><div class="grid2"><div class="kpi"><div class="l">Observations OK</div><div class="v">${okp == null ? '—' : nf(okp, 0) + ' %'}</div><div class="s">sur ${obs.length} passages</div></div><div class="kpi"><div class="l">Ruptures / semaine</div><div class="v">${nf(ru.length / wks, 0)}</div><div class="s">${pm == null ? '' : nf(pm, 0) + ' % l\'après-midi'}</div></div><div class="kpi"><div class="l">Cause n° 1</div><div class="v" style="font-size:20px">${c1 ? esc(c1[0]) : '—'}</div><div class="s">${c1 ? nf(c1[1] / ru.length * 100, 0) + ' % des ruptures' : ''}</div></div><div class="kpi"><div class="l">Problèmes ouverts</div><div class="v">${db.all('suivis').filter(s => !s.closeTs).length}</div></div></div>` +
    `<h2>Cinq constats</h2>${S.rst.c.map((c, i) => `<input type="text" class="noprint" style="margin-bottom:6px" placeholder="Constat ${i + 1}" value="${esc(c)}" oninput="S.rst.c[${i}]=this.value;document.getElementById('rc${i}').textContent=this.value">`).join('')}<div class="list">${S.rst.c.map((c, i) => `<div class="row"><b class="acc" style="font-weight:600">${i + 1}</b><span class="grow" id="rc${i}">${esc(c)}</span></div>`).join('')}</div>` +
    `<h2>Trois actions proposées</h2>${S.rst.a.map((c, i) => `<input type="text" class="noprint" style="margin-bottom:6px" placeholder="Action ${i + 1} et son objectif" value="${esc(c)}" oninput="S.rst.a[${i}]=this.value;document.getElementById('ra${i}').textContent=this.value">`).join('')}<div class="list">${S.rst.a.map((c, i) => `<div class="row"><span class="grow" id="ra${i}">${esc(c)}</span></div>`).join('')}</div>` +
    `<h2>Décision demandée</h2><input type="text" class="noprint" value="${esc(S.rst.dec)}" oninput="S.rst.dec=this.value;document.getElementById('rsd').textContent=this.value"><div class="alert a-warn mt" id="rsd">${esc(S.rst.dec) || 'valider ces trois actions'}</div>` + printBtn;
};
V['r-fetes'] = () => {
  const l = fetesL(), y = +today().slice(0, 4) - (+today().slice(5, 7) < 7 ? 1 : 0);
  const dem = db.all('lots').filter(x => x.date >= `${y}-12-26` && x.date <= `${y}-12-31`), q = dem.reduce((t, x) => t + (+x.qte || 0), 0), v = dem.reduce((t, x) => t + (+x.vendu || 0), 0);
  const rt = ['24', '31'].map(dd => db.get('retraits', `${y}-12-${dd}`)).filter(Boolean), nr = rt.reduce((t, r) => t + r.creneaux.reduce((u, c) => u + (+c.n || 0), 0), 0);
  const car = db.all('carnet').filter(c => c.date >= `${y}-11-01` && c.date <= `${y + 1}-01-31`);
  return hdr('Bilan des fêtes ' + y, '', 1) + (l.length ? `<h2>Réservé / commandé</h2>${l.map(f => { const c = lastCum(f), ref = f.capacite || f.commande || c || 1, st = f.commande && c > f.commande ? ['bad', 'manque'] : f.commande && c < f.commande * 0.7 ? ['warn', 'surplus'] : ['ok', '']; return `<div style="display:grid;grid-template-columns:110px 1fr 110px;gap:8px;align-items:center;margin-bottom:8px"><span>${esc(f.nom)}</span><div class="bar"><i style="width:${Math.min(100, c / ref * 100)}%;background:var(--${st[0]})"></i></div><span class="r small ${st[0]}">${c}/${f.commande || f.capacite || '—'}${st[1] ? ' · ' + st[1] : ''}</span></div>`; }).join('')}` : empty('Aucun produit festif suivi.')) +
    `<div class="grid2 mt"><div class="kpi"><div class="l">Lots du 26 au 31 déc.</div><div class="v">${q ? nf(v / q * 100, 0) + ' %' : '—'}</div><div class="s">récupérés</div></div><div class="kpi"><div class="l">Retraits 24 et 31</div><div class="v">${nr || '—'}</div></div></div><h2>Pour l'an prochain</h2>${car.filter(c => c.idee).length ? `<div class="list">${car.filter(c => c.idee).map(c => `<div class="row"><span class="grow">${c.rayon ? esc(R(c.rayon).court) + ' · ' : ''}${esc(c.idee)}</span></div>`).join('')}</div>` : '<div class="small muted">Aucune idée notée dans le carnet.</div>'}` + printBtn;
};

// ---------- Alertes V3 / V4 ----------
function alertsV34() {
  const out = [], t = today();
  db.all('entretiens').forEach(e => (e.eng || []).forEach(g => { if (!g.fait && g.retour && g.retour < t) { const p = P(e.pid); out.push(['warn', `Retour promis${p ? ' à ' + esc(p.prenom) : ''} : ${esc(g.t)}`, '#/entretien/' + e.pid]); } }));
  chefs().forEach(p => { const e = db.all('entretiens').filter(x => x.pid === p.id).sort((a, b) => b.date.localeCompare(a.date))[0]; if (e && e.prochain && e.prochain <= t) out.push(['acc', `Entretien prévu avec ${esc(p.prenom)}`, '#/entretien-new/' + p.id]); });
  rayons().forEach(r => { const T = taches(r.id), l = people().filter(p => p.rayon === r.id && p.type !== 'interim'); if (l.length >= 2) T.forEach(x => { if (l.filter(p => ((p.niv || {})[x] || 0) >= 2).length === 1 && Object.keys(l[0].niv || {}).length) out.push(['warn', `${esc(r.court)} · ${esc(x)} : une seule personne autonome`, '#/poly']); }); });
  const nw = addDays(wk(t), 7), seuil = cget('seuilEcart', 10);
  rayons().filter(r => hasTeam(r.id)).forEach(r => { const x = forecast(nw, r.id); if (x && x.need && Math.abs(x.gap) / x.need * 100 > seuil) out.push([x.gap < 0 ? 'bad' : 'acc', `${esc(r.court)} semaine prochaine : ${x.gap < 0 ? 'il manque' : 'en trop'} environ ${nf(Math.abs(x.gap), 0)} h`, '#/previsions']); });
  rayons().filter(r => hasTeam(r.id)).forEach(r => { const n = needByHour(r.id, t), p = presByHour(r.id, t); if (!n) return; const holes = Object.keys(n).filter(h => n[h] - p[h] > 0.6 && n[h] > 1); if (holes.length >= 2) out.push(['warn', `${esc(r.court)} aujourd'hui : pic mal couvert ${holes[0]} h – ${+holes[holes.length - 1] + 1} h`, '#/couverture']); });
  guardAlerts().forEach(x => out.push(['warn', esc(x), '#/previsions']));
  prodAlerts().forEach(x => out.push(['warn', esc(x), '#/tendances']));
  return out;
}

// ---------- Navigation ----------
const ic = { home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>', plus: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>', histo: '<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="8"/>', plan: '<path d="M5 5h14M5 12h14M5 19h9"/><circle cx="19" cy="19" r="1.5"/>', more: '<path d="M4 7h16M4 12h16M4 17h16"/>', chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', team: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M15 20c0-2.5 1-4.5 3-4.5s3 1.7 3 4.5"/>' };
const tabs = [['', 'Journée', 'home'], ['saisir', 'Saisir', 'plus'], ['equipes', 'Équipes', 'team'], ['pilotage', 'Pilotage', 'chart'], ['plus', 'Plus', 'more']];
const tabOf = { histo: 'plus', tdb: 'pilotage', tendances: 'pilotage', previsions: 'pilotage', couverture: 'pilotage', simulateur: 'pilotage', demarque: 'saisir', action: 'pilotage', plans: 'pilotage', 'plan-rayon': 'pilotage', rapports: 'pilotage', chiffres: 'pilotage', 'r-mardi': 'pilotage', 'r-mensuel': 'pilotage', 'r-pilote': 'pilotage', 'r-restit': 'pilotage', 'r-fetes': 'pilotage', 'r-objectifs': 'pilotage', poly: 'equipes', entretiens: 'equipes', entretien: 'equipes', 'entretien-new': 'equipes', 'r-taches': 'equipes', tournee: 'saisir', ruptures: 'saisir', bilan: 'saisir', suivis: 'plus', obs: 'plus', 'obs-detail': 'plus', evolution: 'plus', galerie: 'plus', 'ruptures-stats': 'plus', journal: 'plus', actions: 'pilotage', raccourcis: 'plus', reglages: 'plus', plan: 'plus', fetes: 'saisir', retrait: 'saisir', carnet: 'saisir', presents: 'equipes', planning: 'equipes', interim: 'equipes', personnes: 'equipes', personne: 'equipes' };
let dirty = false;
function render() {
  const [route, param] = (location.hash.replace(/^#\/?/, '') || '').split('/');
  const f = V[route] || V[''];
  const tab = tabOf[route] ?? (route.startsWith('r-') ? 'plus' : route);
  $('#app').innerHTML = f(param ? decodeURIComponent(param) : undefined);
  $('#nav').innerHTML = tabs.map(([u, l, i]) => `<a href="#/${u}" class="${u === (V[tab] ? tab : '') ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${ic[i]}</svg>${l}</a>`).join('');
  lazyPhotos();
}
window.render = render; window.S = S; window.$ = $;
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
    purgeInterim();
    cfg(); planL();
    askPin();
    render();
  } catch (e) {
    console.error(e);
    $('#app').innerHTML = `<div class="card mt"><b style="font-weight:600">L'appli n'a pas pu démarrer.</b><div class="small muted">${esc(e.message)}</div><div class="small muted mt">Vérifie la connexion internet au premier lancement, puis recharge la page.</div></div>`;
  }
})();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
