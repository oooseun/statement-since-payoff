# Card statements: since last payoff

A userscript for people who pay their credit card off in full. When you open your card's
activity page, it finds the last time you paid everything off and shows you what's new since then.

- A **"Paid off" line** marks the payment that took the balance to $0.
- **New rows** (everything since that payment, pending included) get a light green tint.
- **Already-paid rows** are dimmed. Hover over one to read it normally.
- A **running balance** appears under each amount.
- A **corner card** shows the total since the payoff, with a link that jumps to the line.

Supported: **Capital One** (`myaccounts.capitalone.com`) and **Chase** (`secure.chase.com`).

## Safe to run on a bank page

- It makes **no network requests** and asks for **no permissions** (`@grant none`).
- It only reads what is already on the page and adds a few labels and colors.
- It never clicks, submits or stores anything, apart from remembering in the tab's
  session storage that you closed the corner card.
- The whole script is one file of about 300 lines: [`statement-since-payoff.user.js`](statement-since-payoff.user.js).

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Open the [raw script](https://raw.githubusercontent.com/oooseun/statement-since-payoff/main/statement-since-payoff.user.js) and click **Install**.

## How it finds the payoff

It starts from the current balance and works backwards through the posted transactions,
working out the balance after each one.

- **Capital One:** the transaction list adds up exactly, so the payoff is the newest row
  where the balance comes to $0.00.
- **Chase:** its date-range views leave out the newest posted charges, so the list never quite
  reaches $0. The payoff is the newest payment that brought the balance to its lowest point.
  Returned payments don't count. When the list and the current balance disagree, the corner
  card says by how much.

On Chase, set **Showing** to *Year to date* or *All transactions* and use **See more activity**
until your last payoff is loaded. The default "since last statement" view usually has no payment in it.

While the Capital One search box is in use, balances are hidden, because a filtered list can't add up.

## Adding a bank

Each bank is one adapter in `ADAPTERS`, which tells the script how to read that bank's page:

- how to find the transaction rows,
- each row's date and amount,
- the current balance,
- where to put the line.

Pull requests for other banks are welcome. Please include a fixture test in `tests/`
built from the page's markup, with personal data replaced. Run `npm install && npm test`.

Bank sites change their markup without notice. If the line stops appearing, open an issue
and say which bank it is.

## License

MIT
