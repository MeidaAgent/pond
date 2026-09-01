/**
 * Pond application logic.
 *
 * Reads pool and position state from chain, renders it, and executes supply, borrow,
 * repay, withdraw and collateral actions. Depends on acre-web3.js and acre-config.js.
 *
 * Design notes worth knowing before editing:
 *
 * Read state never requires a wallet. Anyone can see pool rates, utilisation and caps
 * without connecting anything. A wallet is required only to see your own position and
 * to act. Requiring a connection before showing any information is a pattern that
 * teaches people to connect wallets to sites they have not evaluated, which is a habit
 * worth not encouraging.
 *
 * Amounts are handled as BigInt in base units throughout. The only place a decimal
 * string appears is at the boundary with an input field or a rendered label. Floating
 * point arithmetic on token amounts loses precision at values users actually hold.
 */

(function () {
  'use strict';

  const W = window.PondWeb3 || window.AcreWeb3;
  if (!W) return;

  const q = (sel, root) => (root || document).querySelector(sel);
  const qa = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const app = q('[data-app]');
  if (!app) return;

  const CONFIG = W.CONFIG;
  const deployed = W.isConfigured();

  const state = {
    account: null,
    onCorrectChain: false,
    totals: null,
    caps: null,
    position: null,
    paused: { supply: false, borrow: false },
    collateral: new Map(),   // address -> { amount, value, walletBalance, allowance }
    walletLoanBalance: 0n,
    buffer: 0n,
    plan: null,
    deleverage: { repayable: 0n, due: false },
    series: [],
    legacy: [],
    unlockable: [],
    rebate: null,
    rebateSolvency: null,
    transfers: null,
    // Whose addresses are shown. Defaults to the connected wallet, but can be any address,
    // because the people this exists for cannot connect one.
    transfersFor: null,
    loanAllowance: 0n,
    loading: false,
    connecting: false,
    lastError: null
  };

  // ------------------------------------------------------------------
  // Formatting
  // ------------------------------------------------------------------

  const DASH = '\u2014';

  /// Protection units are denominated in WAD regardless of what the loan token uses.
  /// Named rather than written as a bare 18, so it is clear this is a property of the
  /// unit and not a stale assumption about USDG, which uses six.
  const UNIT_DECIMALS = 18;

  const usd = (wadValue) => {
    if (wadValue === null || wadValue === undefined) return DASH;
    return '$' + W.formatUnits(wadValue, 18, 2);
  };

  const amount = (value, decimals, places) => {
    if (value === null || value === undefined) return DASH;
    return W.formatUnits(value, decimals === undefined ? 18 : decimals, places);
  };

  const percent = (wadValue, places) => {
    if (wadValue === null || wadValue === undefined) return DASH;
    const n = Number(wadValue) / 1e16;
    return n.toFixed(places === undefined ? 1 : places) + '%';
  };

  const shortAddress = (addr) =>
    addr ? addr.slice(0, 6) + '\u2026' + addr.slice(-4) : DASH;

  // ------------------------------------------------------------------
  // Status messaging
  // ------------------------------------------------------------------

  function setStatus(message, tone) {
    const bar = q('[data-status]');
    if (!bar) return;

    bar.textContent = message || '';
    bar.className = 'app-status' + (tone ? ' is-' + tone : '');
    bar.hidden = !message;
  }

  function clearStatus() {
    setStatus('', null);
  }

  // ------------------------------------------------------------------
  // Loading state
  // ------------------------------------------------------------------

  function setBusy(busy) {
    state.loading = busy;
    app.classList.toggle('is-busy', busy);
    qa('[data-action]').forEach((button) => {
      button.disabled = busy || !canAct(button.dataset.action);
    });
  }

  /** Whether an action is currently possible, independent of a busy state. */
  function canAct(action) {
    if (!deployed) return false;
    if (state.connecting) return false;
    if (!state.account || !state.onCorrectChain) return false;
    if (action === 'supply' && state.paused.supply) return false;
    if (action === 'borrow' && state.paused.borrow) return false;
    return true;
  }

  // ------------------------------------------------------------------
  // Reading chain state
  // ------------------------------------------------------------------

  async function refresh() {
    if (!deployed) {
      renderPreview();
      return;
    }

    const first = state.position === null && state.account;
    if (first) setStatus('Loading\u2026', 'pending');

    try {
      // One batched request for everything. Previously this was around twenty five
      // separate HTTP requests every twenty seconds, which a public endpoint rate
      // limits, surfacing in the browser as an unexplained "Failed to fetch".
      const account = state.account && state.onCorrectChain ? state.account : null;
      const data = await W.readEverything(account, CONFIG.collateral);

      state.totals = data.totals;
      state.caps = data.caps;
      state.paused = data.paused;

      if (account && data.position) {
        // Debt is denominated in the loan token; the limits are in dollars. Convert so
        // the two can be compared.
        const scale = 10n ** BigInt(18 - CONFIG.loanToken.decimals);
        data.position.debtValueForLimit = data.position.debt * scale;

        // Supply shares convert to assets against the pool ledger.
        data.position.supplyAssets = data.totals.supplied === 0n || data.position.supplyShares === 0n
          ? 0n
          : await W.pool.convertToAssets(data.position.supplyShares).catch(() => 0n);

        state.position = data.position;
        state.walletLoanBalance = data.walletLoanBalance;
        state.loanAllowance = data.loanAllowance;
        state.buffer = data.buffer || 0n;
        state.plan = data.plan;
        state.deleverage = data.deleverage || { repayable: 0n, due: false };

        state.collateral.clear();
        data.collateral.forEach((row) => state.collateral.set(row.address, row));
      }

      // Series are read separately because the count is unknown until the first call,
      // and a failure here must not blank the lending views.
      if (W.outcome.configured) {
        state.series = await W.outcome.readAll(account).catch(() => state.series);
      }

      // Positions in previous deployments. Read separately, and a failure here must never
      // affect the current one.
      if (account) {
        state.legacy = await W.readLegacy(account).catch(() => state.legacy);
        state.unlockable = await W.readUnlockable(account).catch(() => state.unlockable);

        if (W.deposits.configured && !state.transfersFor) {
          state.transfers = await W.deposits.holdings(account).catch(() => state.transfers);
        }

        if (W.rebate.configured) {
          state.rebate = await W.rebate.statusOf(account).catch(() => state.rebate);
          state.rebateSolvency = await W.rebate.solvency().catch(() => state.rebateSolvency);
        }
      }

      state.lastError = null;
      if (first) clearStatus();
    } catch (error) {
      state.lastError = W.describeError(error);
      setStatus('Could not reach the network. Retrying\u2026 (' + state.lastError + ')', 'error');
    }

    render();
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------

  function render() {
    renderConnection();
    renderPool();
    renderPosition();
    renderCollateralTable();
    renderHealth();
    renderPreviews();
    renderDeleverage();
    renderSeries();
    renderLegacy();
    renderUnlockable();
    renderRebate();
    setBusy(state.loading);
  }

  function renderConnection() {
    const label = q('[data-wallet-address]');
    const button = q('[data-connect]');
    const chainWarning = q('[data-chain-warning]');

    if (label) label.textContent = state.account ? shortAddress(state.account) : 'Not connected';

    const network = q('[data-network-status]');
    if (network) {
      if (!state.account) network.textContent = CONFIG.chainName;
      else if (state.onCorrectChain) network.textContent = CONFIG.chainName;
      else network.textContent = 'Wrong network';
    }

    if (button) {
      // While a wallet request is in flight the button must not be rewritten by the
      // twenty second refresh. Doing so made it appear to flicker between states, and it
      // let a second click through, which wallets reject with "request already pending".
      if (state.connecting) {
        button.textContent = 'Check your wallet\u2026';
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
      } else if (!W.wallet.isAvailable()) {
        // A browser with no injected provider cannot connect at all. Say so on the
        // button rather than leaving it clickable and failing on press.
        button.textContent = 'No wallet detected';
        button.disabled = true;
        button.title = 'Install a browser wallet extension to connect.';
        button.removeAttribute('aria-busy');
      } else if (!state.account) {
        button.textContent = 'Connect wallet';
        button.disabled = false;
        button.removeAttribute('aria-busy');
      } else if (!state.onCorrectChain) {
        button.textContent = 'Switch network';
        button.disabled = false;
        button.removeAttribute('aria-busy');
      } else {
        // Connected and on the right chain. Showing the address is more useful than a
        // disabled control reading "Connected".
        button.textContent = shortAddress(state.account);
        button.disabled = false;
        button.title = 'Connected to ' + CONFIG.chainName;
        button.removeAttribute('aria-busy');
      }
    }

    if (chainWarning) {
      chainWarning.hidden = !state.account || state.onCorrectChain;
    }
  }

  function renderPool() {
    const t = state.totals;
    const c = state.caps;

    setText('[data-pool-supplied]', t ? amount(t.supplied, CONFIG.loanToken.decimals, 0) + ' ' + CONFIG.loanToken.symbol : DASH);
    setText('[data-pool-borrowed]', t ? amount(t.borrowed, CONFIG.loanToken.decimals, 0) + ' ' + CONFIG.loanToken.symbol : DASH);
    setText('[data-pool-utilization]', t ? percent(t.utilization) : DASH);

    if (t) {
      const borrowApr = W.annualisedPercent(t.borrowRatePerSecond);
      setText('[data-borrow-apr]', borrowApr.toFixed(2) + '%');

      // Suppliers receive the borrow rate scaled by utilisation, less the reserve factor.
      const util = Number(t.utilization) / 1e18;
      const supplyApr = borrowApr * util * 0.95;
      setText('[data-supply-apr]', supplyApr.toFixed(2) + '%');
    } else {
      setText('[data-borrow-apr]', DASH);
      setText('[data-supply-apr]', DASH);
    }

    // Cash on hand is what a borrower can actually draw right now. The borrow cap and
    // the collateral limit are separate ceilings, and quoting either as "available"
    // would promise liquidity that may not exist.
    if (t) {
      setText('[data-pool-liquidity]', amount(t.cash, CONFIG.loanToken.decimals, 2));
    }

    if (c) {
      setText('[data-supply-headroom]', amount(c.supplyHeadroom, CONFIG.loanToken.decimals, 0));
      setText('[data-supply-cap]', c.supplyCap === 0n ? 'No cap' : amount(c.supplyCap, CONFIG.loanToken.decimals, 0));
      setText('[data-borrow-headroom]', amount(c.borrowHeadroom, CONFIG.loanToken.decimals, 0));
    }

    const pausedNotice = q('[data-paused-notice]');
    if (pausedNotice) {
      const messages = [];
      if (state.paused.supply) messages.push('New deposits are paused.');
      if (state.paused.borrow) messages.push('New borrowing is paused.');
      pausedNotice.textContent = messages.join(' ');
      pausedNotice.hidden = messages.length === 0;
    }
  }

  function renderPosition() {
    const p = state.position;

    setText('[data-my-supply]', p ? amount(p.supplyAssets, CONFIG.loanToken.decimals, 2) + ' ' + CONFIG.loanToken.symbol : DASH);
    setText('[data-my-debt]', p ? amount(p.debt, CONFIG.loanToken.decimals, 2) + ' ' + CONFIG.loanToken.symbol : DASH);
    setText('[data-my-collateral-value]', p ? usd(p.collateralValue) : DASH);
    setText('[data-my-borrow-limit]', p ? usd(p.borrowLimit) : DASH);

    // A borrow limit of zero is correct with no collateral, but as a bare figure it
    // reads like a fault. Say why, because the asset you lend and the asset you borrow
    // against are different and that is not obvious.
    const limitNote = q('[data-borrow-limit-note]');
    if (limitNote) {
      if (!state.account) {
        limitNote.textContent = 'Connect a wallet to see your limit.';
      } else if (!p || p.collateralValue === 0n) {
        limitNote.textContent = 'Post collateral below to borrow. USDG is what you lend; '
          + 'tokenized equities are what you borrow against.';
      } else {
        limitNote.textContent = 'Moves with the market clock.';
      }
    }
    setText('[data-my-liquidation-limit]', p ? usd(p.liquidationLimit) : DASH);
    setText('[data-wallet-balance]',
      state.account ? amount(state.walletLoanBalance, CONFIG.loanToken.decimals, 2) : DASH);

    // What can actually be borrowed right now, after the clock, the caps and existing
    // debt are all taken into account. Users should not have to derive this.
    if (p && state.caps) {
      const used = p.debtValueForLimit || 0n;
      let headroom = p.borrowLimit > used ? p.borrowLimit - used : 0n;
      let inTokens = headroom / (10n ** BigInt(18 - CONFIG.loanToken.decimals));
      if (state.caps.borrowHeadroom < inTokens) inTokens = state.caps.borrowHeadroom;
      setText('[data-borrow-available]', amount(inTokens, CONFIG.loanToken.decimals, 2));
    } else {
      setText('[data-borrow-available]', DASH);
    }
  }

  /// The collateral table appears on both the Borrow and Markets views, so every
  /// instance is populated rather than only the first.
  function renderCollateralTable() {
    const bodies = qa('[data-collateral-rows]');
    if (!bodies.length) return;

    bodies.forEach((body) => {
      body.innerHTML = '';

      if (!CONFIG.collateral.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 4;
        cell.className = 'empty';
        cell.textContent = 'No collateral assets configured yet.';
        row.appendChild(cell);
        body.appendChild(row);
        return;
      }

      CONFIG.collateral.forEach((asset) => {
        const held = state.collateral.get(asset.address);
        const row = document.createElement('tr');

        // Built with createElement rather than innerHTML so a symbol or name from
        // configuration can never be interpreted as markup.
        const name = document.createElement('td');
        const symbol = document.createElement('strong');
        symbol.textContent = asset.symbol;
        const full = document.createElement('span');
        full.className = 'reason';
        full.textContent = asset.name || '';
        name.append(symbol, document.createElement('br'), full);

        const posted = document.createElement('td');
        posted.textContent = held ? amount(held.posted, asset.decimals, 4) : DASH;

        const value = document.createElement('td');
        value.textContent = held ? usd(held.value) : DASH;

        const inWallet = document.createElement('td');
        inWallet.textContent = held ? amount(held.walletBalance, asset.decimals, 4) : DASH;

        row.append(name, posted, value, inWallet);
        body.appendChild(row);
      });
    });
  }

  /**
   * The health bar. Shows debt against the liquidation limit, with the borrow limit
   * marked, so the distance between "cannot borrow more" and "can be liquidated" is
   * visible rather than implied. Never communicated by colour alone.
   */
  function renderHealth() {
    const p = state.position;
    const fill = q('[data-health-fill]');
    const marker = q('[data-health-marker]');
    const label = q('[data-health-label]');

    // With no collateral there is no scale to draw against. Hide the marker rather than
    // leaving it at zero percent, where it sits on top of the track's left edge and its
    // caption runs outside the card.
    if (!fill || !p || p.liquidationLimit === 0n) {
      if (fill) fill.style.width = '0%';
      if (marker) marker.hidden = true;
      if (label) {
        label.textContent = p && p.debt === 0n ? 'No debt' : DASH;
        label.className = 'health-label' + (p && p.debt === 0n ? ' is-safe' : '');
      }
      return;
    }

    // Debt as a fraction of the liquidation limit. Compared in dollar terms, since the
    // limit is a dollar figure and the raw debt is in loan token units.
    const debtValue = p.debtValueForLimit || 0n;
    const ratio = Number((debtValue * 10000n) / p.liquidationLimit) / 10000;
    const width = Math.max(0, Math.min(1, ratio)) * 100;
    fill.style.width = width.toFixed(1) + '%';

    if (marker) {
      const markerAt = Number((p.borrowLimit * 10000n) / p.liquidationLimit) / 100;
      // Keep the caption inside the card at both extremes.
      const clamped = Math.max(4, Math.min(96, markerAt));
      marker.style.left = clamped.toFixed(1) + '%';
      marker.hidden = false;
    }

    let text;
    let tone;
    if (debtValue === 0n) { text = 'No debt'; tone = 'safe'; }
    else if (p.liquidatable) { text = 'Liquidatable'; tone = 'danger'; }
    else if (ratio > 0.9) { text = 'Very close to liquidation'; tone = 'danger'; }
    else if (ratio > 0.75) { text = 'Approaching liquidation'; tone = 'warn'; }
    else { text = 'Healthy'; tone = 'safe'; }

    if (label) {
      label.textContent = text + ' \u00b7 ' + (ratio * 100).toFixed(1) + '% of limit';
      label.className = 'health-label is-' + tone;
    }
  }

  function renderPreview() {
    // Not deployed. Every panel still renders so the interface can be evaluated,
    // and the reason is stated once rather than on every control.
    const notice = q('[data-preview-notice]');
    if (notice) notice.hidden = false;
    render();
  }

  /// Updates every element matching the selector, not just the first.
  ///
  /// Several readouts appear in more than one view: your supply figure is on both the
  /// Supply and Positions tabs, the pool totals are on both Supply and Markets. Using
  /// querySelector here would update the first instance and leave every other tab
  /// showing a dash forever, which is exactly what happened before this was fixed.
  /**
   * Live previews under the amount fields.
   *
   * The point of a lending market is what happens if you commit an amount, and the
   * interface previously made people work that out for themselves. These update as the
   * user types, before any wallet is involved, so the consequence of an action is
   * visible before it is taken rather than after.
   */
  /**
   * The deleverage panel.
   *
   * States a borrower needs to tell apart: no plan, a plan with no money behind it, a
   * plan that is armed and waiting, and a plan that is due right now. A plan set up but
   * unfunded does nothing, and saying so is the difference between a feature and a
   * false sense of security.
   */
  function renderDeleverage() {
    const el = q('[data-plan-status]');
    setText('[data-buffer-balance]', state.account
      ? amount(state.buffer, CONFIG.loanToken.decimals, 2)
      : DASH);

    // Reflect the saved plan in the controls, so the panel shows what is actually set
    // rather than whatever the defaults happen to be.
    if (state.plan && state.plan.enabled) {
      const target = q('[data-plan-target]');
      const lead = q('[data-plan-lead]');
      if (target) target.value = String(state.plan.targetBps);
      if (lead) lead.value = String(state.plan.leadSeconds);
    }

    if (!el) return;

    if (!state.account) {
      el.hidden = true;
      return;
    }

    if (!state.plan || !state.plan.enabled) {
      el.textContent = 'No plan set. Your position will carry its current leverage through '
        + 'the weekend gap.';
      el.className = 'field-preview';
      el.hidden = false;
      return;
    }

    const targetPct = (state.plan.targetBps / 100).toFixed(0);
    const leadText = state.plan.leadSeconds >= 3600
      ? (state.plan.leadSeconds / 3600) + ' hour' + (state.plan.leadSeconds > 3600 ? 's' : '')
      : (state.plan.leadSeconds / 60) + ' minutes';

    if (state.buffer === 0n) {
      // The failure that would otherwise be silent: a plan with nothing behind it.
      el.textContent = 'Plan set, but the buffer is empty, so nothing will happen. Add USDG '
        + 'above to fund it.';
      el.className = 'field-preview is-warn';
    } else if (state.deleverage.due) {
      el.textContent = 'Due now. About '
        + amount(state.deleverage.repayable, CONFIG.loanToken.decimals, 2)
        + ' USDG will be repaid from your buffer. Anyone can execute it, or you can below.';
      el.className = 'field-preview';
    } else {
      el.textContent = 'Armed. ' + leadText + ' before the close, your debt will be reduced to '
        + targetPct + '% of your liquidation limit using the buffer.';
      el.className = 'field-preview';
    }
    el.hidden = false;
  }

  function renderPreviews() {
    renderSupplyPreview();
    renderBorrowPreview();
  }

  function readInput(selector, decimals) {
    const input = q(selector);
    if (!input || !input.value.trim()) return null;
    try {
      return W.parseUnits(input.value.trim(), decimals);
    } catch (_) {
      return null;
    }
  }

  function renderSupplyPreview() {
    const el = q('[data-supply-preview]');
    if (!el) return;

    const value = readInput('[data-supply-amount]', CONFIG.loanToken.decimals);
    if (!value || value === 0n || !state.totals) {
      el.textContent = '';
      el.hidden = true;
      return;
    }

    // Supplier yield is the borrow rate scaled by utilisation, less the reserve factor.
    // Adding this deposit lowers utilisation, so the projection uses the rate that would
    // apply afterwards rather than the current one. Overstating a return by ignoring
    // your own dilution would be the easiest possible way to mislead someone here.
    const newSupply = state.totals.supplied + value;
    const borrowed = state.totals.borrowed;
    const utilAfter = newSupply === 0n ? 0 : Number((borrowed * 10000n) / newSupply) / 10000;
    const borrowApr = W.annualisedPercent(state.totals.borrowRatePerSecond);
    const supplyApr = borrowApr * utilAfter * 0.95;

    const yearly = (Number(value) / 10 ** CONFIG.loanToken.decimals) * (supplyApr / 100);

    if (borrowed === 0n) {
      el.textContent = 'Nothing is borrowed yet, so this would earn nothing until it is. '
        + 'Supplier yield comes from borrower interest, not from emissions.';
    } else {
      el.textContent = 'At the current rate this would earn about '
        + supplyApr.toFixed(2) + '% a year, roughly $'
        + yearly.toFixed(2) + '. The rate moves with borrowing demand and is highest '
        + 'when the underlying market is shut.';
    }
    el.hidden = false;
  }

  function renderBorrowPreview() {
    const el = q('[data-borrow-preview]');
    if (!el) return;

    const value = readInput('[data-borrow-amount]', CONFIG.loanToken.decimals);
    const p = state.position;

    if (!value || value === 0n || !p || p.liquidationLimit === 0n) {
      el.textContent = '';
      el.hidden = true;
      return;
    }

    // Convert the requested amount into the dollar terms the limits are expressed in.
    const scale = 10n ** BigInt(18 - CONFIG.loanToken.decimals);
    const addedValue = value * scale;
    const projectedDebt = (p.debtValueForLimit || 0n) + addedValue;

    if (projectedDebt > p.borrowLimit) {
      el.textContent = 'That exceeds your borrow limit of ' + usd(p.borrowLimit)
        + '. Post more collateral, or borrow less.';
      el.className = 'field-preview is-warn';
      el.hidden = false;
      return;
    }

    const ratio = Number((projectedDebt * 10000n) / p.liquidationLimit) / 100;
    const borrowApr = W.annualisedPercent(state.totals ? state.totals.borrowRatePerSecond : 0n);
    const yearly = (Number(value) / 10 ** CONFIG.loanToken.decimals) * (borrowApr / 100);

    el.textContent = 'This would take you to ' + ratio.toFixed(1)
      + '% of your liquidation threshold, and cost about ' + borrowApr.toFixed(2)
      + '% a year, roughly $' + yearly.toFixed(2) + ' at the current rate.';
    el.className = 'field-preview' + (ratio > 80 ? ' is-warn' : '');
    el.hidden = false;
  }

  function setText(selector, value) {
    qa(selector).forEach((el) => { el.textContent = value; });
  }


  /**
   * The series list.
   *
   * Each card has to answer four questions before anything else: what is protected, at
   * what floor, until when, and whether it is still open. A series someone cannot join
   * still needs to say why, because an inert card with no explanation reads as broken.
   */
  function renderSeries() {
    const host = q('[data-series-list]');
    if (!host) return;

    // Not deployed yet. A single line in a box makes the tab a dead end, so the space
    // explains the product instead. It must not imply the thing is live: the heading
    // says what it is, and the closing line says plainly that it is not running yet.
    if (!W.outcome.configured) {
      host.innerHTML = '';
      host.appendChild(explainerCard());
      return;
    }

    if (!state.series.length) {
      host.innerHTML = '';
      host.appendChild(emptyCard(
        'No series are open. New windows are opened periodically; each one runs for a fixed '
        + 'period and then settles.'));
      return;
    }

    host.innerHTML = '';
    state.series.forEach((s) => host.appendChild(seriesCard(s)));
  }

  /**
   * What the Protect tab shows before the contract exists.
   *
   * Written to be worth reading on its own. Someone who lands here should leave
   * understanding what defined outcome protection is and what the two sides of it are,
   * whether or not they ever come back once it is running.
   */
  function explainerCard() {
    const card = document.createElement('div');
    card.className = 'tcard explainer-card';

    const heading = document.createElement('h3');
    heading.textContent = 'Two sides of the same window';
    card.appendChild(heading);

    const sides = document.createElement('div');
    sides.className = 'explainer-sides';

    const side = (label, title, body) => {
      const wrap = document.createElement('div');
      const l = document.createElement('span');
      l.className = 'klabel';
      l.textContent = label;
      const t = document.createElement('strong');
      t.textContent = title;
      const p = document.createElement('p');
      p.className = 'reason';
      p.textContent = body;
      wrap.append(l, t, p);
      return wrap;
    };

    sides.append(
      side('If you hold the asset', 'Buy a floor',
        'Pay a premium and set a price your position cannot fall below over a fixed '
        + 'window. If it settles under that floor you are paid the difference. If it does '
        + 'not, the premium is the cost of having been covered.'),
      side('If you have cash', 'Sell the floor',
        'Post USDG and earn the premium for providing it. You post the most you could ever '
        + 'owe before a single unit is sold, so there is no margin call and no liquidation. '
        + 'Your worst case is the amount you put in, and you know it up front.')
    );
    card.appendChild(sides);

    const note = document.createElement('p');
    note.className = 'field-preview';
    note.textContent = 'Pricing follows the trading calendar rather than a model. Protection '
      + 'over a weekend costs more than the same protection mid-week, because that is when '
      + 'the risk actually sits.';
    card.appendChild(note);

    const status = document.createElement('p');
    status.className = 'reason explainer-status';
    status.textContent = 'The contract is written and tested but not deployed on this '
      + 'network yet. This tab will list open series once it is.';
    card.appendChild(status);

    const link = document.createElement('a');
    link.className = 'term';
    link.href = 'docs.html#outcome';
    link.textContent = 'How it works in the docs';
    card.appendChild(link);

    return card;
  }

  function emptyCard(message) {
    const card = document.createElement('div');
    card.className = 'tcard';
    const p = document.createElement('p');
    p.className = 'reason';
    p.textContent = message;
    card.appendChild(p);
    return card;
  }

  function assetSymbol(address) {
    const match = CONFIG.collateral.find(
      (a) => a.address.toLowerCase() === String(address).toLowerCase());
    return match ? match.symbol : shortAddress(address);
  }

  function whenText(unixSeconds) {
    const ms = unixSeconds * 1000;
    const diff = ms - Date.now();
    if (diff <= 0) return 'passed';
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    if (days > 0) return days + 'd ' + hours + 'h';
    const minutes = Math.floor((diff % 3600000) / 60000);
    return hours + 'h ' + minutes + 'm';
  }

  function seriesCard(s) {
    const card = document.createElement('div');
    card.className = 'tcard series-card';

    const head = document.createElement('div');
    head.className = 'series-head';

    const title = document.createElement('h3');
    title.textContent = assetSymbol(s.asset) + ' floor at ' + usd(s.strike);

    const status = document.createElement('span');
    status.className = 'series-status is-' + s.status.toLowerCase();
    status.textContent = s.status === 'Open'
      ? 'Open, closes in ' + whenText(s.subscriptionEnd)
      : s.status;

    head.append(title, status);
    card.appendChild(head);

    const facts = document.createElement('div');
    facts.className = 'series-facts';
    const fact = (label, value) => {
      const wrap = document.createElement('div');
      const l = document.createElement('span');
      l.className = 'klabel';
      l.textContent = label;
      const v = document.createElement('strong');
      v.textContent = value;
      wrap.append(l, v);
      return wrap;
    };

    facts.append(
      fact('Expires in', whenText(s.expiry)),
      fact('Collateral posted', amount(s.sellerCollateral, CONFIG.loanToken.decimals, 0)),
      fact('Protection sold', amount(s.unitsSold, UNIT_DECIMALS, 2) + ' units'),
      fact('Premium per unit', amount(s.premiumPerUnit, CONFIG.loanToken.decimals, 2))
    );
    card.appendChild(facts);

    if (s.status === 'Settled') {
      const note = document.createElement('p');
      note.className = 'field-preview';
      const paid = s.settlementPrice < s.strike;
      note.textContent = 'Settled at ' + usd(s.settlementPrice) + '. '
        + (paid
            ? 'Below the floor, so protection paid out.'
            : 'Above the floor, so protection expired worthless and sellers kept the premium.');
      card.appendChild(note);
    }

    if (s.status === 'Void') {
      const note = document.createElement('p');
      note.className = 'field-preview is-warn';
      note.textContent = 'Voided. Buyers get their premium back and sellers get their '
        + 'collateral back. Nothing settled against a price that could not be verified.';
      card.appendChild(note);
    }

    // A position in this series, if any.
    if (s.myStake > 0n || s.myUnits > 0n) {
      const mine = document.createElement('p');
      mine.className = 'reason series-mine';
      const parts = [];
      if (s.myStake > 0n) {
        parts.push('you posted ' + amount(s.myStake, CONFIG.loanToken.decimals, 2) + ' as collateral');
      }
      if (s.myUnits > 0n) {
        parts.push('you hold ' + amount(s.myUnits, UNIT_DECIMALS, 2) + ' units of protection');
      }
      mine.textContent = 'Your position: ' + parts.join(', ') + '.';
      card.appendChild(mine);
    }

    const actions = document.createElement('div');
    actions.className = 'button-row series-actions';

    if (s.status === 'Open') {
      actions.appendChild(seriesInput(s.id, 'collateral', 'Collateral', 'Post'));
      actions.appendChild(seriesInput(s.id, 'units', 'Units', 'Buy protection'));
    }

    if ((s.status === 'Live' || s.status === 'Open') && s.expiry * 1000 <= Date.now()) {
      actions.appendChild(seriesButton(s.id, 'settle', 'Settle', 'term'));
    }

    if (s.myClaimable > 0n) {
      actions.appendChild(seriesButton(
        s.id, 'claim',
        'Claim ' + amount(s.myClaimable, CONFIG.loanToken.decimals, 2), 'term primary'));
    }

    if (actions.children.length) card.appendChild(actions);
    return card;
  }

  function seriesInput(id, kind, label, buttonText) {
    const wrap = document.createElement('div');
    wrap.className = 'series-input';

    const field = document.createElement('label');
    field.className = 'field';
    const span = document.createElement('span');
    span.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.placeholder = '0.00';
    input.setAttribute('aria-label', label + ' for series ' + id);
    input.dataset.seriesInput = id + ':' + kind;
    field.append(span, input);

    const button = document.createElement('button');
    button.className = 'term';
    button.type = 'button';
    button.textContent = buttonText;
    button.dataset.seriesAction = id + ':' + kind;

    wrap.append(field, button);
    return wrap;
  }

  function seriesButton(id, action, text, className) {
    const button = document.createElement('button');
    button.className = className;
    button.type = 'button';
    button.textContent = text;
    button.dataset.seriesAction = id + ':' + action;
    return button;
  }

  /**
   * Series controls are created fresh on every render, so listeners go on the container
   * rather than the buttons. Attaching per button would leak a listener each refresh.
   */
  function wireSeriesActions() {
    const host = q('[data-series-list]');
    if (!host) return;

    host.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-series-action]');
      if (!button || state.loading) return;

      const [idText, kind] = button.dataset.seriesAction.split(':');
      const id = Number(idText);

      const readSeriesInput = (which) => {
        const input = q('[data-series-input="' + id + ':' + which + '"]');
        if (!input || !input.value.trim()) throw new Error('Enter an amount');
        return input.value.trim();
      };

      run(SERIES_LABELS[kind] || 'Action', async () => {
        if (kind === 'collateral') {
          const value = W.parseUnits(readSeriesInput('collateral'), CONFIG.loanToken.decimals);
          await ensureAllowanceFor(W.outcome.address, CONFIG.loanToken.address, value);
          setStatus('Confirm in your wallet\u2026', 'pending');
          await W.waitForReceipt(await W.outcome.postCollateral(id, value));

        } else if (kind === 'units') {
          const units = W.parseUnits(readSeriesInput('units'), UNIT_DECIMALS);
          const series = state.series.find((s) => s.id === id);
          if (!series) throw new Error('Series not found');
          if (units > series.availableUnits) {
            throw new Error('Only ' + amount(series.availableUnits, UNIT_DECIMALS, 2)
              + ' units are available in this series');
          }

          // The premium moves with utilisation, so the cap allows a small margin above
          // the quote. Without it, another buyer landing first reverts this purchase.
          const quoted = (series.premiumPerUnit * units) / (10n ** BigInt(UNIT_DECIMALS));
          const cap = (quoted * 110n) / 100n;

          await ensureAllowanceFor(W.outcome.address, CONFIG.loanToken.address, cap);
          setStatus('Confirm in your wallet\u2026', 'pending');
          await W.waitForReceipt(await W.outcome.buyProtection(id, units, cap));

        } else if (kind === 'settle') {
          setStatus('Confirm in your wallet\u2026', 'pending');
          await W.waitForReceipt(await W.outcome.settle(id));

        } else if (kind === 'claim') {
          setStatus('Confirm in your wallet\u2026', 'pending');
          await W.waitForReceipt(await W.outcome.claim(id));
        }
      });
    });
  }

  const SERIES_LABELS = {
    collateral: 'Collateral posting',
    units: 'Protection purchase',
    settle: 'Settlement',
    claim: 'Claim'
  };

  /// Approves a spender other than the pool. The outcome pool is a separate contract and
  /// needs its own allowance.
  async function ensureAllowanceFor(spender, token, needed) {
    const current = await W.erc20.allowance(token, state.account, spender).catch(() => 0n);
    if (current >= needed) return;

    setStatus('Approve the contract to move your tokens\u2026', 'pending');
    const hash = await W.wallet.send(token,
      W.encodeCall('approve(address,uint256)', [['address', spender], ['uint256', needed]]));
    setStatus('Waiting for approval to confirm\u2026', 'pending');
    await W.waitForReceipt(hash);
  }


  /**
   * Positions held in previous deployments.
   *
   * Pond's contracts are immutable, so a new version is a new address and old positions
   * do not move by themselves. Rather than announcing a deadline and asking people to
   * withdraw, the app finds what is still there and offers the controls to retrieve it.
   *
   * The tone matters here. There is no urgency, nothing is at risk, and an old position
   * remains withdrawable indefinitely. A banner that implies otherwise would push people
   * into rushed transactions for no reason.
   */
  function renderLegacy() {
    const host = q('[data-legacy]');
    if (!host) return;

    if (!state.legacy.length) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }

    host.hidden = false;
    host.innerHTML = '';

    state.legacy.forEach((d) => {
      const card = document.createElement('div');
      card.className = 'tcard legacy-card';

      const head = document.createElement('div');
      head.className = 'series-head';
      const title = document.createElement('h3');
      title.textContent = 'Position in the ' + d.label + ' deployment';
      const tag = document.createElement('span');
      tag.className = 'series-status';
      tag.textContent = 'Previous version';
      head.append(title, tag);
      card.appendChild(head);

      const note = document.createElement('p');
      note.className = 'reason';
      note.textContent = d.note + ' Your position here is unaffected by the new deployment '
        + 'and stays withdrawable indefinitely. There is no deadline.';
      card.appendChild(note);

      const facts = document.createElement('div');
      facts.className = 'series-facts';
      const fact = (label, value) => {
        const wrap = document.createElement('div');
        const l = document.createElement('span');
        l.className = 'klabel';
        l.textContent = label;
        const v = document.createElement('strong');
        v.textContent = value;
        wrap.append(l, v);
        return wrap;
      };

      if (d.supplyAssets > 0n) {
        facts.appendChild(fact('Supplied', amount(d.supplyAssets, CONFIG.loanToken.decimals, 2)));
      }
      if (d.debt > 0n) {
        facts.appendChild(fact('Owed', amount(d.debt, CONFIG.loanToken.decimals, 2)));
      }
      if (d.collateralValue > 0n) {
        facts.appendChild(fact('Collateral', usd(d.collateralValue)));
      }
      if (d.buffer > 0n) {
        facts.appendChild(fact('Buffer', amount(d.buffer, CONFIG.loanToken.decimals, 2)));
      }
      card.appendChild(facts);

      const actions = document.createElement('div');
      actions.className = 'button-row';

      // Debt has to clear before collateral can leave, so the order of these controls
      // follows the order the contract requires rather than the order they were listed.
      if (d.debt > 0n) {
        const warn = document.createElement('p');
        warn.className = 'field-preview is-warn';
        warn.textContent = 'This position still has debt. Repay it before withdrawing '
          + 'collateral, and remember it keeps accruing interest in the old contract.';
        card.appendChild(warn);

        actions.appendChild(legacyButton(d.pool, 'repayAll', 'Repay everything', 'term primary'));
      }

      if (d.shares > 0n) {
        actions.appendChild(legacyButton(d.pool, 'withdrawAll', 'Withdraw supply', 'term'));
      }
      if (d.collateralValue > 0n && d.debt === 0n) {
        actions.appendChild(legacyButton(d.pool, 'withdrawCollateral', 'Withdraw collateral', 'term'));
      }
      if (d.buffer > 0n) {
        actions.appendChild(legacyButton(d.pool, 'withdrawBuffer', 'Withdraw buffer', 'term'));
      }

      if (actions.children.length) card.appendChild(actions);
      host.appendChild(card);
    });
  }

  function legacyButton(pool, action, text, className) {
    const button = document.createElement('button');
    button.className = className;
    button.type = 'button';
    button.textContent = text;
    button.dataset.legacyAction = pool + ':' + action;
    return button;
  }

  /// Delegated, because these cards are rebuilt on every refresh.
  function wireLegacyActions() {
    const host = q('[data-legacy]');
    if (!host) return;

    host.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-legacy-action]');
      if (!button || state.loading) return;

      const [pool, action] = button.dataset.legacyAction.split(':');
      const entry = state.legacy.find((d) => d.pool.toLowerCase() === pool.toLowerCase());
      if (!entry) return;

      run('Legacy withdrawal', async () => {
        if (action === 'withdrawAll') {
          setStatus('Confirm the withdrawal in your wallet\u2026', 'pending');
          await W.waitForReceipt(await W.legacy.withdraw(pool, entry.shares, state.account));

        } else if (action === 'repayAll') {
          // Debt grows every second, so approve slightly above the figure just read or
          // the transaction can fail on the difference.
          const buffer = entry.debt + (entry.debt / 1000n) + 1n;
          await ensureAllowanceFor(pool, CONFIG.loanToken.address, buffer);
          setStatus('Confirm the repayment\u2026', 'pending');
          await W.waitForReceipt(await W.legacy.repay(pool, W.MAX_UINT256, state.account));

        } else if (action === 'withdrawBuffer') {
          setStatus('Confirm in your wallet\u2026', 'pending');
          await W.waitForReceipt(await W.legacy.withdrawBuffer(pool, entry.buffer, state.account));

        } else if (action === 'withdrawCollateral') {
          // Collateral is per asset, so each has to be withdrawn in turn.
          let moved = false;
          for (const asset of CONFIG.collateral) {
            const held = await W.legacy.collateralOf(pool, state.account, asset.address);
            if (held === 0n) continue;
            setStatus('Withdrawing ' + asset.symbol + '\u2026', 'pending');
            await W.waitForReceipt(
              await W.legacy.withdrawCollateral(pool, asset.address, held, state.account));
            moved = true;
          }
          if (!moved) throw new Error('No collateral found in that deployment');
        }
      });
    });
  }


  /**
   * What the holder of a Robinhood stock token can unlock.
   *
   * The question a new user actually has is not how the protocol works, it is what it
   * does for them. This answers it with their own holdings: what they have, what it is
   * worth, and what it would let them borrow, without selling any of it.
   *
   * It also shows the same figure for the coming weekend. That single comparison teaches
   * the whole design in a way no paragraph does: capacity is not a fixed number, it
   * follows the market that backs the asset.
   */
  function renderUnlockable() {
    const host = q('[data-unlock]');
    if (!host) return;

    if (!state.account) {
      host.hidden = true;
      return;
    }

    if (!state.unlockable.length) {
      host.hidden = false;
      host.innerHTML = '';
      host.appendChild(emptyCard(
        'No tokenized equities found in this wallet. Pond accepts '
        + CONFIG.collateral.map((a) => a.symbol).join(', ')
        + ' as collateral, and holding any of them lets you borrow USDG without selling.'));
      return;
    }

    host.hidden = false;
    host.innerHTML = '';

    const card = document.createElement('div');
    card.className = 'tcard unlock-card';

    const heading = document.createElement('h3');
    heading.textContent = 'What your holdings unlock';
    card.appendChild(heading);

    const intro = document.createElement('p');
    intro.className = 'reason';
    intro.textContent = 'Borrow against these without selling them. You keep the price '
      + 'exposure and any corporate actions. The weekend column is the same holding when '
      + 'the underlying market is shut, which is when a position cannot be liquidated into '
      + 'a live book.';
    card.appendChild(intro);

    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';

    const table = document.createElement('table');
    table.className = 'app-table unlock-table';

    const thead = document.createElement('thead');
    const hrow = document.createElement('tr');
    ['Asset', 'You hold', 'Value', 'Unlocks now', 'This weekend'].forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h;
      hrow.appendChild(th);
    });
    thead.appendChild(hrow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    let totalNow = 0n;
    let totalWeekend = 0n;

    state.unlockable.forEach((row) => {
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
      held.textContent = amount(row.balance, row.decimals, 4);

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

    // The summary is the line worth reading if nothing else is. It states the number and
    // then states plainly what it costs, because a borrowing figure presented without
    // its risk is an advertisement rather than information.
    const summary = document.createElement('p');
    summary.className = 'field-preview';

    const drop = totalNow > 0n
      ? Number(((totalNow - totalWeekend) * 10000n) / totalNow) / 100
      : 0;

    summary.textContent = 'Together these would let you borrow up to ' + usd(totalNow)
      + ' right now'
      + (drop > 0.5
          ? ', falling to ' + usd(totalWeekend) + ' across the weekend, about '
            + drop.toFixed(0) + '% less, because the market backing them is closed.'
          : '.')
      + ' Borrowing puts that collateral at risk of liquidation if the price falls far '
      + 'enough, and interest accrues until you repay.';
    card.appendChild(summary);

    host.appendChild(card);
  }


  /**
   * The supply rebate.
   *
   * Two things this must not do. It must not imply the rebate is new yield, because it is
   * a share of a fee the protocol already takes. And it must not show a tier as earning
   * without saying that the rebate accrues on the lower of the balance at each end of a
   * period, because somebody who buys POND and sells it before claiming will otherwise be
   * surprised by a zero.
   */
  function renderRebate() {
    const host = q('[data-rebate]');
    if (!host) return;

    if (!W.rebate.configured || !state.account) {
      host.hidden = true;
      return;
    }
    host.hidden = false;

    const tiers = CONFIG.rebateTiers || [];
    const body = q('[data-rebate-tiers]');
    const status = state.rebate;
    const currentTier = status ? status.tierIndex : tiers.length;

    if (body) {
      body.innerHTML = '';
      tiers.forEach((tier, i) => {
        const tr = document.createElement('tr');
        if (i === currentTier) tr.className = 'is-current';

        const name = document.createElement('td');
        name.textContent = tier.name + (i === currentTier ? ' \u00b7 yours' : '');

        const minimum = document.createElement('td');
        minimum.textContent = Number(tier.minimum).toLocaleString() + ' POND';

        const bps = document.createElement('td');
        bps.textContent = '+' + (tier.bps / 100).toFixed(2) + '%';

        tr.append(name, minimum, bps);
        body.appendChild(tr);
      });
    }

    if (!status) {
      setText('[data-rebate-tier]', DASH);
      setText('[data-rebate-bps]', DASH);
      setText('[data-rebate-claimable]', DASH);
      return;
    }

    const tier = tiers[status.tierIndex];
    setText('[data-rebate-tier]', tier ? tier.name : 'None');
    setText('[data-rebate-bps]',
      status.rebateBps > 0 ? '+' + (status.rebateBps / 100).toFixed(2) + '%' : '\u2014');

    const claimable = status.pending + status.banked;
    setText('[data-rebate-claimable]',
      amount(claimable, CONFIG.loanToken.decimals, 2) + ' ' + CONFIG.loanToken.symbol);

    const note = q('[data-rebate-note]');
    if (!note) return;

    const acreHeld = Number(W.formatUnits(status.acreBalance, CONFIG.acreToken.decimals, 0)
      .replace(/,/g, ''));

    if (!tier) {
      const first = tiers[0];
      note.textContent = first
        ? 'Holding ' + Number(first.minimum).toLocaleString() + ' POND would add '
          + (first.bps / 100).toFixed(2) + '% to your supply rate. Your base rate is '
          + 'unaffected either way.'
        : '';
      note.className = 'field-preview';
      note.hidden = !first;
      return;
    }

    // The rule that surprises people, stated where it matters rather than in the docs.
    let text = 'The rebate accrues on the lower of what you held at the start of a period '
      + 'and what you hold now, for both POND and your deposit. Selling either before '
      + 'claiming forfeits that period.';

    const next = tiers[status.tierIndex + 1];
    if (next) {
      const needed = Number(next.minimum) - acreHeld;
      if (needed > 0) {
        text = Math.round(needed).toLocaleString() + ' more POND would reach '
          + next.name + ' at +' + (next.bps / 100).toFixed(2) + '%. ' + text;
      }
    }

    note.textContent = text;
    note.className = 'field-preview';
    note.hidden = false;

    // A rebate that cannot pay is worse than none, so say so rather than letting a claim
    // quietly come up short.
    if (state.rebateSolvency && !state.rebateSolvency.covered) {
      note.textContent = 'The rebate contract currently holds less than it owes, so a '
        + 'claim may pay only part of what is due. The remainder stays owed. ' + text;
      note.className = 'field-preview is-warn';
    }
  }


  /**
   * The transfer addresses and what is sitting at each.
   *
   * Somebody looking at this tab wants three questions answered: where do I send, what is
   * currently in limbo, and how do I get it back. Anything else is secondary, so the
   * layout answers them in that order.
   *
   * Every balance is shown, including tokens at addresses that do not expect them. A
   * balance that is not displayed is a balance somebody believes they have lost.
   */
  /**
   * Copies text and confirms it visibly.
   *
   * The single most important interaction on this tab. An address is 42 characters and
   * nobody types one by hand, so without this the feature is unusable on a phone, which
   * is where most of the people it exists for are.
   */
  async function copyToClipboard(text, button) {
    const done = () => {
      const original = button.textContent;
      button.textContent = 'Copied';
      button.classList.add('is-done');
      setTimeout(() => {
        button.textContent = original;
        button.classList.remove('is-done');
      }, 1600);
    };

    try {
      await navigator.clipboard.writeText(text);
      done();
    } catch (_) {
      // Older browsers, or a page without clipboard permission. Selecting the text at
      // least lets somebody copy it by hand rather than leaving them stuck.
      const node = button.parentNode.querySelector('.deposit-address');
      if (node && window.getSelection) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      button.textContent = 'Select and copy';
      setTimeout(() => { button.textContent = 'Copy'; }, 2200);
    }
  }

  /**
   * The transfer addresses and everything sitting at them.
   *
   * The tab has one job: give somebody an address to send to, and show them what has
   * happened to what they sent. Explanation belongs in the hints, not between them and
   * the thing they came for.
   */
  function renderTransfers() {
    const host = q('[data-transfers]');
    if (!host) return;

    const summary = q('[data-transfer-summary]');

    if (!W.deposits.configured) {
      host.innerHTML = '';
      host.appendChild(emptyCard('Transfer addresses are not available on this network yet.'));
      if (summary) summary.hidden = true;
      return;
    }

    const subject = state.transfersFor || state.account;

    if (!subject) {
      host.innerHTML = '';
      host.appendChild(emptyCard(
        'Connect a wallet, or paste an address above, to see its transfer addresses.'));
      if (summary) summary.hidden = true;
      return;
    }

    const whose = q('[data-transfer-whose]');
    if (whose) {
      const isSelf = state.account
        && subject.toLowerCase() === state.account.toLowerCase();
      if (!isSelf) {
        whose.textContent = 'Showing addresses for ' + subject
          + '. Anything sent to them is credited to that address, not to your wallet.';
        whose.className = 'field-preview is-warn';
        whose.hidden = false;
      } else {
        whose.hidden = true;
      }
    }

    if (!state.transfers) {
      host.innerHTML = '';
      host.appendChild(emptyCard('Loading\u2026'));
      if (summary) summary.hidden = true;
      return;
    }

    const { addresses, waiting } = state.transfers;

    const spec = [
      {
        key: 'deposit', action: 0, title: 'Deposit',
        send: CONFIG.loanToken.symbol + ' or an accepted equity',
        result: CONFIG.loanToken.symbol + ' earns the borrowing rate. '
          + CONFIG.collateral.map((c) => c.symbol).join(', ') + ' become collateral.'
      },
      {
        key: 'withdraw', action: 1, title: 'Withdraw',
        send: 'your ' + (CONFIG.shareSymbol || 'aUSDG') + ' position tokens',
        result: 'The underlying returns to you. Only you can do this, because only you '
          + 'hold those tokens.'
      },
      {
        key: 'repay', action: 2, title: 'Repay',
        send: CONFIG.loanToken.symbol,
        result: 'Reduces your debt. Anything above what you owe comes straight back.'
      }
    ];

    // The summary answers the two questions somebody has before reading anything.
    let waitingCount = 0;
    let misplacedCount = 0;
    let totalValue = 0n;

    Object.values(waiting).forEach((rows) => rows.forEach((r) => {
      if (r.expected) waitingCount++; else misplacedCount++;

      // Valued through the oracle where we have a price. Position tokens are excluded
      // because their value is the underlying, which is already counted elsewhere, and
      // showing it here would double count somebody's own money back at them.
      if (r.kind === 'loan') {
        totalValue += r.amount * (10n ** BigInt(18 - CONFIG.loanToken.decimals));
      } else if (r.kind === 'collateral') {
        const priced = state.unlockable.find(
          (u) => u.address.toLowerCase() === r.address.toLowerCase());
        if (priced && priced.price > 0n) {
          totalValue += (r.amount * priced.price) / (10n ** BigInt(r.decimals));
        }
      }
    }));

    if (summary) {
      summary.hidden = false;
      setText('[data-transfer-waiting]', String(waitingCount));
      setText('[data-transfer-misplaced]', String(misplacedCount));
      setText('[data-transfer-value]', totalValue > 0n ? usd(totalValue) : '\u2014');

      // A count alone does not say whether anything is actually moving, so the caption
      // distinguishes between nothing sent and something in flight.
      setText('[data-transfer-waiting-note]', waitingCount > 0
        ? 'Being credited, usually within a minute'
        : 'Nothing in flight');
    }

    host.innerHTML = '';

    spec.forEach((entry) => {
      const pending = waiting[entry.key] || [];

      const card = document.createElement('div');
      card.className = 'tcard transfer-card';

      const head = document.createElement('div');
      head.className = 'series-head';

      const title = document.createElement('h3');
      title.textContent = entry.title;

      const status = document.createElement('span');
      status.className = 'series-status' + (pending.length ? ' is-open' : '');
      status.textContent = pending.length
        ? pending.length + (pending.length === 1 ? ' item waiting' : ' items waiting')
        : 'Nothing waiting';

      head.append(title, status);
      card.appendChild(head);

      const send = document.createElement('p');
      send.className = 'reason';
      send.textContent = 'Send ' + entry.send + '. ' + entry.result;
      card.appendChild(send);

      // The address, with the copy control beside it. Nobody types 42 characters.
      const row = document.createElement('div');
      row.className = 'address-row';

      const code = document.createElement('code');
      code.className = 'deposit-address is-primary';
      code.textContent = addresses[entry.key];

      const copy = document.createElement('button');
      copy.className = 'term copy-btn';
      copy.type = 'button';
      copy.textContent = 'Copy';
      copy.addEventListener('click', () => copyToClipboard(addresses[entry.key], copy));

      row.append(code, copy);
      card.appendChild(row);

      if (pending.length) {
        const wrap = document.createElement('div');
        wrap.className = 'table-wrap';

        const table = document.createElement('table');
        table.className = 'app-table transfer-table';

        const thead = document.createElement('thead');
        const hrow = document.createElement('tr');
        ['Token', 'Amount', 'Status', ''].forEach((h) => {
          const th = document.createElement('th');
          th.textContent = h;
          hrow.appendChild(th);
        });
        thead.appendChild(hrow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        pending.forEach((r) => {
          const tr = document.createElement('tr');
          if (!r.expected) tr.className = 'is-misplaced';

          const name = document.createElement('td');
          name.textContent = r.symbol;

          const amount = document.createElement('td');
          amount.textContent = W.formatUnits(r.amount, r.decimals, 4);

          const state_ = document.createElement('td');
          state_.className = 'reason';
          state_.textContent = r.expected
            ? 'Being collected'
            : 'Wrong address for this token';

          const action = document.createElement('td');
          const back = document.createElement('button');
          back.className = 'term ghost';
          back.type = 'button';
          back.dataset.rescue = entry.action + ':' + r.address + ':' + subject;
          back.textContent = 'Return';
          if (!state.account) {
            back.disabled = true;
            back.title = 'Connect a wallet to send the transaction. The funds still go '
              + 'to the address they belong to.';
          }
          action.appendChild(back);

          tr.append(name, amount, state_, action);
          tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        wrap.appendChild(table);
        card.appendChild(wrap);
      }

      host.appendChild(card);
    });
  }

  /// Delegated, because these controls are rebuilt on every refresh.
  function wireTransferActions() {
    const lookupButton = q('[data-transfer-lookup]');
    const lookupInput = q('[data-transfer-address]');

    const lookup = async () => {
      const raw = String(lookupInput ? lookupInput.value : '').trim();
      if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) {
        setStatus('That does not look like an address. It should start with 0x and be '
          + '42 characters long.', 'error');
        return;
      }

      try {
        setBusy(true);
        setStatus('Reading that address\u2026', 'pending');
        state.transfersFor = raw;
        state.transfers = await W.deposits.holdings(raw);
        clearStatus();
        render();
      } catch (err) {
        setStatus(W.describeError(err), 'error');
      } finally {
        setBusy(false);
      }
    };

    if (lookupButton) lookupButton.addEventListener('click', lookup);
    if (lookupInput) {
      lookupInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') lookup();
      });
    }

    const host = q('[data-transfers]');
    if (!host) return;

    host.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-rescue]');
      if (!button || state.loading) return;

      const [action, token, owner] = button.dataset.rescue.split(':');

      run('Return', async () => {
        setStatus('Confirm in your wallet\u2026', 'pending');
        // The owner is the address the funds belong to, which may not be the signer.
        // The contract sends only to that address regardless of who calls it.
        await W.waitForReceipt(
          await W.deposits.rescue(owner, Number(action), token));
      });
    });
  }

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  /**
   * Ensures the pool is approved to move at least `needed` of `token`.
   * Approves the exact amount rather than an unlimited allowance. Unlimited approval is
   * convenient and is also how a bug in this contract would become a drained wallet.
   */
  async function ensureAllowance(token, needed, currentAllowance) {
    if (currentAllowance >= needed) return;

    setStatus('Approve the pool to move your tokens\u2026', 'pending');
    const hash = await W.actions.approve(token, W.pool.address, needed);
    setStatus('Waiting for approval to confirm\u2026', 'pending');
    await W.waitForReceipt(hash);
  }

  async function run(label, fn) {
    if (state.loading) return;

    try {
      setBusy(true);
      clearStatus();
      await fn();
      setStatus(label + ' confirmed.', 'success');
      await refresh();
    } catch (error) {
      setStatus(W.describeError(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  function readAmount(selector, decimals) {
    const input = q(selector);
    if (!input || !input.value.trim()) throw new Error('Enter an amount');
    return W.parseUnits(input.value.trim(), decimals);
  }

  function selectedCollateral() {
    const select = q('[data-collateral-select]');
    if (!select || !select.value) throw new Error('Choose a collateral asset');
    const asset = CONFIG.collateral.find((a) => a.address === select.value);
    if (!asset) throw new Error('Unknown asset');
    return asset;
  }

  const handlers = {
    async supply() {
      const value = readAmount('[data-supply-amount]', CONFIG.loanToken.decimals);
      await ensureAllowance(CONFIG.loanToken.address, value, state.loanAllowance);
      setStatus('Confirm the deposit in your wallet\u2026', 'pending');
      const hash = await W.actions.supply(value, state.account);
      setStatus('Waiting for confirmation\u2026', 'pending');
      await W.waitForReceipt(hash);
    },

    async withdraw() {
      const value = readAmount('[data-withdraw-amount]', CONFIG.loanToken.decimals);
      // The input is denominated in assets; the contract burns shares.
      const p = state.position;
      if (!p || p.supplyAssets === 0n) throw new Error('Nothing to withdraw');
      let shares = (value * p.supplyShares) / p.supplyAssets;
      if (shares > p.supplyShares) shares = p.supplyShares;
      if (shares === 0n) throw new Error('Amount too small');

      setStatus('Confirm the withdrawal in your wallet\u2026', 'pending');
      const hash = await W.actions.withdraw(shares, state.account);
      setStatus('Waiting for confirmation\u2026', 'pending');
      await W.waitForReceipt(hash);
    },

    async withdrawAll() {
      const p = state.position;
      if (!p || p.supplyShares === 0n) throw new Error('Nothing to withdraw');
      setStatus('Confirm the withdrawal in your wallet\u2026', 'pending');
      const hash = await W.actions.withdraw(p.supplyShares, state.account);
      setStatus('Waiting for confirmation\u2026', 'pending');
      await W.waitForReceipt(hash);
    },

    async depositCollateral() {
      const asset = selectedCollateral();
      const value = readAmount('[data-collateral-amount]', asset.decimals);
      const held = state.collateral.get(asset.address);

      await ensureAllowance(asset.address, value, held ? held.allowance : 0n);
      setStatus('Confirm the collateral deposit\u2026', 'pending');
      const hash = await W.actions.depositCollateral(asset.address, value, state.account);
      setStatus('Waiting for confirmation\u2026', 'pending');
      await W.waitForReceipt(hash);
    },

    async withdrawCollateral() {
      const asset = selectedCollateral();
      const value = readAmount('[data-collateral-amount]', asset.decimals);
      setStatus('Confirm the collateral withdrawal\u2026', 'pending');
      const hash = await W.actions.withdrawCollateral(asset.address, value, state.account);
      setStatus('Waiting for confirmation\u2026', 'pending');
      await W.waitForReceipt(hash);
    },

    async borrow() {
      const value = readAmount('[data-borrow-amount]', CONFIG.loanToken.decimals);
      const p = state.position;

      // Check locally first so the user gets a useful message instead of a revert.
      if (p) {
        const projected = p.debt + value;
        if (projected > p.borrowLimit) {
          throw new Error('That would exceed your borrow limit of ' + usd(p.borrowLimit));
        }
      }

      setStatus('Confirm the borrow in your wallet\u2026', 'pending');
      const hash = await W.actions.borrow(value, state.account);
      setStatus('Waiting for confirmation\u2026', 'pending');
      await W.waitForReceipt(hash);
    },

    async repay() {
      const value = readAmount('[data-repay-amount]', CONFIG.loanToken.decimals);
      await ensureAllowance(CONFIG.loanToken.address, value, state.loanAllowance);
      setStatus('Confirm the repayment\u2026', 'pending');
      const hash = await W.actions.repay(value, state.account);
      setStatus('Waiting for confirmation\u2026', 'pending');
      await W.waitForReceipt(hash);
    },

    async repayAll() {
      const p = state.position;
      if (!p || p.debt === 0n) throw new Error('There is no debt to repay');

      // Debt grows every second, so approve slightly above the current figure or the
      // transaction can fail on a rounding difference between reading and executing.
      const buffer = p.debt + (p.debt / 1000n) + 1n;
      await ensureAllowance(CONFIG.loanToken.address, buffer, state.loanAllowance);

      setStatus('Confirm the repayment\u2026', 'pending');
      const hash = await W.actions.repay(W.MAX_UINT256, state.account);
      setStatus('Waiting for confirmation\u2026', 'pending');
      await W.waitForReceipt(hash);
    },

    async depositBuffer() {
      const value = readAmount('[data-buffer-amount]', CONFIG.loanToken.decimals);
      await ensureAllowance(CONFIG.loanToken.address, value, state.loanAllowance);
      setStatus('Confirm in your wallet\u2026', 'pending');
      const hash = await W.actions.depositBuffer(value, state.account);
      setStatus('Waiting for confirmation\u2026', 'pending');
      await W.waitForReceipt(hash);
    },

    async withdrawBuffer() {
      const value = readAmount('[data-buffer-amount]', CONFIG.loanToken.decimals);
      setStatus('Confirm in your wallet\u2026', 'pending');
      const hash = await W.actions.withdrawBuffer(value, state.account);
      setStatus('Waiting for confirmation\u2026', 'pending');
      await W.waitForReceipt(hash);
    },

    async setPlan() {
      const target = q('[data-plan-target]');
      const lead = q('[data-plan-lead]');
      if (!target || !lead) throw new Error('Choose a target and a lead time');

      setStatus('Confirm the plan in your wallet\u2026', 'pending');
      const hash = await W.actions.setDeleveragePlan(Number(lead.value), Number(target.value));
      setStatus('Waiting for confirmation\u2026', 'pending');
      await W.waitForReceipt(hash);
    },

    async clearPlan() {
      setStatus('Confirm in your wallet\u2026', 'pending');
      const hash = await W.actions.clearDeleveragePlan();
      setStatus('Waiting for confirmation\u2026', 'pending');
      await W.waitForReceipt(hash);
    },

    async claimRebate() {
      const status = state.rebate;
      if (!status || (status.pending + status.banked) === 0n) {
        throw new Error('There is nothing to claim yet');
      }
      setStatus('Confirm the claim in your wallet\u2026', 'pending');
      await W.waitForReceipt(await W.rebate.claim());
    },

    async checkpointRebate() {
      setStatus('Confirm in your wallet\u2026', 'pending');
      await W.waitForReceipt(await W.rebate.checkpoint(state.account));
    },

    async accrue() {
      setStatus('Confirm in your wallet\u2026', 'pending');
      const hash = await W.actions.accrueInterest();
      setStatus('Waiting for confirmation\u2026', 'pending');
      await W.waitForReceipt(hash);
    }
  };

  const ACTION_LABELS = {
    supply: 'Deposit', withdraw: 'Withdrawal', withdrawAll: 'Withdrawal',
    depositCollateral: 'Collateral deposit', withdrawCollateral: 'Collateral withdrawal',
    borrow: 'Borrow', repay: 'Repayment', repayAll: 'Repayment', accrue: 'Interest accrual',
    depositBuffer: 'Buffer deposit', withdrawBuffer: 'Buffer withdrawal',
    setPlan: 'Deleverage plan', clearPlan: 'Plan removal',
    claimRebate: 'Rebate claim', checkpointRebate: 'Rebate checkpoint'
  };


  // ------------------------------------------------------------------
  // Wiring
  // ------------------------------------------------------------------

  /// Fills an input with the largest amount the action allows.
  ///
  /// Each maximum is different and none of them is simply the wallet balance. Supply is
  /// bounded by the per account cap and the pool headroom as well as what you hold.
  /// Borrow is bounded by your remaining limit and the pool's available liquidity.
  /// Computing these here means a user pressing Max gets an amount that will actually
  /// succeed, rather than one the contract rejects.
  function fillMax(field) {
    try {
      if (field === 'supply') {
        let max = state.walletLoanBalance;
        if (state.caps && state.caps.supplyHeadroom < max) max = state.caps.supplyHeadroom;
        setInput('[data-supply-amount]', max, CONFIG.loanToken.decimals);

      } else if (field === 'withdraw') {
        const p = state.position;
        setInput('[data-withdraw-amount]', p ? p.supplyAssets : 0n, CONFIG.loanToken.decimals);

      } else if (field === 'borrow') {
        const p = state.position;
        if (!p) return;
        // Remaining borrow capacity, in loan token units rather than dollars.
        let headroom = p.borrowLimit > p.debtValueForLimit ? p.borrowLimit - p.debtValueForLimit : 0n;
        // Values are in WAD dollars; convert to the loan token's own decimals.
        let inTokens = headroom / (10n ** BigInt(18 - CONFIG.loanToken.decimals));
        if (state.caps && state.caps.borrowHeadroom < inTokens) inTokens = state.caps.borrowHeadroom;
        // Leave a small margin, because the limit moves with the clock and with interest.
        inTokens = (inTokens * 995n) / 1000n;
        setInput('[data-borrow-amount]', inTokens, CONFIG.loanToken.decimals);

      } else if (field === 'repay') {
        const p = state.position;
        let max = p ? p.debt : 0n;
        if (state.walletLoanBalance < max) max = state.walletLoanBalance;
        setInput('[data-repay-amount]', max, CONFIG.loanToken.decimals);

      } else if (field === 'buffer') {
        setInput('[data-buffer-amount]', state.walletLoanBalance, CONFIG.loanToken.decimals);

      } else if (field === 'collateral') {
        const asset = selectedCollateral();
        const held = state.collateral.get(asset.address);
        setInput('[data-collateral-amount]', held ? held.walletBalance : 0n, asset.decimals);
      }
    } catch (_) {
      // A max button should never surface an error. If the state is not ready, do nothing.
    }
  }

  function setInput(selector, value, decimals) {
    const input = q(selector);
    if (!input) return;
    // Full precision, no thousands separators, so the value can be parsed straight back.
    input.value = W.formatUnits(value, decimals, decimals).replace(/,/g, '');
  }

  function wire() {
    wireSeriesActions();
    wireTransferActions();
    wireLegacyActions();

    qa('[data-max]').forEach((button) => {
      button.addEventListener('click', () => {
        fillMax(button.dataset.max);
        renderPreviews();
      });
    });

    // Previews update as the amount is typed, so the consequence of an action is
    // visible before the wallet is ever opened.
    ['[data-supply-amount]', '[data-borrow-amount]'].forEach((selector) => {
      const input = q(selector);
      if (input) input.addEventListener('input', renderPreviews);
    });

    const connect = q('[data-connect]');
    if (connect) {
      connect.addEventListener('click', async () => {
        // Re-entry guard. Without it, a second click while the wallet popup is open
        // produces error -32002 and the interface looks broken when it is not.
        if (state.connecting) return;

        state.connecting = true;
        renderConnection();
        clearStatus();

        try {
          if (!W.wallet.isAvailable()) {
            throw new Error('No wallet detected. Install a browser wallet to continue.');
          }

          if (!state.account) {
            setStatus('Approve the connection in your wallet\u2026', 'pending');
            await W.wallet.connect();
            state.account = W.wallet.account;
          }

          state.onCorrectChain = W.wallet.isOnCorrectChain();

          if (!state.onCorrectChain) {
            setStatus('Approve the network switch in your wallet\u2026', 'pending');
            await W.wallet.switchChain();
            state.onCorrectChain = W.wallet.isOnCorrectChain();
          }

          if (!state.onCorrectChain) {
            throw new Error('Still on the wrong network. Switch to ' + CONFIG.chainName + ' in your wallet.');
          }

          clearStatus();
        } catch (error) {
          setStatus(W.describeError(error), 'error');
        } finally {
          // The flag clears before the refresh, so the button settles immediately
          // rather than waiting on chain reads.
          state.connecting = false;
          renderConnection();
        }

        await refresh();
      });
    }

    qa('[data-action]').forEach((button) => {
      const action = button.dataset.action;
      if (!handlers[action]) return;

      button.addEventListener('click', () => {
        if (!deployed) {
          setStatus('Pond is not deployed yet. This interface is a preview.', 'info');
          return;
        }
        if (!state.account) {
          setStatus('Connect a wallet first.', 'info');
          return;
        }
        if (!state.onCorrectChain) {
          setStatus('Switch to ' + CONFIG.chainName + ' first.', 'info');
          return;
        }
        run(ACTION_LABELS[action] || 'Action', handlers[action]);
      });
    });

    // Populate the collateral picker from configuration.
    const select = q('[data-collateral-select]');
    if (select) {
      select.innerHTML = '';
      if (!CONFIG.collateral.length) {
        const option = document.createElement('option');
        option.textContent = 'No assets configured';
        option.value = '';
        select.appendChild(option);
        select.disabled = true;
      } else {
        CONFIG.collateral.forEach((asset) => {
          const option = document.createElement('option');
          option.value = asset.address;
          option.textContent = asset.symbol;
          select.appendChild(option);
        });
      }
    }

    W.wallet.onChange(async () => {
      const previous = state.account;
      state.account = W.wallet.account;
      state.onCorrectChain = W.wallet.isOnCorrectChain();

      // A wallet that locks or disconnects reports an empty account list. Clear the
      // position rather than leaving the previous account's figures on screen, which
      // would be both wrong and alarming.
      if (!state.account) {
        state.position = null;
        state.collateral.clear();
        state.walletLoanBalance = 0n;
        if (previous) setStatus('Wallet disconnected.', 'info');
      }

      render();
      await refresh();
    });
  }

  // ------------------------------------------------------------------
  // Start
  // ------------------------------------------------------------------

  async function start() {
    wire();

    if (!deployed) {
      renderPreview();
      return;
    }

    await W.wallet.restore();
    state.account = W.wallet.account;
    state.onCorrectChain = W.wallet.isOnCorrectChain();

    await refresh();

    const interval = CONFIG.refreshIntervalMs || 20000;
    setInterval(() => {
      if (!state.loading && !document.hidden) refresh();
    }, interval);
  }

  start();
})();
