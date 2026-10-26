/**
 * Lorebinder — lorebook organizer for SillyTavern.
 * Author: Ayrissa. License: MIT.
 *
 * Stores only order / pins / folders / tags in the extension settings.
 * Does not modify lorebooks, does not use any API or keys.
 */
import { LOC } from './locales.js';

const MODULE = 'lorebinder';
const getContext = () => SillyTavern.getContext();

const DEFAULTS = { lang: 'ru', enabled: true, folders: [], tags: [], books: {}, order: [] };
const ui = { view: 'all', tags: new Set(), query: '', manage: false, expanded: null }; // expanded: { name, kind: 'folders' | 'tags' }

/* ---------------------------------------------------------------- data */

function data() {
    const root = getContext().extensionSettings;
    if (!root[MODULE]) root[MODULE] = {};
    return root[MODULE];
}

function initData() {
    const d = data();
    for (const k of Object.keys(DEFAULTS)) {
        if (d[k] === undefined) d[k] = JSON.parse(JSON.stringify(DEFAULTS[k]));
    }
}

const save = () => getContext().saveSettingsDebounced();
const uid = () => Math.random().toString(36).slice(2, 8);

function t(key, vars = {}) {
    let s = LOC[data().lang]?.[key] ?? LOC.en[key] ?? key;
    for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
    return s;
}

function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
}

