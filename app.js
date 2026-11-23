'use strict';
/* Guardaclaves — gestor de contraseñas local, cifrado AES-256-GCM.
   Las contraseñas nunca salen del dispositivo sin cifrar. */
(() => {
  const VERSION = '1.0.0';
  const ITERS = 600000;                       // PBKDF2-SHA256
  const DRIVE_NAME = 'Guardaclaves-respaldo.json';
  const te = new TextEncoder(), td = new TextDecoder();
  const AAD_DEK = te.encode('guardaclaves/dek/v1');
  const AAD_VAULT = te.encode('guardaclaves/vault/v1');
  const DEFAULTS = { autoLock: 5, clipSec: 30, wipeOnFail: false, googleClientId: '',
    gen: { len: 20, upper: true, lower: true, digits: true, symbols: true, ambig: false } };

  const $ = (s, r = document) => r.querySelector(s);
  const rand = n => crypto.getRandomValues(new Uint8Array(n));
  const toB64 = buf => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = str => { const s = atob(str); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => toB64(rand(12)).replace(/[+/=]/g, '');
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ---------- Almacenamiento (IndexedDB) ---------- */
  const DB = {
    _db: null,
    open() {
      if (this._db) return Promise.resolve(this._db);
      return new Promise((res, rej) => {
        const r = indexedDB.open('guardaclaves', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => { this._db = r.result; res(this._db); };
        r.onerror = () => rej(r.error);
      });
    },
    async run(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const t = db.transaction('kv', mode); let out;
        const req = fn(t.objectStore('kv'));
        if (req) req.onsuccess = () => { out = req.result; };
        t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
      });
    },
    get(k) { return this.run('readonly', s => s.get(k)); },
    set(k, v) { return this.run('readwrite', s => s.put(v, k)); },
    setMany(o) { return this.run('readwrite', s => { for (const k in o) s.put(o[k], k); }); },
    clear() { return this.run('readwrite', s => s.clear()); },
  };

  /* ---------- Criptografía ---------- */
  async function pwKey(pw, salt, iters) {
    const base = await crypto.subtle.importKey('raw', te.encode(pw.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iters, hash: 'SHA-256' }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function prfKey(prfOut) {
    const base = await crypto.subtle.importKey('raw', prfOut, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('guardaclaves/bio'), info: te.encode('kek/v1') },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  const dekKey = raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  async function seal(key, data, aad) {
    const iv = rand(12);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, data);
    return { iv: toB64(iv), ct: toB64(ct) };
  }
  async function unseal(key, box, aad) {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv), additionalData: aad }, key, fromB64(box.ct)));
  }

  /* ---------- Estado ---------- */
  let settings = { ...DEFAULTS };
  let meta = null;        // {v, salt, iters, wrappedPw, bio, fails, lockUntil, dirty, lastBackup}
  let S = blankState();
  function blankState() { return { dekRaw: null, dek: null, vault: null, current: null, editing: null, genTarget: false, holdLock: 0 }; }
  const unlocked = () => !!S.dek;

  async function saveSettings() { await DB.set('settings', settings); }
  async function saveMeta() { await DB.set('meta', meta); }
  async function saveVault() {
    const box = await seal(S.dek, te.encode(JSON.stringify(S.vault)), AAD_VAULT);
    meta.dirty = true;
    await DB.setMany({ vault: box, meta });
    updateBanner();
  }

  /* ---------- Interfaz básica ---------- */
  const views = ['setup', 'lock', 'list', 'detail', 'edit', 'gen', 'settings'];
  let history = [];
  function show(name, push = true) {
    const cur = views.find(v => !$('#view-' + v).hidden);
    if (push && cur && cur !== name && ['list', 'detail', 'edit', 'gen', 'settings'].includes(cur)) history.push(cur);
    views.forEach(v => { $('#view-' + v).hidden = v !== name; });
    window.scrollTo(0, 0);
  }
  function back() {
    let prev = history.pop() || 'list';
    if (prev === 'detail' && !S.vault.entries.find(e => e.id === S.current)) prev = 'list';
    if (prev === 'list') renderList();
    if (prev === 'detail') renderDetail();
    show(prev, false);
  }
  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  /* Modal genérico: devuelve {button, values} */
  function modal({ title, text = '', fields = [], buttons = [{ label: 'Cancelar', value: null }, { label: 'Aceptar', value: 'ok', primary: true }] }) {
    return new Promise(resolve => {
      const m = $('#modal'), box = m.firstElementChild;
      box.innerHTML = `<h4>${esc(title)}</h4>${text ? `<p>${esc(text)}</p>` : ''}
        <form class="stack" autocomplete="off">${fields.map((f, i) => `<label>${esc(f.label)}<input name="f${i}" type="${f.type || 'text'}" autocomplete="${f.autocomplete || 'off'}" ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} spellcheck="false" autocapitalize="off"></label>`).join('')}
        <div class="modal-actions">${buttons.map((b, i) => `<button type="${b.primary ? 'submit' : 'button'}" data-i="${i}" class="btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}">${esc(b.label)}</button>`).join('')}</div></form>`;
      const form = box.querySelector('form');
      const done = (b) => {
        const values = fields.map((_, i) => form.elements['f' + i].value);
        fields.forEach((_, i) => { form.elements['f' + i].value = ''; });
        m.hidden = true; box.innerHTML = ''; resolve({ button: b ? b.value : null, values });
      };
      box.querySelectorAll('button[type=button]').forEach(btn => btn.onclick = () => done(buttons[+btn.dataset.i]));
      form.onsubmit = ev => { ev.preventDefault(); done(buttons.find(b => b.primary)); };
      m.hidden = false;
      const first = form.querySelector('input'); if (first) setTimeout(() => first.focus(), 50);
    });
  }
  const confirmBox = async (title, text, okLabel = 'Aceptar', danger = false) =>
    (await modal({ title, text, buttons: [{ label: 'Cancelar', value: null }, { label: okLabel, value: 'ok', primary: true, danger }] })).button === 'ok';
  const askPassword = async (title, text) => {
    const r = await modal({ title, text, fields: [{ label: 'Contraseña maestra', type: 'password', autocomplete: 'current-password' }] });
    return r.button === 'ok' ? r.values[0] : null;
  };

  /* ---------- Fuerza de contraseña ---------- */
  function strength(pw) {
    if (!pw) return { bits: 0, label: '' };
    let pool = 0;
    if (/[a-z]/.test(pw)) pool += 26; if (/[A-Z]/.test(pw)) pool += 26;
    if (/[0-9]/.test(pw)) pool += 10; if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
    let bits = pw.length * Math.log2(pool || 1);
    if (/^(.)\1+$/.test(pw)) bits = 4;
    const label = bits < 45 ? 'Débil' : bits < 65 ? 'Aceptable' : bits < 90 ? 'Fuerte' : 'Muy fuerte';
    return { bits, label };
  }
  function paintMeter(el, pw, labelEl) {
    const { bits, label } = strength(pw);
    el.style.width = Math.min(100, bits / 1.1) + '%';
    el.style.background = bits < 45 ? '#d64545' : bits < 65 ? '#e0a800' : '#2e9d57';
    if (labelEl) labelEl.textContent = pw ? `Fuerza: ${label}` : ' ';
  }

  /* ---------- Generador ---------- */
  const SETS = { upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', lower: 'abcdefghijklmnopqrstuvwxyz', digits: '0123456789', symbols: '!@#$%^&*()-_=+[]{};:,.?/~' };
  function randInt(n) {
    const lim = Math.floor(0x100000000 / n) * n, a = new Uint32Array(1);
    do crypto.getRandomValues(a); while (a[0] >= lim);
    return a[0] % n;
  }
  function generate(o = settings.gen) {
    const groups = Object.keys(SETS).filter(k => o[k]).map(k => o.ambig ? SETS[k].replace(/[Il1O0o|]/g, '') : SETS[k]);
    if (!groups.length) return '';
    const all = groups.join(''), out = groups.map(g => g[randInt(g.length)]);
    while (out.length < o.len) out.push(all[randInt(all.length)]);
    for (let i = out.length - 1; i > 0; i--) { const j = randInt(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
    return out.slice(0, o.len).join('');
  }

  /* ---------- Portapapeles ---------- */
  let clipTimer;
  async function copy(text, what = 'Copiado') {
    try {
      await navigator.clipboard.writeText(text);
      clearTimeout(clipTimer);
      if (settings.clipSec > 0) {
        clipTimer = setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), settings.clipSec * 1000);
        toast(`${what}. Se borrará en ${settings.clipSec} s`);
      } else toast(what);
    } catch { toast('No se pudo copiar'); }
  }

  /* ---------- Crear / desbloquear / bloquear ---------- */
  async function createVault(pw) {
    const salt = rand(16), kek = await pwKey(pw, salt, ITERS), dekRaw = rand(32);
    meta = { v: 1, salt: toB64(salt), iters: ITERS, wrappedPw: await seal(kek, dekRaw, AAD_DEK), bio: null,
      fails: 0, lockUntil: 0, dirty: false, lastBackup: null };
    S.dekRaw = dekRaw; S.dek = await dekKey(dekRaw); S.vault = { entries: [] };
    await saveVault(); meta.dirty = false; await saveMeta();
    navigator.storage?.persist?.().catch(() => {});
    enterApp();
  }
  async function finishUnlock(raw) {
    const dek = await dekKey(raw);
    const box = await DB.get('vault');
    const vault = JSON.parse(td.decode(await unseal(dek, box, AAD_VAULT)));
    S.dekRaw = raw; S.dek = dek; S.vault = vault;
    meta.fails = 0; meta.lockUntil = 0; await saveMeta();
    enterApp();
  }
  async function unlockPassword(pw) {
    if (Date.now() < (meta.lockUntil || 0)) throw new Error(`Espera ${Math.ceil((meta.lockUntil - Date.now()) / 1000)} s antes de volver a intentar.`);
    let raw;
    try { raw = await unseal(await pwKey(pw, fromB64(meta.salt), meta.iters), meta.wrappedPw, AAD_DEK); }
    catch { return registerFail(); }
    await finishUnlock(raw);
  }
  async function registerFail() {
    meta.fails = (meta.fails || 0) + 1;
    if (settings.wipeOnFail && meta.fails >= 10) {
      await DB.clear(); await saveSettings(); meta = null; S = blankState();
      show('setup', false);
      throw new Error('Se alcanzaron 10 intentos fallidos. Se borraron los datos de este dispositivo.');
    }
    if (meta.fails >= 5) meta.lockUntil = Date.now() + Math.min(300, 15 * 2 ** (meta.fails - 5)) * 1000;
    await saveMeta();
    const left = settings.wipeOnFail ? ` Quedan ${10 - meta.fails} intentos antes de borrar todo.` : '';
    throw new Error(`Contraseña incorrecta (${meta.fails} ${meta.fails === 1 ? 'intento fallido' : 'intentos fallidos'}).${left}`);
  }
  function lock() {
    if (S.dekRaw) S.dekRaw.fill(0);
    S = blankState(); history = [];
    $('#list').innerHTML = ''; $('#detail-body').innerHTML = ''; $('#form-edit').reset(); $('#search').value = '';
    $('#gen-out').textContent = ''; $('#modal').hidden = true; $('#toast').classList.remove('show');
    showLock();
  }
  function showLock() {
    $('#lock-pw').value = ''; $('#lock-msg').textContent = '';
    $('#lock-bio').hidden = !meta?.bio;
    show('lock', false);
    if (!meta?.bio) setTimeout(() => $('#lock-pw').focus(), 50);
  }
  function enterApp() { history = []; renderList(); show('list', false); bump(); }

  /* ---------- Bloqueo automático ---------- */
  let lastActive = Date.now(), hiddenAt = 0;
  const bump = () => { lastActive = Date.now(); };
  ['pointerdown', 'keydown', 'touchstart', 'scroll', 'input'].forEach(ev => document.addEventListener(ev, bump, { passive: true, capture: true }));
  setInterval(() => {
    if (unlocked() && !S.holdLock && settings.autoLock > 0 && Date.now() - lastActive > settings.autoLock * 60000) lock();
  }, 5000);
  document.addEventListener('visibilitychange', () => {
    if (!unlocked() || S.holdLock) return;
    if (document.hidden) { hiddenAt = Date.now(); if (settings.autoLock === 0) lock(); }
    else if (hiddenAt && settings.autoLock > 0 && Date.now() - hiddenAt > settings.autoLock * 60000) lock();
  });
  async function holding(fn) { S.holdLock++; try { return await fn(); } finally { if (S.holdLock) S.holdLock--; bump(); } }

  /* ---------- Huella (WebAuthn + PRF) ---------- */
  async function bioAvailable() {
    try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); }
    catch { return false; }
  }
  async function prfGet(credId, salt) {
    const a = await navigator.credentials.get({ publicKey: {
      challenge: rand(32), allowCredentials: [{ type: 'public-key', id: credId }],
      userVerification: 'required', timeout: 60000, extensions: { prf: { eval: { first: salt } } } } });
    const r = a.getClientExtensionResults();
    if (!r.prf?.results?.first) throw new Error('Este teléfono o navegador no permite usar la huella para cifrar (falta soporte "PRF"). Actualiza el sistema y el navegador, o usa la contraseña maestra.');
    return r.prf.results.first;
  }
  async function enableBio() {
    if (!window.isSecureContext) throw new Error('La huella solo funciona si la app se abre desde una dirección https.');
    if (!await bioAvailable()) throw new Error('Este dispositivo no tiene huella o desbloqueo biométrico disponible para el navegador.');
    const prfSalt = rand(32);
    const cred = await navigator.credentials.create({ publicKey: {
      rp: { name: 'Guardaclaves' },
      user: { id: rand(16), name: 'Guardaclaves', displayName: 'Guardaclaves' },
      challenge: rand(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000, extensions: { prf: { eval: { first: prfSalt } } } } });
    const ext = cred.getClientExtensionResults();
    if (ext.prf && ext.prf.enabled === false) throw new Error('Este teléfono o navegador no permite usar la huella para cifrar (falta soporte "PRF"). Actualiza el sistema y el navegador.');
    let out = ext.prf?.results?.first;
    if (!out) { toast('Confirma otra vez con tu huella'); out = await prfGet(cred.rawId, prfSalt); }
    const kek = await prfKey(out);
    meta.bio = { credId: toB64(cred.rawId), prfSalt: toB64(prfSalt), wrapped: await seal(kek, S.dekRaw, AAD_DEK) };
    await saveMeta();
  }
  async function unlockBio() {
    const out = await prfGet(fromB64(meta.bio.credId), fromB64(meta.bio.prfSalt));
    let raw;
    try { raw = await unseal(await prfKey(out), meta.bio.wrapped, AAD_DEK); }
    catch { throw new Error('La huella no coincide con la registrada. Entra con la contraseña maestra y vuelve a activar la huella.'); }
    await finishUnlock(raw);
  }
  function bioErr(e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'AbortError')) return 'Se canceló la verificación.';
    return e?.message || 'No se pudo usar la huella.';
  }

  /* ---------- Lista ---------- */
  function colorFor(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 'c' + (h % 8); }
  function renderList() {
    const q = $('#search').value.trim().toLowerCase();
    const items = S.vault.entries
      .filter(e => !q || [e.title, e.username, e.url, e.notes].some(f => (f || '').toLowerCase().includes(q)))
      .sort((a, b) => (b.fav - a.fav) || a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }));
    $('#list').innerHTML = items.map(e => `<li data-id="${esc(e.id)}">
      <span class="avatar ${colorFor(e.title)}">${esc((e.title.trim()[0] || '?').toUpperCase())}</span>
      <span class="li-text"><div class="li-title">${e.fav ? '<span class="star">★</span> ' : ''}${esc(e.title)}</div>
      <div class="li-sub">${esc(e.username || e.url || '')}</div></span></li>`).join('');
    $('#empty').hidden = S.vault.entries.length > 0;
    updateBanner();
  }
  function updateBanner() {
    $('#backup-banner').hidden = !(meta?.dirty && S.vault?.entries.length);
  }

  /* ---------- Detalle ---------- */
  function normUrl(u) { u = (u || '').trim(); if (!u) return ''; return /^https?:\/\//i.test(u) ? u : 'https://' + u; }
  function renderDetail() {
    const e = S.vault.entries.find(x => x.id === S.current); if (!e) return;
    $('#detail-title').textContent = e.title;
    const copyBtn = k => `<button class="icon small" data-copy="${k}" aria-label="Copiar"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>`;
    const parts = [];
    if (e.username) parts.push(`<div class="field"><div class="f-text"><div class="f-label">Usuario</div><div class="f-value">${esc(e.username)}</div></div>${copyBtn('username')}</div>`);
    if (e.password) parts.push(`<div class="field"><div class="f-text"><div class="f-label">Contraseña</div><div class="f-value mono" id="d-pw">••••••••••</div></div>
      <button class="icon small" id="d-pw-toggle" aria-label="Mostrar"><svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>${copyBtn('password')}</div>`);
    if (e.url) { const u = normUrl(e.url); parts.push(`<div class="field"><div class="f-text"><div class="f-label">Sitio web</div><div class="f-value"><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(e.url)}</a></div></div>${copyBtn('url')}</div>`); }
    if (e.notes) parts.push(`<div class="field"><div class="f-text"><div class="f-label">Notas</div><div class="f-value">${esc(e.notes)}</div></div>${copyBtn('notes')}</div>`);
    parts.push(`<p class="muted small">Modificada: ${new Date(e.updatedAt).toLocaleString('es-DO')}</p>`);
    $('#detail-body').innerHTML = parts.join('');
    const t = $('#d-pw-toggle');
    if (t) t.onclick = () => { const v = $('#d-pw'); const hidden = v.textContent.startsWith('•'); v.textContent = hidden ? e.password : '••••••••••'; };
    $('#detail-body').querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
      const k = b.dataset.copy; copy(e[k], { username: 'Usuario copiado', password: 'Contraseña copiada', url: 'Enlace copiado', notes: 'Notas copiadas' }[k]);
    });
  }

  /* ---------- Edición ---------- */
  function openEdit(id) {
    const e = id ? S.vault.entries.find(x => x.id === id) : null;
    S.editing = e ? e.id : null;
    $('#edit-heading').textContent = e ? 'Editar' : 'Nueva';
    $('#e-title').value = e?.title || ''; $('#e-user').value = e?.username || '';
    $('#e-pw').value = e?.password || ''; $('#e-pw').type = 'password';
    $('#e-url').value = e?.url || ''; $('#e-notes').value = e?.notes || ''; $('#e-fav').checked = !!e?.fav;
    $('#e-delete').hidden = !e;
    paintMeter($('#e-meter'), $('#e-pw').value);
    show('edit');
    if (!e) setTimeout(() => $('#e-title').focus(), 50);
  }
  async function saveEdit() {
    const now = Date.now();
    const data = { title: $('#e-title').value.trim(), username: $('#e-user').value.trim(), password: $('#e-pw').value,
      url: $('#e-url').value.trim(), notes: $('#e-notes').value, fav: $('#e-fav').checked, updatedAt: now };
    if (!data.title) { toast('Ponle un título'); return; }
    if (S.editing) Object.assign(S.vault.entries.find(x => x.id === S.editing), data);
    else { const e = { id: uid(), createdAt: now, ...data }; S.vault.entries.push(e); S.editing = e.id; }
    await saveVault();
    S.current = S.editing;
    history = ['list']; renderDetail(); show('detail', false);
    toast('Guardado');
  }

  /* ---------- Generador (vista) ---------- */
  function readGen() {
    settings.gen = { len: +$('#gen-len').value, upper: $('#gen-upper').checked, lower: $('#gen-lower').checked,
      digits: $('#gen-digits').checked, symbols: $('#gen-symbols').checked, ambig: $('#gen-ambig').checked };
    $('#gen-len-label').textContent = settings.gen.len;
    saveSettings();
  }
  function fillGen() {
    const g = settings.gen;
    $('#gen-len').value = g.len; $('#gen-len-label').textContent = g.len;
    $('#gen-upper').checked = g.upper; $('#gen-lower').checked = g.lower; $('#gen-digits').checked = g.digits;
    $('#gen-symbols').checked = g.symbols; $('#gen-ambig').checked = g.ambig;
  }
  function regen() { const p = generate(); $('#gen-out').textContent = p || 'Elige al menos un tipo de carácter'; paintMeter($('#gen-meter'), p); }
  function openGen(fromEdit) { S.genTarget = fromEdit; $('#gen-use').hidden = !fromEdit; fillGen(); regen(); show('gen'); }

  /* ---------- Respaldo ---------- */
  async function buildBackup() {
    const vault = await DB.get('vault');
    return JSON.stringify({ app: 'guardaclaves', format: 1, created: new Date().toISOString(),
      salt: meta.salt, iters: meta.iters, wrappedPw: meta.wrappedPw, vault });
  }
  async function markBackedUp(where) { meta.dirty = false; meta.lastBackup = { at: Date.now(), where }; await saveMeta(); updateBanner(); renderBackupStatus(); }
  function parseBackup(text) {
    let b; try { b = JSON.parse(text); } catch { throw new Error('El archivo no es un respaldo de Guardaclaves.'); }
    if (!b || b.app !== 'guardaclaves' || b.format !== 1 || !b.salt || !b.wrappedPw?.ct || !b.vault?.ct) throw new Error('El archivo no es un respaldo de Guardaclaves.');
    if (!(b.iters >= 100000 && b.iters <= 5000000)) throw new Error('Respaldo dañado.');
    return b;
  }
  async function decryptBackup(b, pw) {
    let raw;
    try { raw = await unseal(await pwKey(pw, fromB64(b.salt), b.iters), b.wrappedPw, AAD_DEK); }
    catch { throw new Error('Contraseña incorrecta para este respaldo.'); }
    const vault = JSON.parse(td.decode(await unseal(await dekKey(raw), b.vault, AAD_VAULT)));
    return { raw, vault };
  }
  // Restaurar cuando aún no hay bóveda en el dispositivo
  async function restoreFresh(text) {
    const b = parseBackup(text);
    const pw = await askPassword('Restaurar respaldo', 'Escribe la contraseña maestra que tenías cuando se hizo este respaldo.');
    if (pw == null) return;
    const { raw, vault } = await decryptBackup(b, pw);
    meta = { v: 1, salt: b.salt, iters: b.iters, wrappedPw: b.wrappedPw, bio: null, fails: 0, lockUntil: 0, dirty: false,
      lastBackup: { at: Date.parse(b.created) || Date.now(), where: 'restaurado' } };
    await DB.setMany({ meta, vault: b.vault });
    navigator.storage?.persist?.().catch(() => {});
    await finishUnlock(raw);
    toast(`Restauradas ${vault.entries.length} contraseñas`);
  }
  // Importar estando desbloqueado
  async function restoreInto(text) {
    const b = parseBackup(text);
    const pw = await askPassword('Importar respaldo', 'Escribe la contraseña maestra con la que se hizo este respaldo.');
    if (pw == null) return;
    const { raw, vault } = await decryptBackup(b, pw); raw.fill(0);
    const n = vault.entries.length;
    const r = await modal({ title: 'Importar respaldo', text: `El respaldo tiene ${n} contraseñas (del ${new Date(b.created).toLocaleString('es-DO')}).\n\n«Combinar» conserva lo que ya tienes y añade lo del respaldo. «Reemplazar» deja solo lo del respaldo.`,
      buttons: [{ label: 'Cancelar', value: null }, { label: 'Reemplazar', value: 'replace', danger: true }, { label: 'Combinar', value: 'merge', primary: true }] });
    if (!r.button) return;
    if (r.button === 'replace') S.vault.entries = vault.entries;
    else {
      const map = new Map(S.vault.entries.map(e => [e.id, e]));
      for (const e of vault.entries) { const cur = map.get(e.id); if (!cur || (e.updatedAt || 0) > (cur.updatedAt || 0)) map.set(e.id, e); }
      S.vault.entries = [...map.values()];
    }
    await saveVault(); renderList();
    toast('Respaldo importado');
  }
  function pickFile() {
    return new Promise(resolve => {
      const inp = $('#file-input'); inp.value = '';
      inp.onchange = async () => { const f = inp.files[0]; resolve(f ? await f.text() : null); };
      inp.click();
    });
  }
  function downloadText(text, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);

  /* ---------- Google Drive ---------- */
  const Drive = {
    token: null, exp: 0, gisPromise: null,
    loadGis() {
      if (window.google?.accounts?.oauth2) return Promise.resolve();
      if (!this.gisPromise) this.gisPromise = new Promise((res, rej) => {
        const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
        s.onload = res; s.onerror = () => { this.gisPromise = null; rej(new Error('No se pudo conectar con Google. Revisa tu internet.')); };
        document.head.appendChild(s);
      });
      return this.gisPromise;
    },
    async getToken() {
      if (this.token && Date.now() < this.exp - 60000) return this.token;
      const cid = settings.googleClientId;
      if (!cid) throw new Error('Primero configura el ID de cliente de Google (Ajustes › Configurar conexión con Google).');
      await this.loadGis();
      return new Promise((res, rej) => {
        const tc = google.accounts.oauth2.initTokenClient({
          client_id: cid, scope: 'https://www.googleapis.com/auth/drive.file',
          callback: r => { if (r.error) return rej(new Error(r.error_description || r.error)); this.token = r.access_token; this.exp = Date.now() + r.expires_in * 1000; res(this.token); },
          error_callback: e => rej(new Error(e?.type === 'popup_closed' ? 'Se cerró la ventana de Google.' : e?.type === 'popup_failed_to_open' ? 'El navegador bloqueó la ventana de Google. Permite ventanas emergentes e inténtalo otra vez.' : (e?.message || 'No se pudo iniciar sesión en Google.'))),
        });
        tc.requestAccessToken({ prompt: '' });
      });
    },
    async api(url, opts = {}) {
      const token = await this.getToken();
      const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token } });
      if (r.status === 401) { this.token = null; throw new Error('La sesión de Google expiró. Inténtalo otra vez.'); }
      if (!r.ok) { let m = ''; try { m = (await r.json()).error?.message; } catch {} throw new Error('Google Drive respondió con un error: ' + (m || r.status)); }
      return r;
    },
    async find() {
      const q = encodeURIComponent(`name='${DRIVE_NAME}' and trashed=false`);
      const r = await this.api(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&orderBy=modifiedTime desc&fields=files(id,modifiedTime)`);
      return (await r.json()).files?.[0] || null;
    },
    async upload(text) {
      const f = await this.find();
      if (f) {
        await this.api(`https://www.googleapis.com/upload/drive/v3/files/${f.id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text });
      } else {
        const bnd = 'gc' + uid();
        const body = `--${bnd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: DRIVE_NAME, mimeType: 'application/json', description: 'Respaldo cifrado de Guardaclaves' })}\r\n--${bnd}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${bnd}--`;
        await this.api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${bnd}` }, body });
      }
    },
    async download() {
      const f = await this.find();
      if (!f) throw new Error('No hay ningún respaldo de Guardaclaves en ese Google Drive.');
      const r = await this.api(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`);
      return r.text();
    },
  };
  async function driveBackup() {
    await holding(async () => { await Drive.upload(await buildBackup()); });
    await markBackedUp('Google Drive');
    toast('Respaldo guardado en Google Drive');
  }

  /* ---------- Ajustes ---------- */
  async function renderSettings() {
    $('#set-autolock').value = String(settings.autoLock);
    $('#set-clip').value = String(settings.clipSec);
    $('#set-wipe').checked = settings.wipeOnFail;
    $('#set-client-id').value = settings.googleClientId;
    $('#drive-config').open = !settings.googleClientId;
    $('#version').textContent = 'v' + VERSION;
    const avail = window.isSecureContext && await bioAvailable();
    $('#bio-status').textContent = meta.bio ? 'Activado' : 'Desactivado';
    $('#bio-toggle').textContent = meta.bio ? 'Desactivar huella' : 'Activar huella';
    $('#bio-toggle').disabled = !meta.bio && !avail;
    $('#bio-hint').textContent = meta.bio ? 'La huella queda registrada solo en este dispositivo. La contraseña maestra sigue funcionando.'
      : !window.isSecureContext ? 'Para usar la huella abre la app desde su dirección https.'
      : avail ? 'Podrás entrar con tu huella o Face ID. En otro teléfono tendrás que activarla de nuevo.'
      : 'Este dispositivo o navegador no ofrece desbloqueo biométrico.';
    renderBackupStatus();
    if (settings.googleClientId) Drive.loadGis().catch(() => {});
  }
  function renderBackupStatus() {
    const lb = meta?.lastBackup;
    $('#backup-status').textContent = lb ? `Último respaldo: ${new Date(lb.at).toLocaleString('es-DO')} (${lb.where})${meta.dirty ? ' · hay cambios posteriores' : ''}`
      : 'Todavía no has hecho ningún respaldo.';
  }

  /* ---------- Errores ---------- */
  const fail = e => { console.error(e); toast(e?.message || 'Ocurrió un error', 4500); };
  const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { fail(e); } };

  /* ---------- Eventos ---------- */
  function wire() {
    // Setup
    $('#setup-pw').addEventListener('input', () => paintMeter($('#setup-meter'), $('#setup-pw').value, $('#setup-meter-label')));
    $('#form-setup').addEventListener('submit', guard(async ev => {
      ev.preventDefault();
      const a = $('#setup-pw').value, b = $('#setup-pw2').value;
      if (a.length < 8) return toast('Usa al menos 8 caracteres');
      if (a !== b) return toast('Las contraseñas no coinciden');
      if (strength(a).bits < 45 && !await confirmBox('Contraseña débil', 'Esa contraseña es fácil de adivinar. ¿Usarla de todos modos?', 'Usarla')) return;
      const btn = ev.submitter || $('#form-setup button[type=submit]'); btn.disabled = true; btn.textContent = 'Creando…';
      try { await createVault(a); } finally { btn.disabled = false; btn.textContent = 'Crear y entrar'; }
      $('#setup-pw').value = ''; $('#setup-pw2').value = '';
      if (await bioAvailable() && window.isSecureContext &&
          await confirmBox('¿Activar la huella?', 'Así podrás entrar con tu huella o Face ID en vez de escribir la contraseña.', 'Activar')) {
        try { await holding(enableBio); toast('Huella activada'); } catch (e) { toast(bioErr(e), 4500); }
      }
    }));
    $('#setup-restore-file').addEventListener('click', guard(async () => { const t = await pickFile(); if (t) await restoreFresh(t); }));
    $('#setup-client-id').addEventListener('change', guard(async () => { settings.googleClientId = $('#setup-client-id').value.trim(); await saveSettings(); Drive.loadGis().catch(() => {}); }));
    $('#setup-restore-drive').addEventListener('click', guard(async () => {
      if (!settings.googleClientId) { $('#setup-client-id').closest('details').open = true; return toast('Escribe primero el ID de cliente de Google'); }
      const t = await Drive.download(); await restoreFresh(t);
    }));

    // Lock
    $('#form-lock').addEventListener('submit', async ev => {
      ev.preventDefault();
      const btn = $('#form-lock button[type=submit]'); btn.disabled = true; $('#lock-msg').textContent = '';
      try { await unlockPassword($('#lock-pw').value); }
      catch (e) { $('#lock-msg').textContent = e.message; $('#lock-pw').select(); }
      finally { btn.disabled = false; }
    });
    $('#lock-bio').addEventListener('click', async () => {
      $('#lock-msg').textContent = '';
      try { await unlockBio(); } catch (e) { $('#lock-msg').textContent = bioErr(e); }
    });

    // Lista
    $('#search').addEventListener('input', renderList);
    $('#list').addEventListener('click', ev => { const li = ev.target.closest('li[data-id]'); if (!li) return; S.current = li.dataset.id; renderDetail(); show('detail'); });
    $('#btn-add').addEventListener('click', () => openEdit(null));
    $('#btn-lock').addEventListener('click', lock);
    $('#btn-gen').addEventListener('click', () => openGen(false));
    $('#btn-settings').addEventListener('click', guard(async () => { await renderSettings(); show('settings'); }));
    $('#backup-banner').addEventListener('click', guard(async () => {
      if (settings.googleClientId) await driveBackup(); else { await renderSettings(); show('settings'); toast('Elige cómo respaldar'); }
    }));
    document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', back));

    // Detalle / edición
    $('#detail-edit').addEventListener('click', () => openEdit(S.current));
    $('#form-edit').addEventListener('submit', guard(async ev => { ev.preventDefault(); await saveEdit(); }));
    $('#e-pw').addEventListener('input', () => paintMeter($('#e-meter'), $('#e-pw').value));
    $('#e-pw-toggle').addEventListener('click', () => { const i = $('#e-pw'); i.type = i.type === 'password' ? 'text' : 'password'; });
    $('#e-gen').addEventListener('click', () => { $('#e-pw').value = generate(); $('#e-pw').type = 'text'; paintMeter($('#e-meter'), $('#e-pw').value); });
    $('#e-gen-opts').addEventListener('click', () => openGen(true));
    $('#e-delete').addEventListener('click', guard(async () => {
      const e = S.vault.entries.find(x => x.id === S.editing);
      if (!await confirmBox('Eliminar', `¿Eliminar «${e.title}»? No se puede deshacer.`, 'Eliminar', true)) return;
      S.vault.entries = S.vault.entries.filter(x => x.id !== S.editing);
      await saveVault(); history = []; renderList(); show('list', false); toast('Eliminada');
    }));

    // Generador
    ['gen-len', 'gen-upper', 'gen-lower', 'gen-digits', 'gen-symbols', 'gen-ambig'].forEach(id => $('#' + id).addEventListener('input', () => { readGen(); regen(); }));
    $('#gen-again').addEventListener('click', regen);
    $('#gen-copy').addEventListener('click', () => { const p = $('#gen-out').textContent; if (p && strength(p).bits) copy(p, 'Contraseña copiada'); });
    $('#gen-use').addEventListener('click', () => {
      const p = $('#gen-out').textContent; if (!strength(p).bits) return;
      history.pop(); show('edit', false); $('#e-pw').value = p; $('#e-pw').type = 'text'; paintMeter($('#e-meter'), p);
    });

    // Ajustes
    $('#bio-toggle').addEventListener('click', guard(async () => {
      if (meta.bio) {
        if (!await confirmBox('Desactivar huella', 'Tendrás que escribir la contraseña maestra para entrar.', 'Desactivar')) return;
        meta.bio = null; await saveMeta(); toast('Huella desactivada');
      } else {
        try { await holding(enableBio); toast('Huella activada'); } catch (e) { toast(bioErr(e), 5000); }
      }
      renderSettings();
    }));
    $('#change-pw').addEventListener('click', guard(async () => {
      const r = await modal({ title: 'Cambiar contraseña maestra', fields: [
        { label: 'Contraseña actual', type: 'password', autocomplete: 'current-password' },
        { label: 'Nueva contraseña', type: 'password', autocomplete: 'new-password' },
        { label: 'Repite la nueva', type: 'password', autocomplete: 'new-password' }] });
      if (r.button !== 'ok') return;
      const [cur, a, b] = r.values;
      try { await unseal(await pwKey(cur, fromB64(meta.salt), meta.iters), meta.wrappedPw, AAD_DEK); }
      catch { throw new Error('La contraseña actual no es correcta.'); }
      if (a.length < 8) throw new Error('La nueva contraseña debe tener al menos 8 caracteres.');
      if (a !== b) throw new Error('Las contraseñas nuevas no coinciden.');
      const salt = rand(16);
      meta.salt = toB64(salt); meta.iters = ITERS; meta.wrappedPw = await seal(await pwKey(a, salt, ITERS), S.dekRaw, AAD_DEK);
      meta.dirty = true; await saveMeta(); updateBanner(); renderBackupStatus();
      await modal({ title: 'Contraseña cambiada', text: 'Haz un respaldo nuevo. Los respaldos anteriores se siguen abriendo con la contraseña vieja.', buttons: [{ label: 'Entendido', value: 'ok', primary: true }] });
    }));
    $('#set-autolock').addEventListener('change', guard(async e => { settings.autoLock = +e.target.value; await saveSettings(); }));
    $('#set-clip').addEventListener('change', guard(async e => { settings.clipSec = +e.target.value; await saveSettings(); }));
    $('#set-wipe').addEventListener('change', guard(async e => {
      if (e.target.checked && !await confirmBox('Borrado tras 10 intentos', 'Si alguien (o tú) falla la contraseña 10 veces seguidas, se borra todo en este dispositivo. Asegúrate de tener un respaldo.', 'Activar', true)) { e.target.checked = false; return; }
      settings.wipeOnFail = e.target.checked; await saveSettings();
    }));
    $('#save-client-id').addEventListener('click', guard(async () => {
      const v = $('#set-client-id').value.trim();
      if (v && !/\.apps\.googleusercontent\.com$/.test(v)) throw new Error('El ID debe terminar en .apps.googleusercontent.com');
      settings.googleClientId = v; Drive.token = null; await saveSettings(); toast(v ? 'ID guardado' : 'ID eliminado');
      if (v) Drive.loadGis().catch(() => {});
    }));
    $('#drive-backup').addEventListener('click', guard(driveBackup));
    $('#drive-restore').addEventListener('click', guard(async () => { const t = await holding(() => Drive.download()); await restoreInto(t); }));
    $('#file-share').addEventListener('click', guard(async () => {
      const text = await buildBackup();
      const file = new File([text], `Guardaclaves-respaldo-${stamp()}.txt`, { type: 'text/plain' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await holding(() => navigator.share({ files: [file], title: 'Respaldo de Guardaclaves' })); }
        catch (e) { if (e.name === 'AbortError') return; throw e; }
        await markBackedUp('archivo enviado'); toast('Respaldo enviado');
      } else { downloadText(text, `Guardaclaves-respaldo-${stamp()}.json`); await markBackedUp('archivo descargado'); toast('Este navegador no permite compartir; se descargó el archivo'); }
    }));
    $('#file-download').addEventListener('click', guard(async () => { downloadText(await buildBackup(), `Guardaclaves-respaldo-${stamp()}.json`); await markBackedUp('archivo descargado'); toast('Respaldo descargado'); }));
    $('#file-import').addEventListener('click', guard(async () => { const t = await holding(pickFile); if (t) await restoreInto(t); }));
    $('#wipe-all').addEventListener('click', guard(async () => {
      const r = await modal({ title: 'Borrar todo', text: 'Se borrarán todas las contraseñas de este dispositivo. Los respaldos en Drive o en archivos no se tocan.\n\nEscribe BORRAR para confirmar.', fields: [{ label: 'Confirmación' }],
        buttons: [{ label: 'Cancelar', value: null }, { label: 'Borrar todo', value: 'ok', primary: true, danger: true }] });
      if (r.button !== 'ok' || r.values[0].trim().toUpperCase() !== 'BORRAR') return;
      const keepClient = settings.googleClientId;
      await DB.clear(); settings = { ...DEFAULTS, googleClientId: keepClient }; await saveSettings();
      if (S.dekRaw) S.dekRaw.fill(0); S = blankState(); meta = null; history = [];
      show('setup', false); toast('Datos borrados');
    }));

    // Atajo: Escape cierra el modal
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) $('#modal').querySelector('button[type=button]')?.click(); });
  }

  /* ---------- Arranque ---------- */
  async function start() {
    if (!window.crypto?.subtle) {
      document.body.innerHTML = '<p class="content">Este navegador no permite el cifrado necesario. Abre la app desde su dirección https en Chrome, Safari, Edge o Samsung Internet.</p>';
      return;
    }
    wire();
    settings = { ...DEFAULTS, ...(await DB.get('settings') || {}) };
    settings.gen = { ...DEFAULTS.gen, ...(settings.gen || {}) };
    meta = await DB.get('meta') || null;
    $('#setup-client-id').value = settings.googleClientId;
    if (meta) showLock(); else show('setup', false);
    if ('serviceWorker' in navigator && window.isSecureContext && location.protocol !== 'file:')
      navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  start().catch(fail);
})();
