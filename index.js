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
const ui = { view: 'all', tags: new Set(), query: '', manage: false, expanded: null };

/* ---------------------------------------------------------------- data */

function data() {
    const root = getContext().extensionSettings;
    if (!root[MODULE]) root[MODULE] = {};
    return root[MODULE];
}

function initData() {
    const d = data();
    for (const k of Object.keys(DEFAULTS)) {
        if (d[k] === undefined) d[k] = structuredClone(DEFAULTS[k]);
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

function book(name) {
    const d = data();
    if (!d.books[name]) d.books[name] = { pinned: false, folders: [], tags: [] };
    const b = d.books[name];
    b.folders = (b.folders || []).filter(id => folderById(id));
    b.tags = (b.tags || []).filter(id => tagById(id));
    return b;
}

/** Lorebook names are read from the page's own list (names only, nothing else). */
function listBooks() {
    const out = [];
    $('#world_editor_select option').each(function () {
        const value = $(this).val();
        const name = $(this).text().trim();
        if (value !== '' && value != null && name) out.push({ value, name });
    });
    return out;
}

function syncOrder(names) {
    const d = data();
    for (const n of names) if (!d.order.includes(n)) d.order.push(n);
}

function visibleBooks() {
    const d = data();
    const names = listBooks().map(b => b.name);
    syncOrder(names);
    let arr = d.order.filter(n => names.includes(n));
    arr = [...arr.filter(n => book(n).pinned), ...arr.filter(n => !book(n).pinned)];

    if (ui.view === 'pinned') arr = arr.filter(n => book(n).pinned);
    else if (ui.view === 'none') arr = arr.filter(n => book(n).folders.length === 0);
    else if (ui.view !== 'all') arr = arr.filter(n => book(n).folders.includes(ui.view));

    if (ui.tags.size) arr = arr.filter(n => [...ui.tags].every(id => book(n).tags.includes(id)));

    const q = ui.query.trim().toLowerCase();
    if (q) arr = arr.filter(n => n.toLowerCase().includes(q));
    return arr;
}

function moveBook(name, dir) {
    const d = data();
    const vis = visibleBooks();
    const i = vis.indexOf(name);
    const other = vis[i + dir];
    if (i < 0 || !other || book(other).pinned !== book(name).pinned) return;
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

function openBook(name) {
    const $sel = $('#world_editor_select');
    if (!$sel.length) return toastr.error(t('noSelect'));
    const opt = $sel.find('option').filter(function () { return $(this).text().trim() === name; }).first();
    if (!opt.length) return toastr.error(t('openFail'));
    $sel.val(opt.val()).trigger('change');
    closeModal();
}

/* ---------------------------------------------------------------- render */

function tagChip(x, extra = '') {
    return `<span class="lb-tag${extra}" style="background:${esc(x.color)};color:${textColor(x.color)}">#${esc(x.name)}</span>`;
}

function viewChipsHtml() {
    const d = data();
    const names = listBooks().map(b => b.name);
    const cnt = fn => names.filter(fn).length;
    const chip = (v, label, count, color) =>
        `<span class="lb-chip${ui.view === v ? ' active' : ''}" data-act="view" data-v="${esc(v)}"${color ? ` style="--c:${esc(color)}"` : ''}>${color ? '<i class="lb-dot"></i>' : ''}${esc(label)} <small>${count}</small></span>`;
    let h = chip('all', t('viewAll'), names.length)
        + chip('pinned', '★ ' + t('viewPinned'), cnt(n => book(n).pinned))
        + d.folders.map(f => chip(f.id, f.name, cnt(n => book(n).folders.includes(f.id)), f.color)).join('')
        + chip('none', t('viewNone'), cnt(n => book(n).folders.length === 0));
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
    const b = book(name);
    const badges = b.folders.map(id => folderById(id)).filter(Boolean)
        .map(f => `<span class="lb-badge" style="--c:${esc(f.color)}"><i class="lb-dot"></i>${esc(f.name)}</span>`).join('');
    const tags = b.tags.map(id => tagById(id)).filter(Boolean).map(x => tagChip(x)).join('');
    let panel = '';
    if (ui.expanded === name) {
        const fch = d.folders.length ? d.folders.map(f => `<span class="lb-chip${b.folders.includes(f.id) ? ' active' : ''}" style="--c:${esc(f.color)}" data-act="tf" data-id="${f.id}"><i class="lb-dot"></i>${esc(f.name)}</span>`).join('') : `<small>${esc(t('noFolders'))}</small>`;
        const tch = d.tags.length ? d.tags.map(x => `<span class="lb-tagbtn${b.tags.includes(x.id) ? ' active' : ''}" data-act="tt" data-id="${x.id}">${tagChip(x)}</span>`).join('') : `<small>${esc(t('noTags'))}</small>`;
        panel = `<div class="lb-panel"><div class="lb-chips"><span class="lb-label">${esc(t('assignFolders'))}:</span>${fch}</div><div class="lb-chips"><span class="lb-label">${esc(t('assignTags'))}:</span>${tch}</div></div>`;
    }
    return `<div class="lb-row${b.pinned ? ' pinned' : ''}" data-name="${esc(name)}">
  <div class="lb-line">
    <i class="lb-ibtn lb-pin fa-solid fa-star${b.pinned ? ' on' : ''}" data-act="pin" title="${esc(b.pinned ? t('unpin') : t('pin'))}"></i>
    <div class="lb-main" data-act="open"><div class="lb-name">${esc(name)}</div>${(badges || tags) ? `<div class="lb-meta">${badges}${tags}</div>` : ''}</div>
    <div class="lb-acts">
      <i class="lb-ibtn fa-solid fa-tags${ui.expanded === name ? ' on' : ''}" data-act="assign" title="${esc(t('assign'))}"></i>
      <i class="lb-ibtn fa-solid fa-chevron-up" data-act="up" title="${esc(t('up'))}"></i>
      <i class="lb-ibtn fa-solid fa-chevron-down" data-act="down" title="${esc(t('down'))}"></i>
    </div>
  </div>${panel}
</div>`;
}

function renderBody() {
    const d = data();
    if (ui.view !== 'all' && ui.view !== 'pinned' && ui.view !== 'none' && !folderById(ui.view)) ui.view = 'all';
    for (const id of [...ui.tags]) if (!tagById(id)) ui.tags.delete(id);

    const list = visibleBooks();
    $('#lb_body').html(
        viewChipsHtml() + tagFilterHtml() + (ui.manage ? manageHtml() : '')
        + `<div class="lb-list">${list.length ? list.map(rowHtml).join('') : `<div class="lb-empty">${esc(t('noBooks'))}</div>`}</div>`,
    );
    $('#lb_manage_btn').toggleClass('on', ui.manage);
    save();
}

/* ---------------------------------------------------------------- modal */

function openModal() {
    if ($('#lb_overlay').length) return;
    ui.query = '';
    $('body').append(`
<div id="lb_overlay" class="lb-overlay">
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
</div>`);
    renderBody();
}

function closeModal() { $('#lb_overlay').remove(); }

function bindModalEvents() {
    $(document).on('mousedown', '#lb_overlay', e => { if (e.target.id === 'lb_overlay') closeModal(); });
    $(document).on('keydown', e => { if (e.key === 'Escape' && $('#lb_overlay').length) closeModal(); });
    $(document).on('input', '#lb_search', function () { ui.query = this.value; renderBody(); });

    $(document).on('click', '#lb_overlay [data-act]', function () {
        const $el = $(this);
        const act = $el.attr('data-act');
        const d = data();
        const name = $el.closest('.lb-row').attr('data-name');
        const kind = $el.attr('data-kind');
        const id = $el.attr('data-id');

        switch (act) {
            case 'close': closeModal(); return;
            case 'manage': ui.manage = !ui.manage; break;
            case 'view': ui.view = $el.attr('data-v'); break;
            case 'tagf': ui.tags.has(id) ? ui.tags.delete(id) : ui.tags.add(id); break;
            case 'open': openBook(name); return;
            case 'pin': book(name).pinned = !book(name).pinned; break;
            case 'up': moveBook(name, -1); break;
            case 'down': moveBook(name, 1); break;
            case 'assign': ui.expanded = ui.expanded === name ? null : name; break;
            case 'tf': toggle(book(name).folders, id); break;
            case 'tt': toggle(book(name).tags, id); break;
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
                break;
            }
            case 'clean': {
                const names = new Set(listBooks().map(b => b.name));
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
        renderBody();
    });

    $(document).on('change', '#lb_overlay .lb-mi', function () {
        const $el = $(this);
        const item = data()[$el.attr('data-kind')].find(x => x.id === $el.attr('data-id'));
        if (!item) return;
        const field = $el.attr('data-field');
        const v = String($el.val()).trim().replace(field === 'name' ? /^#/ : /$^/, '');
        if (field === 'name' && !v) { renderBody(); return; }
        item[field] = field === 'name' ? v.slice(0, 40) : v;
        renderBody();
    });
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
    $(document).on('click', '#lb_open', () => openModal());
    $(document).on('click', '#lb_open_settings', () => openModal());
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

jQuery(() => {
    initData();
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
});