function textColor(hex) {
    const n = parseInt((/^#?([0-9a-f]{6})$/i.exec(hex) || [0, '808080'])[1], 16);
    const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return lum > 0.62 ? '#1b1b1b' : '#ffffff';
}

const folderById = id => data().folders.find(f => f.id === id);
const tagById = id => data().tags.find(x => x.id === id);

const EMPTY = Object.freeze({ pinned: false, folders: Object.freeze([]), tags: Object.freeze([]) });
/** read-only access (never mutates data) */
const getBook = name => data().books[name] || EMPTY;
/** write access (creates the record when needed) */
function bookW(name) {
    const d = data();
    if (!d.books[name]) d.books[name] = { pinned: false, folders: [], tags: [] };
    return d.books[name];
}

/** drop references to deleted folders/tags (run rarely, not on every render) */
function normalize() {
    const d = data();
    const fids = new Set(d.folders.map(f => f.id)), tids = new Set(d.tags.map(x => x.id));
    for (const b of Object.values(d.books)) {
        b.folders = (b.folders || []).filter(id => fids.has(id));
        b.tags = (b.tags || []).filter(id => tids.has(id));
    }
}

/** Lorebook names are read from the page's own list (names only, nothing else). */
function listNames() {
    const out = [];
    $('#world_editor_select option').each(function () {
        const value = $(this).val();
        const name = $(this).text().trim();
        if (value !== '' && value != null && name) out.push(name);
    });
    return out;
}

function syncOrder(names) {
    const d = data();
    let changed = false;
    for (const n of names) if (!d.order.includes(n)) { d.order.push(n); changed = true; }
    return changed;
}

function visibleBooks(names) {
    const d = data();
    if (syncOrder(names)) save();
    const set = new Set(names);
    let arr = d.order.filter(n => set.has(n));
    arr = [...arr.filter(n => getBook(n).pinned), ...arr.filter(n => !getBook(n).pinned)];

    if (ui.view === 'pinned') arr = arr.filter(n => getBook(n).pinned);
    else if (ui.view === 'none') arr = arr.filter(n => getBook(n).folders.length === 0);
    else if (ui.view !== 'all') arr = arr.filter(n => getBook(n).folders.includes(ui.view));

    if (ui.tags.size) arr = arr.filter(n => [...ui.tags].every(id => getBook(n).tags.includes(id)));

    const q = ui.query.trim().toLowerCase();
    if (q) arr = arr.filter(n => n.toLowerCase().includes(q));
    return arr;
}

function moveBook(name, dir) {
    const d = data();
    const vis = visibleBooks(listNames());
    const i = vis.indexOf(name);
    const other = vis[i + dir];
    if (i < 0 || !other || getBook(other).pinned !== getBook(name).pinned) return;
    const a = d.order.indexOf(name), b = d.order.indexOf(other);
    [d.order[a], d.order[b]] = [d.order[b], d.order[a]];
}

function moveItem(kind, id, dir) {
    const arr = data()[kind];
    const i = arr.findIndex(x => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
}

function toggle(arr, id) {
    const i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1); else arr.push(id);
}

/** Makes sure the World Info panel is open (the app may close it when clicking outside of it). */
function ensureWorldInfoOpen() {
    const $wi = $('#WorldInfo');
    if (!$wi.length) return;
    if ($wi.is(':visible') && !$wi.hasClass('closedDrawer')) return;
    let $toggle = $wi.closest('.drawer').children('.drawer-toggle').first();
    if (!$toggle.length) $toggle = $('#WI-SP-button .drawer-toggle').first();
    $toggle.trigger('click');
}

function openBook(name) {
    const $sel = $('#world_editor_select');
    if (!$sel.length) return toastr.error(t('noSelect'));
    const opt = $sel.find('option').filter(function () { return $(this).text().trim() === name; }).first();
    if (!opt.length) return toastr.error(t('openFail'));
    closeModal();
    ensureWorldInfoOpen();
    $sel.val(opt.val()).trigger('change');
    setTimeout(ensureWorldInfoOpen, 250);
}

/* ---------------------------------------------------------------- render */

function tagChip(x) {
    return `<span class="lb-tag" style="background:${esc(x.color)};color:${textColor(x.color)}">#${esc(x.name)}</span>`;
}

function viewChipsHtml(names) {
    const d = data();
    let pinned = 0, none = 0;
    const per = {};
    for (const n of names) {
        const b = getBook(n);
        if (b.pinned) pinned++;
        if (!b.folders.length) none++;
        for (const id of b.folders) per[id] = (per[id] || 0) + 1;
    }
    const chip = (v, label, count, color) =>
        `<span class="lb-chip${ui.view === v ? ' active' : ''}" data-act="view" data-v="${esc(v)}"${color ? ` style="--c:${esc(color)}"` : ''}>${color ? '<i class="lb-dot"></i>' : ''}${esc(label)} <small>${count}</small></span>`;
    const h = chip('all', t('viewAll'), names.length)
        + chip('pinned', '★ ' + t('viewPinned'), pinned)
        + d.folders.map(f => chip(f.id, f.name, per[f.id] || 0, f.color)).join('')
        + chip('none', t('viewNone'), none);
    return `<div class="lb-chips">${h}</div>`;
}

function tagFilterHtml() {
    const d = data();
    if (!d.tags.length) return '';
    const h = d.tags.map(x => `<span data-act="tagf" data-id="${x.id}" class="lb-tagbtn${ui.tags.has(x.id) ? ' active' : ''}">${tagChip(x)}</span>`).join('');
    return `<div class="lb-chips lb-tagrow" title="${esc(t('tagsHint'))}"><span class="lb-label">${esc(t('tagsLabel'))}:</span>${h}</div>`;
}

function manageSection(kind) {
    const d = data();
    const label = kind === 'folders' ? t('folders') : t('tags');
    const ph = kind === 'folders' ? t('newFolder') : t('newTag');
    const defColor = kind === 'folders' ? '#6c8ebf' : '#d9822b';
    const rows = d[kind].map(x => `
<div class="lb-mrow">
  <input type="color" class="lb-mi" data-kind="${kind}" data-id="${x.id}" data-field="color" value="${esc(x.color)}">
  <input type="text" class="text_pole lb-mi" data-kind="${kind}" data-id="${x.id}" data-field="name" value="${esc(x.name)}">
  <i class="lb-ibtn fa-solid fa-chevron-up" data-act="mup" data-kind="${kind}" data-id="${x.id}" title="${esc(t('up'))}"></i>
  <i class="lb-ibtn fa-solid fa-chevron-down" data-act="mdown" data-kind="${kind}" data-id="${x.id}" title="${esc(t('down'))}"></i>
  <i class="lb-ibtn lb-danger fa-solid fa-trash-can" data-act="mdel" data-kind="${kind}" data-id="${x.id}" title="${esc(t('del'))}"></i>
</div>`).join('');
    return `<div class="lb-msec"><h4>${esc(label)}</h4>${rows}
<div class="lb-mrow">
  <input type="color" id="lb_new_${kind}_color" value="${defColor}">
  <input type="text" class="text_pole" id="lb_new_${kind}_name" placeholder="${esc(ph)}">
  <div class="menu_button" data-act="madd" data-kind="${kind}">${esc(t('add'))}</div>
</div></div>`;
}

function manageHtml() {
    return `<div class="lb-manage">${manageSection('folders')}${manageSection('tags')}
<div class="menu_button" data-act="clean">${esc(t('cleanMissing'))}</div></div>`;
}

function rowHtml(name) {
    const d = data();
    const b = getBook(name);
    const badges = b.folders.map(folderById).filter(Boolean)
        .map(f => `<span class="lb-badge" style="--c:${esc(f.color)}"><i class="lb-dot"></i>${esc(f.name)}</span>`).join('');
    const tags = b.tags.map(tagById).filter(Boolean).map(tagChip).join('');
    const ex = ui.expanded && ui.expanded.name === name ? ui.expanded.kind : null;
    let panel = '';
    if (ex === 'folders') {
        const ch = d.folders.length
            ? d.folders.map(f => `<span class="lb-chip${b.folders.includes(f.id) ? ' active' : ''}" style="--c:${esc(f.color)}" data-act="tf" data-id="${f.id}"><i class="lb-dot"></i>${esc(f.name)}</span>`).join('')
            : `<small>${esc(t('noFolders'))}</small>`;
        panel = `<div class="lb-panel"><div class="lb-chips"><span class="lb-label">${esc(t('assignFolders'))}:</span>${ch}</div></div>`;
    } else if (ex === 'tags') {
        const ch = d.tags.length
            ? d.tags.map(x => `<span class="lb-tagbtn${b.tags.includes(x.id) ? ' active' : ''}" data-act="tt" data-id="${x.id}">${tagChip(x)}</span>`).join('')
            : `<small>${esc(t('noTags'))}</small>`;
        panel = `<div class="lb-panel"><div class="lb-chips"><span class="lb-label">${esc(t('assignTags'))}:</span>${ch}</div></div>`;
    }
    return `<div class="lb-row${b.pinned ? ' pinned' : ''}" data-name="${esc(name)}">
  <div class="lb-line">
    <i class="lb-ibtn lb-pin fa-solid fa-star${b.pinned ? ' on' : ''}" data-act="pin" title="${esc(b.pinned ? t('unpin') : t('pin'))}"></i>
    <div class="lb-main" data-act="open"><div class="lb-name">${esc(name)}</div>${(badges || tags) ? `<div class="lb-meta">${badges}${tags}</div>` : ''}</div>
    <div class="lb-acts">
      <i class="lb-ibtn fa-solid fa-folder${ex === 'folders' ? ' on' : ''}" data-act="assignf" title="${esc(t('addToFolder'))}"></i>
      <i class="lb-ibtn fa-solid fa-hashtag${ex === 'tags' ? ' on' : ''}" data-act="assignt" title="${esc(t('addTags'))}"></i>
      <i class="lb-ibtn fa-solid fa-chevron-up" data-act="up" title="${esc(t('up'))}"></i>
      <i class="lb-ibtn fa-solid fa-chevron-down" data-act="down" title="${esc(t('down'))}"></i>
    </div>
  </div>${panel}
</div>`;
}

function renderBody() {
    if (ui.view !== 'all' && ui.view !== 'pinned' && ui.view !== 'none' && !folderById(ui.view)) ui.view = 'all';
    for (const id of [...ui.tags]) if (!tagById(id)) ui.tags.delete(id);

    const names = listNames();
    const list = visibleBooks(names);
    $('#lb_body').html(
        viewChipsHtml(names) + tagFilterHtml() + (ui.manage ? manageHtml() : '')
        + `<div class="lb-list">${list.length ? list.map(rowHtml).join('') : `<div class="lb-empty">${esc(t('noBooks'))}</div>`}</div>`,
    );
    $('#lb_manage_btn').toggleClass('on', ui.manage);
}

/* ---------------------------------------------------------------- modal */

let modalOpen = false;

function modalHtml(standalone) {
    return `
<div id="lb_overlay" class="${standalone ? 'lb-overlay' : 'lb-inpopup'}">
  <div class="lb-modal">
    <div class="lb-head">
      <b>${esc(t('title'))}</b>
      <i class="lb-ibtn fa-solid fa-xmark" data-act="close" title="${esc(t('close'))}"></i>
    </div>
    <div class="lb-tools">
      <input type="text" id="lb_search" class="text_pole" placeholder="${esc(t('search'))}" autocomplete="off">
      <div id="lb_manage_btn" class="menu_button menu_button_icon" data-act="manage" title="${esc(t('manage'))}"><i class="fa-solid fa-gear"></i><span>${esc(t('manage'))}</span></div>
    </div>
    <div id="lb_body" class="lb-bodywrap"></div>
  </div>
</div>`;
}

function openLegacy() {
    modalOpen = true;
    const $o = $(modalHtml(true));
    $('body').append($o);
    bindOverlay($o, true);
    renderBody();
}

/** Uses the app's own popup (a native <dialog> in the top layer, so it is always visible, also on phones). */
function openModal() {
    if (modalOpen) return;
    modalOpen = true;
    ui.query = '';
    ui.expanded = null;
    const ctx = getContext();
    if (typeof ctx.callGenericPopup !== 'function') return openLegacy();

    const type = ctx.POPUP_TYPE?.TEXT ?? 1;
    const p = ctx.callGenericPopup(modalHtml(false), type, '', { wide: true, large: true, okButton: t('close'), allowVerticalScrolling: true });
    Promise.resolve(p).then(() => { modalOpen = false; }, () => { modalOpen = false; });
    setTimeout(() => {
        const $o = $('#lb_overlay');
        if ($o.length) { bindOverlay($o, false); renderBody(); }
        else { modalOpen = false; openLegacy(); }
    }, 30);
}

function closeModal() {
    const $o = $('#lb_overlay');
    const dlg = $o.closest('dialog').get(0);
    if (dlg) {
        const ok = $(dlg).find('.popup-button-ok').get(0);
        if (ok) ok.click(); else dlg.close?.();
    } else {
        $o.remove();
        modalOpen = false;
    }
}

function safeOpen() {
    try { openModal(); } catch (e) {
        console.error('[Lorebinder]', e);
        toastr.error('Lorebinder: ' + (e?.message || e));
    }
}

let searchTimer = null;

function handleAction($el) {
    const act = $el.attr('data-act');
    const d = data();
    const name = $el.closest('.lb-row').attr('data-name');
    const kind = $el.attr('data-kind');
    const id = $el.attr('data-id');
    let persist = true;

    switch (act) {
        case 'close': closeModal(); return;
        case 'open': openBook(name); return;
        case 'manage': ui.manage = !ui.manage; persist = false; break;
        case 'view': ui.view = $el.attr('data-v'); persist = false; break;
        case 'tagf': ui.tags.has(id) ? ui.tags.delete(id) : ui.tags.add(id); persist = false; break;
        case 'assignf': ui.expanded = (ui.expanded?.name === name && ui.expanded.kind === 'folders') ? null : { name, kind: 'folders' }; persist = false; break;
        case 'assignt': ui.expanded = (ui.expanded?.name === name && ui.expanded.kind === 'tags') ? null : { name, kind: 'tags' }; persist = false; break;
        case 'pin': { const b = bookW(name); b.pinned = !b.pinned; break; }
        case 'up': moveBook(name, -1); break;
        case 'down': moveBook(name, 1); break;
        case 'tf': toggle(bookW(name).folders, id); break;
        case 'tt': toggle(bookW(name).tags, id); break;
        case 'mup': moveItem(kind, id, -1); break;
        case 'mdown': moveItem(kind, id, 1); break;
        case 'madd': {
            const nm = String($(`#lb_new_${kind}_name`).val() || '').trim().replace(/^#/, '');
            if (!nm) return;
            d[kind].push({ id: uid(), name: nm.slice(0, 40), color: $(`#lb_new_${kind}_color`).val() });
            break;
        }
        case 'mdel': {
            const item = d[kind].find(x => x.id === id);
            if (!item || !confirm(t('confirmDelete', { n: item.name }))) return;
            d[kind] = d[kind].filter(x => x.id !== id);
            if (ui.view === id) ui.view = 'all';
            ui.tags.delete(id);
            normalize();
            break;
        }
        case 'clean': {
            const names = new Set(listNames());
            let n = 0;
            for (const k of Object.keys(d.books)) if (!names.has(k)) { delete d.books[k]; n++; }
            const before = d.order.length;
            d.order = d.order.filter(k => names.has(k));
            n += before - d.order.length;
            toastr.success(t('cleaned') + n);
            break;
        }
        default: return;
    }
    if (persist) save();
    renderBody();
}

/** Handlers live on the overlay itself, and events are stopped there so the app does not treat clicks in the
 *  window as "outside clicks" (which would close the lorebooks panel behind it). */
function bindOverlay($o, standalone) {
    if (standalone) $o.on('mousedown', function (e) { if (e.target === this) closeModal(); });
    $o.on('click', '[data-act]', function () { handleAction($(this)); });
    $o.on('input', '#lb_search', function () {
        const v = this.value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => { ui.query = v; renderBody(); }, 120);
    });
    $o.on('change', '.lb-mi', function () {
        const $el = $(this);
        const item = data()[$el.attr('data-kind')].find(x => x.id === $el.attr('data-id'));
        if (!item) return;
        const field = $el.attr('data-field');
        let v = String($el.val()).trim();
        if (field === 'name') {
            v = v.replace(/^#/, '');
            if (!v) { renderBody(); return; }
            v = v.slice(0, 40);
        }
        item[field] = v;
        save();
        renderBody();
    });
    $o.on('click mousedown mouseup', e => e.stopPropagation());
}

function bindModalEvents() {
    $(document).on('keydown', e => { if (e.key === 'Escape' && $('#lb_overlay.lb-overlay').length) closeModal(); });
}

/* ---------------------------------------------------------------- page button + settings */

function injectButton() {
    $('#lb_open').remove();
    if (!data().enabled) return true;
    const $sel = $('#world_editor_select');
    if (!$sel.length) return false;
    const $next = $sel.next('.select2-container');
    const $anchor = $next.length ? $next : $sel;
    $anchor.after(`<div id="lb_open" class="menu_button menu_button_icon interactable fa-solid fa-folder-tree" title="${esc(t('openTip'))}" tabindex="0"></div>`);
    $('#lb_open').on('click', safeOpen);
    return true;
}

function ensureButton(tries = 30) {
    if (injectButton() || tries <= 0) return;
    setTimeout(() => ensureButton(tries - 1), 500);
}

function settingsBody() {
    const d = data();
    return `
<label class="stw-row lb-srow"><span>${esc(t('language'))}</span>
  <select id="lb_lang" class="text_pole"><option value="ru"${d.lang === 'ru' ? ' selected' : ''}>Русский</option><option value="en"${d.lang === 'en' ? ' selected' : ''}>English</option></select></label>
<label class="checkbox_label"><input type="checkbox" id="lb_enabled"${d.enabled ? ' checked' : ''}><span>${esc(t('enabled'))}</span></label>
<div class="lb-sbtns">
  <div class="menu_button" id="lb_open_settings">${esc(t('openMgr'))}</div>
  <div class="menu_button" id="lb_export">${esc(t('exportBtn'))}</div>
  <div class="menu_button" id="lb_import">${esc(t('importBtn'))}</div>
  <input type="file" id="lb_import_file" accept="application/json,.json" hidden>
</div>
<small class="lb-note">${esc(t('note'))}</small>`;
}

function rebuildSettings() {
    $('#lb_title').text(t('title'));
    $('#lb_sbody').html(settingsBody());
    $('#lb_open').attr('title', t('openTip'));
}

function bindSettingsEvents() {
    $(document).on('click', '#lb_open', safeOpen);
    $(document).on('click', '#lb_open_settings', safeOpen);
    $(document).on('change', '#lb_lang', function () { data().lang = this.value; save(); rebuildSettings(); });
    $(document).on('change', '#lb_enabled', function () { data().enabled = this.checked; save(); ensureButton(); if (!this.checked) closeModal(); });

    $(document).on('click', '#lb_export', () => {
        const d = data();
        const payload = { app: 'lorebinder', version: 1, folders: d.folders, tags: d.tags, books: d.books, order: d.order };
        const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url; a.download = 'lorebinder-backup.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    $(document).on('click', '#lb_import', () => $('#lb_import_file').trigger('click'));
    $(document).on('change', '#lb_import_file', async function () {
        const file = this.files?.[0];
        this.value = '';
        if (!file) return;
        try {
            const j = JSON.parse(await file.text());
            if (j.app !== 'lorebinder' || !Array.isArray(j.folders) || !Array.isArray(j.tags) || typeof j.books !== 'object') throw new Error('bad');
            const d = data();
            d.folders = j.folders; d.tags = j.tags; d.books = j.books; d.order = Array.isArray(j.order) ? j.order : [];
            save();
            toastr.success(t('imported'));
        } catch (e) { toastr.error(t('importErr')); }
    });
}

function init() {
    initData();
    normalize();
    $('#extensions_settings2').append(`
<div class="lb-settings">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b id="lb_title">${t('title')}</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content"><div id="lb_sbody"></div></div>
  </div>
</div>`);
    rebuildSettings();
    bindSettingsEvents();
    bindModalEvents();
    ensureButton();
}

jQuery(() => {
    try { init(); } catch (e) {
        console.error('[Lorebinder]', e);
        toastr.error('Lorebinder: ' + (e?.message || e));
    }
});
