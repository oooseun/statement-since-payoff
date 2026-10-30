const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '..', 'statement-since-payoff.user.js'), 'utf8');
const url = 'https://myaccounts.capitalone.com/Card/abc=';
const chaseUrl = 'https://secure.chase.com/web/auth/dashboard#/dashboard/summary/1/CARD/BAC';

// Mirrors the live Angular markup (2026-10-29): hero balance with a visually hidden
// exact figure, and c1-ease-table rows whose amount cell starts with the amount span.
const hero = bal => `<c1-ease-account-details-top-middle-grid-cell><div><div>
    <c1-ease-currency-label><p class="c1-ease-hero-numbers__label">Current balance</p></c1-ease-currency-label>
    <c1-ease-currency><div aria-hidden="true">$150<span>00</span></div><div class="cdk-visually-hidden">${bal}</div></c1-ease-currency>
    </div></div></c1-ease-account-details-top-middle-grid-cell>`;
const row = (date, desc, amount, cls = '') => `<c1-ease-row class="c1-ease-table__row ${cls}">
    <c1-ease-cell class="cdk-column-caret"></c1-ease-cell>
    <c1-ease-cell class="cdk-column-date">${date}</c1-ease-cell>
    <c1-ease-cell class="cdk-column-description">${desc}</c1-ease-cell>
    <c1-ease-cell class="cdk-column-amount"><span>${amount}</span><span class="c1-ease-card-transactions-view-table__amount--card"> Card ...0000 </span></c1-ease-cell>
    </c1-ease-row>`;
const table = rows => `<c1-ease-table><c1-ease-header-row><c1-ease-header-cell class="cdk-column-amount">Amount</c1-ease-header-cell></c1-ease-header-row><div>${rows.join('')}</div></c1-ease-table>`;
const search = (value = '') => `<input class="c1-ease-txns-search__input" value="${value}">`;

const page = ({ bal = '$150.00', value = '', older = true } = {}) => hero(bal) + search(value) +
    table([row('Nov 12', 'AutoPay', '-$35.00', 'c1-ease-row--pending-schedule')]) +
    table([row('Pending', 'Cafe', '$9.99', 'c1-ease-row--pending-schedule')]) +
    table([row('Oct 29', 'Groceries', '$100.00'), row('Oct 28', 'Refund', '-$50.00'), row('Oct 27', 'Fuel', '$100.00')]) +
    table([row('Oct 05', 'Payment from bank', '-$500.00'), ...(older ? [row('Oct 03', 'Dinner', '$500.00')] : [])]);

function setup(t, opts) {
    const dom = new JSDOM(`<html><head></head><body>${page(opts)}</body></html>`, { url, runScripts: 'outside-only', pretendToBeVisual: true });
    t.after(() => dom.window.close());
    dom.window.eval(source);
    const d = dom.window.document;
    const byDesc = desc => [...d.querySelectorAll('c1-ease-row')].find(r => r.textContent.includes(desc));
    return { d, byDesc, bal: desc => byDesc(desc).querySelector('.cop-bal')?.textContent };
}

test('marks the newest $0 point and splits new from settled rows', t => {
    const h = setup(t);
    assert.ok(h.byDesc('Payment from bank').classList.contains('cop-zero'));
    for (const d of ['Groceries', 'Refund', 'Fuel', 'Cafe']) assert.ok(h.byDesc(d).classList.contains('cop-new'), d);
    assert.ok(h.byDesc('Dinner').classList.contains('cop-old'));
    assert.equal(h.byDesc('AutoPay').className.includes('cop-'), false, 'scheduled payments are left alone');
});

test('running balance walks back from the current balance', t => {
    const h = setup(t);
    assert.equal(h.bal('Groceries'), 'bal $150.00');
    assert.equal(h.bal('Refund'), 'bal $50.00');
    assert.equal(h.bal('Fuel'), 'bal $100.00');
    assert.equal(h.bal('Payment from bank'), 'bal $0.00');
    assert.equal(h.bal('Dinner'), 'bal $500.00');
    assert.equal(h.bal('Cafe'), undefined, 'pending rows are not in the balance yet');
});

test('divider sits directly above the payoff row and the chip totals what is new', t => {
    const h = setup(t);
    const divider = h.d.querySelector('.cop-divider');
    assert.equal(divider.nextElementSibling, h.byDesc('Payment from bank'));
    assert.match(divider.textContent, /New since payoff · \$150\.00/);
    assert.match(divider.textContent, /Paid off · Oct 5/);
    const chip = h.d.querySelector('.cop-chip');
    assert.match(chip.textContent, /Since Oct 5 payoff/);
    assert.match(chip.textContent, /3 new · \+\$9\.99 pending/);
    assert.equal(h.d.querySelectorAll('.cop-hbal').length, 2, 'balance label on each posted table only');
});

test('no tinting when no $0 point is loaded, but balances still show', t => {
    const h = setup(t, { bal: '$170.00' });
    assert.equal(h.d.querySelectorAll('.cop-new, .cop-old, .cop-zero, .cop-divider').length, 0);
    assert.equal(h.bal('Groceries'), 'bal $170.00');
    assert.match(h.d.querySelector('.cop-chip').textContent, /No payoff in the loaded transactions/);
});

test('an active search hides balances, since filtered rows would make them wrong', t => {
    const h = setup(t, { value: 'fuel' });
    assert.equal(h.d.querySelectorAll('.cop-bal, .cop-new').length, 0);
    assert.match(h.d.querySelector('.cop-chip').textContent, /Clear the search/);
});

