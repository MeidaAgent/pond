/**
 * Address lookup.
 *
 * Reads what any Robinhood Chain address holds and what it would unlock on Pond. No
 * wallet is connected and nothing is signed, which is the point: a person holding
 * tokenized equities in an app that cannot sign third party transactions can still see
 * what those holdings are worth here.
 *
 * Everything is public data, so this needs no permission from anyone.
 */

(function () {
  'use strict';

  const W = window.PondWeb3 || window.AcreWeb3;
  if (!W) return;

  const q = (sel) => document.querySelector(sel);

  const input = q('[data-address-input]');
  const button = q('[data-check]');
  const statusEl = q('[data-status]');
  const results = q('[data-results]');
  if (!input || !button || !results) return;

  const CONFIG = W.CONFIG;
  const UNIT_DASH = '\u2014';

  let busy = false;

  // ------------------------------------------------------------------
  // Presentation
  // ------------------------------------------------------------------

  function setStatus(message, tone) {
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.className = 'check-status' + (tone ? ' is-' + tone : '');
    statusEl.hidden = !message;
  }

  const usd = (wad) => '$' + W.formatUnits(wad, 18, 2);

  /**
   * Validates an address before spending a request on it.
   *
   * Checksum is deliberately not enforced. Plenty of interfaces display addresses in
   * lowercase, and rejecting those would fail people who copied a perfectly good address
   * from somewhere that happens not to checksum it.
   */
  function normalise(value) {
    const trimmed = String(value || '').trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return null;
    return trimmed;
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------

  function render(address, rows) {
    results.innerHTML = '';
    results.hidden = false;

    if (!rows.length) {
      const card = document.createElement('div');
      card.className = 'tcard';
      const p = document.createElement('p');
      p.className = 'reason';
      p.textContent = 'This address holds none of the tokenized equities Pond accepts. '
        + 'Currently accepted: ' + CONFIG.collateral.map((a) => a.symbol).join(', ') + '.';
      card.appendChild(p);
      results.appendChild(card);
      return;
    }

    const card = document.createElement('div');
    card.className = 'tcard unlock-card';

    const heading = document.createElement('h3');
    heading.textContent = 'What this address unlocks';
    card.appendChild(heading);

    const sub = document.createElement('p');
    sub.className = 'reason check-address';
    sub.textContent = address;
    card.appendChild(sub);

    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';

    const table = document.createElement('table');
    table.className = 'app-table unlock-table';

    const thead = document.createElement('thead');
    const hrow = document.createElement('tr');
    ['Asset', 'Holds', 'Value', 'Unlocks now', 'This weekend'].forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h;
      hrow.appendChild(th);
    });
    thead.appendChild(hrow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    let totalNow = 0n;
    let totalWeekend = 0n;

    rows.forEach((row) => {
      totalNow += row.unlockNow;
      totalWeekend += row.unlockWeekend;

      const tr = document.createElement('tr');

      const name = document.createElement('td');
      const sym = document.createElement('strong');
      sym.textContent = row.symbol;
      const full = document.createElement('span');
      full.className = 'reason';
      full.textContent = row.name || '';
      name.append(sym, document.createElement('br'), full);

      const held = document.createElement('td');
      held.textContent = W.formatUnits(row.balance, row.decimals, 4);

      const value = document.createElement('td');
      value.textContent = usd(row.value);

      const now = document.createElement('td');
      now.className = 'unlock-figure';
      now.textContent = usd(row.unlockNow);

      const weekend = document.createElement('td');
      weekend.className = 'unlock-figure is-muted';
      weekend.textContent = usd(row.unlockWeekend);

      tr.append(name, held, value, now, weekend);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    card.appendChild(wrap);

    // What holding POND would add. Shown here because this page is reachable by someone
    // whose wallet cannot sign, and the rebate is the one part of Pond that rewards
    // simply holding a token, which such a wallet can do.
    if (CONFIG.contracts && CONFIG.contracts.supplyRebate
        && !/^0x0{40}$/i.test(CONFIG.contracts.supplyRebate)) {
      const boost = document.createElement('p');
      boost.className = 'reason check-boost';
      boost.textContent = 'Supplying any of this while holding POND earns a higher rate, '
        + 'funded from the protocol\u2019s own fee rather than from other suppliers.';
      card.appendChild(boost);
    }

    const summary = document.createElement('p');
    summary.className = 'field-preview';

    const drop = totalNow > 0n
      ? Number(((totalNow - totalWeekend) * 10000n) / totalNow) / 100
      : 0;

    summary.textContent = 'Together these would allow borrowing up to ' + usd(totalNow)
      + ' right now'
      + (drop > 0.5
          ? ', falling to ' + usd(totalWeekend) + ' across the weekend, about '
            + drop.toFixed(0) + '% less, because the market backing them is closed.'
          : '.')
      + ' Borrowing puts the collateral at risk of liquidation if the price falls far '
      + 'enough, and interest accrues until it is repaid.';
    card.appendChild(summary);

    results.appendChild(card);
  }

  // ------------------------------------------------------------------
  // Lookup
  // ------------------------------------------------------------------

  async function check(rawAddress, options) {
    if (busy) return;

    const address = normalise(rawAddress);
    if (!address) {
      setStatus('That does not look like an address. It should start with 0x and be '
        + '42 characters long.', 'error');
      results.hidden = true;
      return;
    }

    if (!W.isConfigured()) {
      setStatus('Pond is not deployed on this network yet.', 'error');
      return;
    }

    busy = true;
    button.disabled = true;
    setStatus('Reading holdings\u2026', 'pending');

    try {
      const rows = await W.readUnlockable(address, CONFIG.collateral);
      render(address, rows);
      setStatus('', null);

      // The address goes into the URL so the result can be shared or reloaded. Done with
      // replaceState rather than a navigation, so the back button still leaves the page
      // rather than stepping through every address that was checked.
      if (!options || !options.fromUrl) {
        const url = new URL(window.location.href);
        url.searchParams.set('address', address);
        window.history.replaceState({}, '', url);
      }
    } catch (error) {
      results.hidden = true;
      setStatus('Could not read that address. ' + W.describeError(error), 'error');
    } finally {
      busy = false;
      button.disabled = false;
    }
  }

  // ------------------------------------------------------------------
  // Wiring
  // ------------------------------------------------------------------

  button.addEventListener('click', () => check(input.value));

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') check(input.value);
  });

  // A shared link should show its result without anyone pressing anything.
  const initial = new URL(window.location.href).searchParams.get('address');
  if (initial) {
    input.value = initial;
    check(initial, { fromUrl: true });
  }
})();
