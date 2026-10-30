// ==UserScript==
// @name         Card statements: since last payoff (Capital One, Chase)
// @namespace    https://github.com/oooseun/statement-since-payoff
// @version      2.0
// @description  On Capital One and Chase card activity pages, marks the last time you paid the card off, tints everything newer, dims what is already paid, and adds a running balance under each amount. Read-only: no network requests, no permissions.
// @author       oooseun
// @homepageURL  https://github.com/oooseun/statement-since-payoff
// @supportURL   https://github.com/oooseun/statement-since-payoff/issues
// @license      MIT
// @match        https://myaccounts.capitalone.com/*
// @match        https://secure.chase.com/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/oooseun/statement-since-payoff/main/statement-since-payoff.user.js
// @updateURL    https://raw.githubusercontent.com/oooseun/statement-since-payoff/main/statement-since-payoff.user.js
// ==/UserScript==

(function () {
    'use strict';

    const CENT = 0.005;
    const DISMISS_KEY = 'cop-chip-hidden';
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const CSS = `
        .cop-new, tr.cop-new > * { background-color: #f3faf5 !important; }
        .cop-zero, tr.cop-zero > * { background-color: #fbf8ef !important; }
        c1-ease-row.cop-new, tr.cop-new > :first-child { box-shadow: inset 4px 0 0 #8fd1a6; }
        c1-ease-row.cop-zero, tr.cop-zero > :first-child { box-shadow: inset 4px 0 0 #d9c48a; }
        .cop-old { opacity: .45; transition: opacity .15s; }
        .cop-old:hover { opacity: 1; }
        .cdk-column-amount:has(> .cop-bal) { flex-direction: column; align-items: flex-end; justify-content: center; }
        .cop-bal { display: block; margin-top: 2px; font-size: 13px; font-weight: 400; color: #6b7280;
                   font-variant-numeric: tabular-nums; white-space: nowrap; }
        .cop-zero .cop-bal { color: #6b5a24; font-weight: 700; }
        .cop-hbal { margin-left: 4px; opacity: .65; }
        td.cop-divider-cell { padding: 0 !important; border: 0 !important; background: none !important; }
        .cop-divider { display: flex; align-items: center; gap: 10px; padding: 10px 12px; font: 600 13px/1.2 inherit; }
        .cop-divider::before { content: ''; order: 1; flex: 1; border-top: 2px solid #d9c48a; }
        .cop-pill { border-radius: 999px; padding: 4px 10px; white-space: nowrap; }
        .cop-pill--new { background: #e3f4e8; color: #1f6b3d; }
        .cop-pill--zero { order: 2; background: #f4ecd2; color: #6b5a24; }
        .cop-chip { position: fixed; right: 20px; bottom: 20px; z-index: 99999; min-width: 200px; max-width: 280px;
                    background: #fff; color: #111; border-radius: 12px; padding: 12px 14px 10px;
                    box-shadow: 0 6px 24px rgba(0,0,0,.18); border-left: 4px solid #8fd1a6;
                    font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .cop-chip--muted { border-left-color: #9ca3af; }
        .cop-chip__label { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #6b7280; }
        .cop-chip__total { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; margin: 2px 0; }
        .cop-chip__sub { color: #4b5563; font-variant-numeric: tabular-nums; }
        .cop-chip__note { margin-top: 6px; color: #6b7280; font-size: 12px; }
        .cop-chip__jump { margin-top: 8px; padding: 0; border: 0; background: none; color: #1f6b3d;
                          font: inherit; font-weight: 600; cursor: pointer; }
        .cop-chip__close { position: absolute; top: 6px; right: 8px; border: 0; background: none;
                           color: #9ca3af; font-size: 16px; line-height: 1; cursor: pointer; }
    `;

    function parseMoney(text) {
        const m = String(text).replace(/\s+/g, '').replace(/[−–—]/g, '-')
            .match(/(-)?\$(-)?([\d,]+(?:\.\d{1,2})?)/);
        if (!m) return null;
        const v = parseFloat(m[3].replace(/,/g, ''));
        return m[1] || m[2] ? -v : v;
    }

    const fmt = v => (v < -CENT ? '−' : '') + '$' +
        Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // "Oct  05", "Oct 5, 2026" and "10/05/2026" all become "Oct 5".
    function shortDate(text) {
        const t = text.trim().replace(/\s+/g, ' ');
        const us = t.match(/^(\d{1,2})\/(\d{1,2})\/\d{2,4}$/);
        if (us) return `${MONTHS[us[1] - 1]} ${+us[2]}`;
        const named = t.match(/^([A-Z][a-z]{2})[a-z]* 0?(\d{1,2})/);
        return named ? `${named[1]} ${named[2]}` : t;
    }

    // posted: [{a, isPayment}] newest first. Walks back from `start` and returns the
    // balance after each row plus the payoff row. Strict mode needs an exact $0 (the
    // list is known to add up to the current balance); loose mode takes the newest
    // payment that left the balance at its lowest, and reports the gap from $0.
    function ledger(posted, start, strict) {
        const balances = [];
        let bal = start;
        posted.forEach(p => { balances.push(Math.round(bal * 100) / 100); bal -= p.a; });
        let anchor = -1;
        if (strict) {
            anchor = balances.findIndex(b => Math.abs(b) < CENT);
        } else {
            posted.forEach((p, i) => {
                if (p.a < 0 && p.isPayment && (anchor < 0 || balances[i] < balances[anchor] - CENT)) anchor = i;
            });
        }
        const gap = anchor < 0 ? 0 : balances[anchor];
        return { balances, anchor, gap };
    }

    function headerIndex(table, re) {
        return [...table.querySelectorAll('thead th')].findIndex(th => re.test(th.textContent.trim()));
    }

    const ADAPTERS = [
        {
            id: 'capitalone',
            host: /(^|\.)capitalone\.com$/,
            strict: true,
            hint: 'Load older statements below.',
            currentBalance() {
                const label = [...document.querySelectorAll('.c1-ease-hero-numbers__label')]
                    .find(e => /current balance/i.test(e.textContent));
                const box = label && label.parentElement && label.parentElement.parentElement;
                if (!box) return null;
                const hidden = box.querySelector('.cdk-visually-hidden');
                return parseMoney(hidden ? hidden.textContent : box.textContent);
            },
            filtered() {
                const s = document.querySelector('.c1-ease-txns-search__input');
                return !!(s && s.value.trim());
            },
            rows() {
                const out = [];
                document.querySelectorAll('c1-ease-row').forEach(row => {
                    const date = row.querySelector('.cdk-column-date');
                    const amountEl = row.querySelector('.cdk-column-amount > span:not([data-cop])');
                    const a = amountEl && parseMoney(amountEl.textContent);
                    if (!date || a == null) return;
                    const pending = /pending/i.test(date.textContent);
                    // a scheduled future payment is not part of the balance yet
                    if (!pending && row.classList.contains('c1-ease-row--pending-schedule')) return;
                    out.push({
                        row, a, pending, amountEl, date: date.textContent,
                        isPayment: /payment|autopay/i.test(row.querySelector('.cdk-column-description')?.textContent || ''),
                        header: row.closest('c1-ease-table')?.querySelector('c1-ease-header-cell.cdk-column-amount'),
                    });
                });
                return out;
            },
            divider(row, content) {
                row.before(content);
                return content;
            },
        },
        {
            id: 'chase',
            host: /(^|\.)chase\.com$/,
            strict: false, // its date-range views leave out the newest posted charges
            hint: 'Set "Showing" to Year to date or All transactions, and use "See more activity".',
            currentBalance() {
                for (const e of document.querySelectorAll('h1, h2, h3, p, span, div, dt, dd')) {
                    if (e.children.length > 3 || e.textContent.length > 60) continue;
                    if (/^\s*current balance/i.test(e.textContent)) {
                        const v = parseMoney(e.textContent) ?? parseMoney(e.parentElement?.textContent || '');
                        if (v != null) return v;
                    }
                }
                return null;
            },
            filtered: () => false,
            rows() {
                const out = [];
                document.querySelectorAll('table.mds-activity-table').forEach(table => {
                    const pending = /^PENDING/i.test(table.id);
                    const col = headerIndex(table, /^amount/i);
                    const descCol = headerIndex(table, /^description/i);
                    const header = table.querySelectorAll('thead th')[col];
                    if (col < 0) return;
                    table.querySelectorAll('tbody tr').forEach(row => {
                        const cell = row.children[col];
                        const date = row.children[0];
                        const a = cell && parseMoney(cell.textContent);
                        if (a == null || !date) return;
                        const desc = row.children[descCol]?.textContent || '';
                        out.push({ row, a, pending, amountEl: cell, append: true, date: date.textContent, header,
                            isPayment: /payment/i.test(desc) && !/returned/i.test(desc) });
                    });
                });
                return out;
            },
            divider(row, content) {
                const tr = document.createElement('tr');
                tr.setAttribute('data-cop', '');
                const td = document.createElement('td');
                td.className = 'cop-divider-cell';
                td.colSpan = row.children.length;
                td.append(content);
                tr.append(td);
                row.before(tr);
                return tr;
            },
        },
    ];

    const adapter = ADAPTERS.find(a => a.host.test(location.hostname));
    if (!adapter) return;

    function el(tag, cls, text) {
        const e = document.createElement(tag);
        e.setAttribute('data-cop', '');
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    function clear() {
        document.querySelectorAll('[data-cop]:not(style)').forEach(e => e.remove());
        document.querySelectorAll('.cop-new, .cop-zero, .cop-old')
            .forEach(e => e.classList.remove('cop-new', 'cop-zero', 'cop-old'));
    }

    function hidden() {
        try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
    }

    function chip(parts) {
        if (hidden()) return;
        const c = el('div', 'cop-chip' + (parts.muted ? ' cop-chip--muted' : ''));
        c.append(el('div', 'cop-chip__label', parts.label));
        if (parts.total != null) c.append(el('div', 'cop-chip__total', parts.total));
        if (parts.sub) c.append(el('div', 'cop-chip__sub', parts.sub));
        if (parts.note) c.append(el('div', 'cop-chip__note', parts.note));
        if (parts.target) {
            const jump = el('button', 'cop-chip__jump', 'Jump to payoff ↓');
            jump.type = 'button';
            jump.addEventListener('click', () => parts.target.scrollIntoView({ behavior: 'smooth', block: 'center' }));
            c.append(jump);
        }
        const close = el('button', 'cop-chip__close', '×');
        close.type = 'button';
        close.title = 'Hide until this tab closes';
        close.addEventListener('click', () => {
            try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode: hide for now only */ }
            c.remove();
        });
        c.append(close);
        document.body.append(c);
    }

    function draw() {
        clear();
        const rows = adapter.rows();
        const posted = rows.filter(r => !r.pending), pending = rows.filter(r => r.pending);
        const current = adapter.currentBalance();
        if (!posted.length) return; // not a card activity view

        if (adapter.filtered()) {
            chip({ muted: true, label: 'Since last payoff', sub: 'Clear the search to see balances.' });
            return;
        }

        const strict = adapter.strict && current != null;
        const { balances, anchor, gap } = ledger(posted, current ?? 0, strict);
        // With a payoff found, balances count up from it; without one, they are
        // only meaningful when anchored to a known current balance.
        const shown = anchor >= 0 ? balances.map(b => b - gap) : current != null ? balances : null;
        const headers = new Set();
        posted.forEach((p, i) => {
            if (anchor >= 0) p.row.classList.add(i < anchor ? 'cop-new' : i === anchor ? 'cop-zero' : 'cop-old');
            if (shown) {
                const bal = el('span', 'cop-bal', 'bal ' + fmt(shown[i]));
                if (p.append) p.amountEl.append(bal); else p.amountEl.after(bal);
                if (p.header) headers.add(p.header);
            }
        });
        headers.forEach(h => h.append(el('span', 'cop-hbal', '/ balance')));

        const pendingTotal = pending.reduce((s, p) => s + p.a, 0);
        const pendingNote = pending.length ? ` · +${fmt(pendingTotal)} pending` : '';
        if (anchor < 0) {
            chip({ muted: true, label: 'Since last payoff', sub: 'No payoff in the loaded transactions. ' + adapter.hint });
            return;
        }

        pending.forEach(p => p.row.classList.add('cop-new'));
        const zero = posted[anchor];
        const when = shortDate(zero.date);
        const newTotal = shown[0]; // balance after the newest posted row, counted from the payoff
        const content = el('div', 'cop-divider');
        content.append(
            el('span', 'cop-pill cop-pill--new', `▲ New since payoff · ${fmt(newTotal)}`),
            el('span', 'cop-pill cop-pill--zero', `✓ Paid off · ${when}`),
        );
        const target = adapter.divider(zero.row, content);

        // In loose mode the list did not add up to the current balance; say by how much.
        const missing = current != null && !strict ? current - newTotal : 0;
        chip({
            label: `Since ${when} payoff`,
            total: fmt(newTotal),
            sub: `${anchor} new${pendingNote}`,
            note: Math.abs(missing) > CENT
                ? `Current balance is ${fmt(current)}: ${fmt(missing)} of recent activity is not in this list.`
                : '',
            target,
        });
    }

    const style = document.createElement('style');
    style.setAttribute('data-cop', '');
    style.textContent = CSS;
    document.head.append(style);

    let timer = 0;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(render, 200); };
    const observer = new MutationObserver(schedule);
    function render() {
        observer.disconnect();
        try { draw(); } finally {
            observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        }
    }
    document.addEventListener('input', schedule, true);
    render();
})();