test('re-running does not duplicate decorations', async t => {
    const h = setup(t);
    h.byDesc('Dinner').querySelector('.cdk-column-description').textContent = 'Dinner out';
    await new Promise(r => setTimeout(r, 300));
    assert.equal(h.d.querySelectorAll('.cop-divider').length, 1);
    assert.equal(h.d.querySelectorAll('.cop-chip').length, 1);
    assert.equal(h.byDesc('Groceries').querySelectorAll('.cop-bal').length, 1);
});

// Chase (2026-10-29): mds-activity-table rows, the first row of a day says "Oct 5, 2026",
// later ones "10/05/2026"; credits use a real minus sign; the date-range views leave out
// the newest posted charges, so the list does not add up to the current balance.
const chaseRow = (date, desc, amount, cat = 'Shopping') =>
    `<tr class="mds-activity-table__row"><th>${date}</th><td>${desc}</td><td>${cat}</td><td class="mds-activity-table__row-value--right">${amount}</td><td></td></tr>`;
const chasePage = rows => `<p>Current balance $344.12</p>
    <table id="PENDING-dataTableId-mds-diy-data-table" class="mds-activity-table"><thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Action</th></tr></thead>
    <tbody><tr><th>Oct 29, 2026</th><td>Amazon.com</td><td>$43.95</td><td></td></tr></tbody></table>
    <table id="ACTIVITY-dataTableId-mds-diy-data-table" class="mds-activity-table"><thead><tr>
    <th>Date, not sortedDate</th><th>Description, not sortedDescription</th><th>Category</th><th>Amount, not sortedAmount</th><th>Action</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table>`;
const chaseHistory = [
    chaseRow('Oct 27, 2026', 'Amazon Marketplace', '$100.00'),
    chaseRow('10/08/2026', 'Payment Thank You - 2nd A', '\u2212$300.00', '\u2014'),
    chaseRow('Oct 6, 2026', 'Hardware store', '$40.00'),
    chaseRow('Oct 5, 2026', 'Returned Payment', '$300.00', '\u2014'),
    chaseRow('10/05/2026', 'Payment Thank You - Web', '\u2212$300.00', '\u2014'),
    chaseRow('Oct 3, 2026', 'Groceries', '$300.00'),
    chaseRow('Sep 30, 2026', 'Payment Thank You-Mobile', '\u2212$250.00', '\u2014'),
    chaseRow('Sep 20, 2026', 'Dinner', '$250.00'),
];

function setupChase(t, rows = chaseHistory) {
    const dom = new JSDOM(`<html><head></head><body>${chasePage(rows)}</body></html>`, { url: chaseUrl, runScripts: 'outside-only', pretendToBeVisual: true });
    t.after(() => dom.window.close());
    dom.window.eval(source);
    const d = dom.window.document;
    const byDesc = desc => [...d.querySelectorAll('#ACTIVITY-dataTableId-mds-diy-data-table tbody tr')].find(r => r.textContent.includes(desc));
    return { d, byDesc, bal: desc => byDesc(desc).querySelector('.cop-bal')?.textContent };
}

test('chase: payoff is the newest payment at the lowest balance, ignoring the returned one', t => {
    const h = setupChase(t);
    assert.ok(h.byDesc('Payment Thank You - Web').classList.contains('cop-zero'));
    for (const d of ['Amazon Marketplace', '2nd A', 'Hardware store', 'Returned Payment']) assert.ok(h.byDesc(d).classList.contains('cop-new'), d);
    for (const d of ['Groceries', 'Payment Thank You-Mobile', 'Dinner']) assert.ok(h.byDesc(d).classList.contains('cop-old'), d);
});

test('chase: balances count up from the payoff, and the chip names the missing amount', t => {
    const h = setupChase(t);
    assert.equal(h.bal('Payment Thank You - Web'), 'bal $0.00');
    assert.equal(h.bal('Returned Payment'), 'bal $300.00');
    assert.equal(h.bal('Hardware store'), 'bal $340.00');
    assert.equal(h.bal('2nd A'), 'bal $40.00');
    assert.equal(h.bal('Amazon Marketplace'), 'bal $140.00');
    const chip = h.d.querySelector('.cop-chip').textContent;
    assert.match(chip, /Since Oct 5 payoff/);
    assert.match(chip, /\$140\.00/);
    assert.match(chip, /4 new · \+\$43\.95 pending/);
    assert.match(chip, /\$204\.12 of recent activity is not in this list/);
});

test('chase: the divider is a full-width table row above the payoff', t => {
    const h = setupChase(t);
    const tr = h.byDesc('Payment Thank You - Web').previousElementSibling;
    assert.equal(tr.tagName, 'TR');
    assert.equal(tr.querySelector('td').colSpan, 5);
    assert.match(tr.textContent, /Paid off · Oct 5/);
    assert.equal(h.d.querySelectorAll('.cop-hbal').length, 1);
});

test('chase: "since last statement" view with no payments explains how to find one', t => {
    const h = setupChase(t, chaseHistory.slice(0, 1));
    assert.equal(h.d.querySelectorAll('.cop-new, .cop-zero, .cop-divider').length, 0);
    assert.match(h.d.querySelector('.cop-chip').textContent, /Year to date or All transactions/);
});
