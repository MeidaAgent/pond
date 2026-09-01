/**
 * Pond web3 layer.
 *
 * No dependencies, no build step, no bundler. The site ships under a Content Security
 * Policy with no unsafe-inline and no third party script sources, so a library loaded
 * from a CDN would be blocked and a bundled one would need a build pipeline the project
 * does not have. Everything needed is implemented here directly.
 *
 * Function selectors are precomputed rather than derived, which removes the need to ship
 * a keccak implementation to the browser. If a contract signature changes, the selector
 * here must be regenerated with `cast sig "<signature>"`.
 */

(function () {
  'use strict';

  // ------------------------------------------------------------------
  // Configuration
  // ------------------------------------------------------------------

  const CONFIG = window.POND_CONFIG || window.ACRE_CONFIG || {};

  const isConfigured = () =>
    Boolean(CONFIG.contracts && CONFIG.contracts.pool && !/^0x0{40}$/i.test(CONFIG.contracts.pool));

  // ------------------------------------------------------------------
  // ABI encoding and decoding
  //
  // Only the types the protocol actually uses: uint256, address, bool, and dynamic
  // address arrays. Everything is a 32 byte word, which keeps this small enough to
  // read in one sitting and verify by eye.
  // ------------------------------------------------------------------

  const SELECTORS = {
    // AcrePool, state changing
    'supply(uint256,address)': '0x674032b8',
    'withdraw(uint256,address)': '0x00f714ce',
    'borrow(uint256,address)': '0x4b3fd148',
    'repay(uint256,address)': '0xacb70815',
    'depositCollateral(address,uint256,address)': '0x22425480',
    'withdrawCollateral(address,uint256,address)': '0x1f1088a0',
    'accrueInterest()': '0xa6afed95',

    // AcrePool, views
    'isAccrualCurrent()': '0x020248d7',
    'totalSupplyAssets()': '0x94877fc4',
    'totalBorrowAssets()': '0x1aad44c2',
    'convertToAssets(uint256)': '0x07a2d13a',
    'debtOf(address)': '0xd283e75f',
    'borrowLimitOf(address)': '0xd045d36e',
    'liquidationLimitOf(address)': '0x56e173f1',
    'collateralValueOf(address)': '0x3a65a350',
    'collateralOf(address,address)': '0xd8b7575d',
    'collateralAssetsOf(address)': '0x0ff804f9',
    'isLiquidatable(address)': '0x042e02cf',
    'utilization()': '0xea21cd92',
    'borrowRatePerSecond()': '0x52609750',
    'sessionRateMultiplier(uint256)': '0xe4c0f517',
    'supplyCap()': '0x8f770ad0',
    'borrowCap()': '0x44d9dca6',
    'supplyHeadroom()': '0x7588ea13',
    'borrowHeadroom()': '0x40da171e',
    'supplyPaused()': '0xd36da0b5',
    'borrowPaused()': '0xbcb4bbea',
    'auctionStartedAt(address)': '0x82b34966',
    'availableLiquidity()': '0x74375359',

    // Deposit router
    'depositAddressOf(address)': '0xb29cd40f',
    'withdrawAddressOf(address)': '0x7f69a534',
    'repayAddressOf(address)': '0x50ad2f11',
    'pendingWithdrawal(address)': '0x0964c95b',
    'pendingRepayment(address)': '0x525ab7ab',
    'rescue(address,uint8,address)': '0x9ec427a4',
    'pendingOf(address,address)': '0x1606db19',
    'rescue(address,address)': '0x4fdf5d1d',
    'vaultDeployed(address)': '0x5051aacb',

    // Supply rebate
    'statusOf(address)': '0x97a5d5b5',
    'checkpoint(address)': '0xa972985e',
    'claim()': '0x4e71d92d',
    'solvency()': '0x773c5049',

    // Defined outcome pools
    'nextSeriesId()': '0x6ed3e3e3',
    'seriesOf(uint256)': '0xe870b591',
    'availableUnits(uint256)': '0x5efee2d6',
    'premiumPerUnit(uint256)': '0xdb43e384',
    'postCollateral(uint256,uint256)': '0x7507a345',
    'buyProtection(uint256,uint256,uint256)': '0x479c1e34',
    'settle(uint256)': '0x8df82800',
    'voidSeries(uint256)': '0x83558860',
    'claim(uint256)': '0x379607f5',
    'previewClaim(uint256,address)': '0xb8ae007d',
    'sellerStake(uint256,address)': '0xb92001b6',
    'unitsHeld(uint256,address)': '0x19ff3c43',

    // Deleveraging into the close
    'depositBuffer(uint256,address)': '0xe68fbd56',
    'withdrawBuffer(uint256,address)': '0xb62e4b64',
    'setDeleveragePlan(uint32,uint16)': '0xced10e7c',
    'clearDeleveragePlan()': '0xaca68073',
    'executeDeleverage(address)': '0x35ff8267',
    'previewDeleverage(address)': '0xd1682de0',
    'deleverageBuffer(address)': '0xf4129654',
    'deleveragePlan(address)': '0xc13736ab',

    // ERC-20
    'balanceOf(address)': '0x70a08231',
    'totalSupply()': '0x18160ddd',
    'decimals()': '0x313ce567',
    'symbol()': '0x95d89b41',
    'approve(address,uint256)': '0x095ea7b3',
    'allowance(address,address)': '0xdd62ed3e',

    // MarketCalendar
    'currentSession()': '0xd4166763',
    'secondsUntilRegularOpen()': '0x3da24689',
    'provisionedThrough()': '0x037a1b89',

    // StockOracle and RiskEngine
    'price(address)': '0xaea91078',
    'valueOf(address,uint256)': '0x1eec5a9a',
    'effectiveLtv(address,uint256)': '0xc5ecb5e0',
    'isEnabled(address)': '0x9015d371'
  };

  const strip0x = (hex) => (hex.startsWith('0x') ? hex.slice(2) : hex);

  function encodeUint(value) {
    const v = typeof value === 'bigint' ? value : BigInt(value);
    if (v < 0n) throw new Error('negative value');
    return v.toString(16).padStart(64, '0');
  }

  function encodeAddress(addr) {
    const clean = strip0x(addr).toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(clean)) throw new Error('invalid address: ' + addr);
    return clean.padStart(64, '0');
  }

  /**
   * Builds calldata. Arguments are described as [type, value] pairs so the encoder
   * never has to guess, which is where hand written encoders usually go wrong.
   */
  function encodeCall(signature, args) {
    const selector = SELECTORS[signature];
    if (!selector) throw new Error('unknown selector: ' + signature);

    let data = selector;
    (args || []).forEach(([type, value]) => {
      if (type === 'uint256' || type === 'uint32' || type === 'uint16') {
        data += encodeUint(value);
      }
      else if (type === 'address') data += encodeAddress(value);
      else if (type === 'bool') data += encodeUint(value ? 1 : 0);
      else throw new Error('unsupported type: ' + type);
    });
    return data;
  }

  function decodeUint(hex) {
    const clean = strip0x(hex);
    if (clean.length === 0) return 0n;
    return BigInt('0x' + clean.slice(0, 64));
  }

  function decodeBool(hex) {
    return decodeUint(hex) !== 0n;
  }

  function decodeAddress(hex) {
    return '0x' + strip0x(hex).slice(24, 64);
  }

  /** Decodes a dynamic address[] return value. */
  function decodeAddressArray(hex) {
    const clean = strip0x(hex);
    if (clean.length < 128) return [];
    const length = Number(BigInt('0x' + clean.slice(64, 128)));
    const out = [];
    for (let i = 0; i < length; i++) {
      const word = clean.slice(128 + i * 64, 192 + i * 64);
      if (word.length < 64) break;
      out.push('0x' + word.slice(24));
    }
    return out;
  }

  /** Decodes three consecutive words, used by the packed deleverage plan. */
  function decodeThreeWords(hex) {
    const clean = strip0x(hex);
    const word = (i) => BigInt('0x' + (clean.slice(i * 64, (i + 1) * 64) || '0'));
    return {
      leadSeconds: Number(word(0)),
      targetBps: Number(word(1)),
      enabled: word(2) !== 0n
    };
  }

  /** Decodes two consecutive words, used by calls returning a pair. */
  function decodeTwoUints(hex) {
    const clean = strip0x(hex);
    return [
      BigInt('0x' + (clean.slice(0, 64) || '0')),
      BigInt('0x' + (clean.slice(64, 128) || '0'))
    ];
  }

  // ------------------------------------------------------------------
  // Fixed point helpers
  // ------------------------------------------------------------------

  const WAD = 10n ** 18n;

  /** Parses a human decimal string into base units. Never uses floating point. */
  function parseUnits(value, decimals) {
    const text = String(value).trim();
    if (!/^\d*\.?\d*$/.test(text) || text === '' || text === '.') {
      throw new Error('not a number');
    }
    const [whole, fraction = ''] = text.split('.');
    if (fraction.length > decimals) throw new Error('too many decimal places');
    const padded = fraction.padEnd(decimals, '0');
    return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(padded || '0');
  }

  /** Formats base units for display, truncating rather than rounding up. */
  function formatUnits(value, decimals, places) {
    const v = typeof value === 'bigint' ? value : BigInt(value);
    const negative = v < 0n;
    const abs = negative ? -v : v;
    const base = 10n ** BigInt(decimals);
    const whole = abs / base;
    const fraction = abs % base;

    const shown = places === undefined ? 4 : places;
    let fractionText = fraction.toString().padStart(decimals, '0').slice(0, shown);
    fractionText = fractionText.replace(/0+$/, '');

    const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (negative ? '-' : '') + wholeText + (fractionText ? '.' + fractionText : '');
  }

  /** Converts a per second WAD rate into an annual percentage, compounded. */
  function annualisedPercent(ratePerSecond) {
    const r = Number(ratePerSecond) / 1e18;
    if (!isFinite(r) || r <= 0) return 0;
    const annual = Math.pow(1 + r, 31536000) - 1;
    return isFinite(annual) ? annual * 100 : 0;
  }

  // ------------------------------------------------------------------
  // JSON-RPC (with multi-endpoint fallback)
  // ------------------------------------------------------------------

  let rpcId = 0;

  function getRpcUrls() {
    const list = [];
    if (CONFIG.rpcUrl) list.push(CONFIG.rpcUrl);
    if (Array.isArray(CONFIG.rpcFallbacks)) {
      CONFIG.rpcFallbacks.forEach(u => { if (u && !list.includes(u)) list.push(u); });
    }
    return list.length ? list : ['https://robinhood-rpc.publicnode.com'];
  }

  /** Read only call against the public RPC. Does not require a wallet. */
  async function rpc(method, params) {
    const urls = getRpcUrls();
    let lastError = null;

    for (const url of urls) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params: params || [] })
        });
        if (!response.ok) throw new Error('RPC HTTP ' + response.status);
        const body = await response.json();
        if (body.error) throw new Error(body.error.message || 'RPC error');
        return body.result;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('All RPC endpoints failed');
  }

  /**
   * Sends many eth_calls as a single JSON-RPC batch.
   *
   * A page that reads a pool and a position needs roughly twenty five contract calls.
   * Issued as twenty five separate HTTP requests every refresh, a public endpoint will
   * rate limit or simply drop them, which surfaces in the browser as "Failed to fetch"
   * with no further detail. One batched request avoids that entirely and is far faster.
   *
   * Individual entries can fail without failing the batch. A call that reverts returns
   * null for that entry, so one unavailable oracle cannot blank the whole interface.
   */
  async function batchCall(calls) {
    if (!calls.length) return [];
    const urls = getRpcUrls();
    let lastError = null;

    const payload = calls.map((call) => ({
      jsonrpc: '2.0',
      id: ++rpcId,
      method: 'eth_call',
      params: [{ to: call.to, data: call.data }, 'latest']
    }));

    for (const url of urls) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('RPC HTTP ' + response.status);
        const body = await response.json();
        const results = Array.isArray(body) ? body : [body];

        // Responses may return out of order, so they are matched by id rather than position.
        const byId = new Map(results.map((entry) => [entry.id, entry]));
        return payload.map((request) => {
          const entry = byId.get(request.id);
          if (!entry || entry.error) return null;
          return entry.result;
        });
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('All batch RPC endpoints failed');
  }

  /** eth_call against a contract, returning raw hex. */
  async function ethCall(to, data) {
    return rpc('eth_call', [{ to, data }, 'latest']);
  }

  // ------------------------------------------------------------------
  // Wallet
  // ------------------------------------------------------------------

  const wallet = {
    account: null,
    chainId: null,

    get provider() {
      return window.ethereum || null;
    },

    isAvailable() {
      return Boolean(window.ethereum);
    },

    /** Restores an existing connection without prompting. */
    async restore() {
      if (!this.provider) return null;
      try {
        const accounts = await this.provider.request({ method: 'eth_accounts' });
        if (accounts && accounts.length) {
          this.account = accounts[0];
          this.chainId = await this.provider.request({ method: 'eth_chainId' });
        }
      } catch (_) {
        // A wallet that refuses eth_accounts is simply treated as disconnected.
      }
      return this.account;
    },

    async connect() {
      if (!this.provider) {
        throw new Error('No wallet detected. Install a browser wallet to continue.');
      }
      const accounts = await this.provider.request({ method: 'eth_requestAccounts' });
      if (!accounts || !accounts.length) throw new Error('No account authorised');

      this.account = accounts[0];
      this.chainId = await this.provider.request({ method: 'eth_chainId' });
      return this.account;
    },

    isOnCorrectChain() {
      if (!this.chainId || !CONFIG.chainIdHex) return false;
      return this.chainId.toLowerCase() === CONFIG.chainIdHex.toLowerCase();
    },

    /** Switches the wallet to Robinhood Chain, adding it if unknown. */
    async switchChain() {
      if (!this.provider) throw new Error('No wallet detected');

      try {
        await this.provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: CONFIG.chainIdHex }]
        });
      } catch (error) {
        // 4902 means the wallet has never heard of this chain.
        if (error && (error.code === 4902 || error.code === -32603)) {
          await this.provider.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: CONFIG.chainIdHex,
              chainName: CONFIG.chainName,
              nativeCurrency: CONFIG.nativeCurrency,
              rpcUrls: [CONFIG.rpcUrl],
              blockExplorerUrls: CONFIG.explorerUrl ? [CONFIG.explorerUrl] : []
            }]
          });
        } else {
          throw error;
        }
      }

      this.chainId = await this.provider.request({ method: 'eth_chainId' });
    },

    /** Sends a transaction and returns its hash. Does not wait for inclusion. */
    async send(to, data) {
      if (!this.account) throw new Error('Wallet not connected');
      if (!this.isOnCorrectChain()) throw new Error('Wrong network');

      return this.provider.request({
        method: 'eth_sendTransaction',
        params: [{ from: this.account, to, data }]
      });
    },

    onChange(handler) {
      if (!this.provider || !this.provider.on) return;
      this.provider.on('accountsChanged', (accounts) => {
        this.account = accounts && accounts.length ? accounts[0] : null;
        handler();
      });
      this.provider.on('chainChanged', (chainId) => {
        this.chainId = chainId;
        handler();
      });
    }
  };

  // ------------------------------------------------------------------
  // Transaction confirmation
  // ------------------------------------------------------------------

  /**
   * Polls for a receipt. Resolves on success, rejects on revert.
   * A transaction that reverts still produces a receipt, with status zero, so a naive
   * implementation that only waits for a receipt reports failures as successes.
   */
  async function waitForReceipt(hash, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 180000);

    while (Date.now() < deadline) {
      const receipt = await rpc('eth_getTransactionReceipt', [hash]).catch(() => null);
      if (receipt) {
        if (receipt.status === '0x0') {
          throw new Error('Transaction reverted');
        }
        return receipt;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    throw new Error('Timed out waiting for confirmation');
  }

  /**
   * Turns a wallet or node error into something a person can act on.
   * Raw provider errors are unreadable and often contain the whole request object.
   */
  function describeError(error) {
    if (!error) return 'Something went wrong.';

    const code = error.code;
    if (code === 4001 || code === 'ACTION_REJECTED') return 'You rejected the transaction.';
    if (code === -32002) return 'A wallet request is already pending. Check your wallet.';

    const message = String(error.message || error).toLowerCase();

    if (message.includes('insufficient funds')) {
      return 'Not enough ETH to pay for gas.';
    }
    if (message.includes('user rejected') || message.includes('user denied')) {
      return 'You rejected the transaction.';
    }
    if (message.includes('positionunhealthy')) {
      return 'That would take the position past its borrow limit.';
    }
    if (message.includes('supplycapexceeded')) {
      return 'The pool supply cap has been reached.';
    }
    if (message.includes('borrowcapexceeded')) {
      return 'The pool borrow cap has been reached.';
    }
    if (message.includes('accountsupplycapexceeded')) {
      return 'That exceeds the per account supply cap.';
    }
    if (message.includes('accountcollateralcapexceeded')) {
      return 'That exceeds the per account collateral cap.';
    }
    if (message.includes('insufficientliquidity')) {
      return 'Not enough available liquidity in the pool right now.';
    }
    if (message.includes('accrualincomplete')) {
      return 'Interest is behind. Run Accrue interest, then try again.';
    }
    if (message.includes('stale') || message.includes('staleprice')) {
      return 'The price feed is stale. Actions are paused until it updates.';
    }
    if (message.includes('paused')) {
      return 'That action is currently paused.';
    }
    if (message.includes('assetnotenabled')) {
      return 'That asset is not accepted as collateral.';
    }
    if (message.includes('insufficientcollateral')) {
      return 'Not enough collateral of that asset.';
    }
    if (message.includes('nothingtorepay')) {
      return 'There is no debt to repay.';
    }
    if (message.includes('reverted')) {
      return 'The transaction was rejected by the contract.';
    }

    return error.message ? String(error.message).slice(0, 160) : 'Something went wrong.';
  }

  // ------------------------------------------------------------------
  // Contract reads
  // ------------------------------------------------------------------

  const pool = {
    get address() { return CONFIG.contracts && CONFIG.contracts.pool; },

    async totals() {
      const [supplied, borrowed, util, rate] = await Promise.all([
        ethCall(this.address, encodeCall('totalSupplyAssets()')),
        ethCall(this.address, encodeCall('totalBorrowAssets()')),
        ethCall(this.address, encodeCall('utilization()')),
        ethCall(this.address, encodeCall('borrowRatePerSecond()'))
      ]);
      return {
        supplied: decodeUint(supplied),
        borrowed: decodeUint(borrowed),
        utilization: decodeUint(util),
        borrowRatePerSecond: decodeUint(rate)
      };
    },

    async caps() {
      const [supplyCap, borrowCap, supplyRoom, borrowRoom] = await Promise.all([
        ethCall(this.address, encodeCall('supplyCap()')),
        ethCall(this.address, encodeCall('borrowCap()')),
        ethCall(this.address, encodeCall('supplyHeadroom()')),
        ethCall(this.address, encodeCall('borrowHeadroom()'))
      ]);
      return {
        supplyCap: decodeUint(supplyCap),
        borrowCap: decodeUint(borrowCap),
        supplyHeadroom: decodeUint(supplyRoom),
        borrowHeadroom: decodeUint(borrowRoom)
      };
    },

    async position(account) {
      const [shares, debt, limit, liqLimit, collateralValue, liquidatable] = await Promise.all([
        ethCall(this.address, encodeCall('balanceOf(address)', [['address', account]])),
        ethCall(this.address, encodeCall('debtOf(address)', [['address', account]])),
        ethCall(this.address, encodeCall('borrowLimitOf(address)', [['address', account]])),
        ethCall(this.address, encodeCall('liquidationLimitOf(address)', [['address', account]])),
        ethCall(this.address, encodeCall('collateralValueOf(address)', [['address', account]])),
        ethCall(this.address, encodeCall('isLiquidatable(address)', [['address', account]]))
      ]);

      const supplyShares = decodeUint(shares);
      let supplyAssets = 0n;
      if (supplyShares > 0n) {
        const converted = await ethCall(
          this.address, encodeCall('convertToAssets(uint256)', [['uint256', supplyShares]])
        );
        supplyAssets = decodeUint(converted);
      }

      return {
        supplyShares,
        supplyAssets,
        debt: decodeUint(debt),
        borrowLimit: decodeUint(limit),
        liquidationLimit: decodeUint(liqLimit),
        collateralValue: decodeUint(collateralValue),
        liquidatable: decodeBool(liquidatable)
      };
    },

    async convertToAssets(shares) {
      if (shares === 0n) return 0n;
      const raw = await ethCall(
        this.address, encodeCall('convertToAssets(uint256)', [['uint256', shares]])
      );
      return decodeUint(raw);
    },

    async collateralAssets(account) {
      const raw = await ethCall(
        this.address, encodeCall('collateralAssetsOf(address)', [['address', account]])
      );
      return decodeAddressArray(raw);
    },

    async collateralOf(account, asset) {
      const raw = await ethCall(
        this.address,
        encodeCall('collateralOf(address,address)', [['address', account], ['address', asset]])
      );
      return decodeUint(raw);
    },

    async paused() {
      const [supply, borrow] = await Promise.all([
        ethCall(this.address, encodeCall('supplyPaused()')),
        ethCall(this.address, encodeCall('borrowPaused()'))
      ]);
      return { supply: decodeBool(supply), borrow: decodeBool(borrow) };
    },

    async accrualCurrent() {
      const raw = await ethCall(this.address, encodeCall('isAccrualCurrent()'));
      return decodeBool(raw);
    }
  };

  const erc20 = {
    async balanceOf(token, account) {
      const raw = await ethCall(token, encodeCall('balanceOf(address)', [['address', account]]));
      return decodeUint(raw);
    },
    async allowance(token, owner, spender) {
      const raw = await ethCall(
        token, encodeCall('allowance(address,address)', [['address', owner], ['address', spender]])
      );
      return decodeUint(raw);
    },
    async decimals(token) {
      const raw = await ethCall(token, encodeCall('decimals()'));
      return Number(decodeUint(raw));
    }
  };

  const calendar = {
    get address() { return CONFIG.contracts && CONFIG.contracts.calendar; },

    async session() {
      const raw = await ethCall(this.address, encodeCall('currentSession()'));
      return Number(decodeUint(raw));
    },

    async secondsUntilOpen() {
      const raw = await ethCall(this.address, encodeCall('secondsUntilRegularOpen()'));
      const [seconds, resolved] = decodeTwoUints(raw);
      return { seconds, resolved: resolved !== 0n };
    }
  };

  const oracle = {
    get address() { return CONFIG.contracts && CONFIG.contracts.oracle; },

    async valueOf(asset, amount) {
      const raw = await ethCall(
        this.address, encodeCall('valueOf(address,uint256)', [['address', asset], ['uint256', amount]])
      );
      return decodeUint(raw);
    },

    async price(asset) {
      const raw = await ethCall(this.address, encodeCall('price(address)', [['address', asset]]));
      return decodeUint(raw);
    }
  };

  // ------------------------------------------------------------------
  // Contract writes
  // ------------------------------------------------------------------

  const actions = {
    approve(token, spender, amount) {
      return wallet.send(token,
        encodeCall('approve(address,uint256)', [['address', spender], ['uint256', amount]]));
    },
    supply(amount, onBehalf) {
      return wallet.send(pool.address,
        encodeCall('supply(uint256,address)', [['uint256', amount], ['address', onBehalf]]));
    },
    withdraw(shares, receiver) {
      return wallet.send(pool.address,
        encodeCall('withdraw(uint256,address)', [['uint256', shares], ['address', receiver]]));
    },
    depositCollateral(asset, amount, onBehalf) {
      return wallet.send(pool.address, encodeCall('depositCollateral(address,uint256,address)',
        [['address', asset], ['uint256', amount], ['address', onBehalf]]));
    },
    withdrawCollateral(asset, amount, receiver) {
      return wallet.send(pool.address, encodeCall('withdrawCollateral(address,uint256,address)',
        [['address', asset], ['uint256', amount], ['address', receiver]]));
    },
    borrow(amount, receiver) {
      return wallet.send(pool.address,
        encodeCall('borrow(uint256,address)', [['uint256', amount], ['address', receiver]]));
    },
    repay(amount, onBehalf) {
      return wallet.send(pool.address,
        encodeCall('repay(uint256,address)', [['uint256', amount], ['address', onBehalf]]));
    },
    accrueInterest() {
      return wallet.send(pool.address, encodeCall('accrueInterest()'));
    },

    depositBuffer(amount, onBehalf) {
      return wallet.send(pool.address,
        encodeCall('depositBuffer(uint256,address)', [['uint256', amount], ['address', onBehalf]]));
    },
    withdrawBuffer(amount, receiver) {
      return wallet.send(pool.address,
        encodeCall('withdrawBuffer(uint256,address)', [['uint256', amount], ['address', receiver]]));
    },
    setDeleveragePlan(leadSeconds, targetBps) {
      return wallet.send(pool.address, encodeCall('setDeleveragePlan(uint32,uint16)',
        [['uint32', leadSeconds], ['uint16', targetBps]]));
    },
    clearDeleveragePlan() {
      return wallet.send(pool.address, encodeCall('clearDeleveragePlan()'));
    },
    executeDeleverage(account) {
      return wallet.send(pool.address,
        encodeCall('executeDeleverage(address)', [['address', account]]));
    }
  };

  /**
   * Reads everything the interface needs in one batched request.
   *
   * Passing a null account reads pool level state only, which is what an unconnected
   * visitor sees. No wallet is required to view rates, utilisation or caps.
   */
  async function readEverything(account, collateralAssets) {
    const poolAddress = CONFIG.contracts.pool;
    const oracleAddress = CONFIG.contracts.oracle;
    const loanToken = CONFIG.loanToken.address;

    const calls = [];
    const push = (to, signature, args) => {
      calls.push({ to, data: encodeCall(signature, args) });
      return calls.length - 1;
    };

    const index = {
      supplied: push(poolAddress, 'totalSupplyAssets()'),
      borrowed: push(poolAddress, 'totalBorrowAssets()'),
      utilization: push(poolAddress, 'utilization()'),
      rate: push(poolAddress, 'borrowRatePerSecond()'),
      supplyCap: push(poolAddress, 'supplyCap()'),
      borrowCap: push(poolAddress, 'borrowCap()'),
      supplyHeadroom: push(poolAddress, 'supplyHeadroom()'),
      borrowHeadroom: push(poolAddress, 'borrowHeadroom()'),
      supplyPaused: push(poolAddress, 'supplyPaused()'),
      borrowPaused: push(poolAddress, 'borrowPaused()'),
      // Cash actually available to borrow, which is not the same as the borrow cap.
      poolCash: push(loanToken, 'balanceOf(address)', [['address', poolAddress]])
    };

    if (account) {
      index.shares = push(poolAddress, 'balanceOf(address)', [['address', account]]);
      index.debt = push(poolAddress, 'debtOf(address)', [['address', account]]);
      index.borrowLimit = push(poolAddress, 'borrowLimitOf(address)', [['address', account]]);
      index.liquidationLimit = push(poolAddress, 'liquidationLimitOf(address)', [['address', account]]);
      index.collateralValue = push(poolAddress, 'collateralValueOf(address)', [['address', account]]);
      index.liquidatable = push(poolAddress, 'isLiquidatable(address)', [['address', account]]);
      index.walletBalance = push(loanToken, 'balanceOf(address)', [['address', account]]);
      index.allowance = push(loanToken, 'allowance(address,address)',
        [['address', account], ['address', poolAddress]]);
      index.buffer = push(poolAddress, 'deleverageBuffer(address)', [['address', account]]);
      index.plan = push(poolAddress, 'deleveragePlan(address)', [['address', account]]);
      index.preview = push(poolAddress, 'previewDeleverage(address)', [['address', account]]);

      index.collateral = collateralAssets.map((asset) => ({
        address: asset.address,
        posted: push(poolAddress, 'collateralOf(address,address)',
          [['address', account], ['address', asset.address]]),
        wallet: push(asset.address, 'balanceOf(address)', [['address', account]]),
        allowance: push(asset.address, 'allowance(address,address)',
          [['address', account], ['address', poolAddress]]),
        unitPrice: push(oracleAddress, 'price(address)', [['address', asset.address]])
      }));
    }

    const raw = await batchCall(calls);
    const uint = (i) => (raw[i] == null ? 0n : decodeUint(raw[i]));
    const bool = (i) => (raw[i] == null ? false : decodeBool(raw[i]));

    const out = {
      totals: {
        supplied: uint(index.supplied),
        borrowed: uint(index.borrowed),
        utilization: uint(index.utilization),
        borrowRatePerSecond: uint(index.rate),
        cash: uint(index.poolCash)
      },
      caps: {
        supplyCap: uint(index.supplyCap),
        borrowCap: uint(index.borrowCap),
        supplyHeadroom: uint(index.supplyHeadroom),
        borrowHeadroom: uint(index.borrowHeadroom)
      },
      paused: {
        supply: bool(index.supplyPaused),
        borrow: bool(index.borrowPaused)
      },
      position: null,
      collateral: []
    };

    if (!account) return out;

    const shares = uint(index.shares);
    out.position = {
      supplyShares: shares,
      debt: uint(index.debt),
      borrowLimit: uint(index.borrowLimit),
      liquidationLimit: uint(index.liquidationLimit),
      collateralValue: uint(index.collateralValue),
      liquidatable: bool(index.liquidatable)
    };
    out.walletLoanBalance = uint(index.walletBalance);
    out.loanAllowance = uint(index.allowance);
    out.buffer = uint(index.buffer);

    // The plan is three packed values in one word each: lead seconds, target in basis
    // points, and whether it is enabled.
    const planRaw = raw[index.plan];
    out.plan = planRaw ? decodeThreeWords(planRaw) : null;

    const previewRaw = raw[index.preview];
    out.deleverage = previewRaw
      ? { repayable: BigInt('0x' + (strip0x(previewRaw).slice(0, 64) || '0')),
          due: BigInt('0x' + (strip0x(previewRaw).slice(64, 128) || '0')) !== 0n }
      : { repayable: 0n, due: false };

    out.collateral = index.collateral.map((entry, i) => {
      const asset = collateralAssets[i];
      const posted = uint(entry.posted);
      const unitPrice = uint(entry.unitPrice);
      // Value computed here rather than with another call, since the unit price is
      // already in hand and the arithmetic is exact.
      const value = posted === 0n || unitPrice === 0n
        ? 0n
        : (posted * unitPrice) / (10n ** BigInt(asset.decimals));

      return {
        ...asset,
        posted,
        value,
        walletBalance: uint(entry.wallet),
        allowance: uint(entry.allowance)
      };
    });

    return out;
  }

  // ------------------------------------------------------------------
  // Defined outcome pools
  // ------------------------------------------------------------------

  const SERIES_STATUS = ['None', 'Open', 'Live', 'Settled', 'Void'];

  /**
   * Decodes the Series struct.
   *
   * Every field is a static type, so the tuple returns as nine consecutive words with no
   * offset. If a dynamic field is ever added to the struct this decoder silently reads
   * the wrong values, so the field list here must track the contract.
   */
  function decodeSeries(hex) {
    const clean = strip0x(hex);
    if (clean.length < 576) return null;
    const word = (i) => clean.slice(i * 64, (i + 1) * 64);
    const uint = (i) => BigInt('0x' + (word(i) || '0'));

    return {
      asset: '0x' + word(0).slice(24),
      subscriptionEnd: Number(uint(1)),
      expiry: Number(uint(2)),
      strike: uint(3),
      sellerCollateral: uint(4),
      unitsSold: uint(5),
      premiumCollected: uint(6),
      settlementPrice: uint(7),
      status: SERIES_STATUS[Number(uint(8))] || 'Unknown'
    };
  }

  /**
   * A timestamp during the next weekend, used to show what borrowing power looks like
   * when the underlying market is shut.
   *
   * Saturday noon Eastern is chosen because it is unambiguously inside the closed window
   * regardless of daylight saving, which shifts the boundary by an hour twice a year.
   */
  function nextWeekendTimestamp() {
    const now = new Date();
    // Eastern is UTC-5 or UTC-4. Using -5 puts Saturday noon Eastern at 17:00 UTC, which
    // stays inside Saturday either way.
    const utc = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 17, 0, 0));

    // Advance to the coming Saturday. If today is already Saturday, use today.
    const daysUntilSaturday = (6 - utc.getUTCDay() + 7) % 7;
    utc.setUTCDate(utc.getUTCDate() + daysUntilSaturday);

    return Math.floor(utc.getTime() / 1000);
  }

  /**
   * What each collateral asset in a wallet would unlock, now and at the weekend.
   *
   * This is the concrete answer to why someone would post collateral at all. Rather than
   * describing the mechanism, it shows the two numbers for the assets they actually hold,
   * which also makes the closed-market behaviour obvious without a paragraph explaining it.
   */
  async function readUnlockable(account) {
    const assets = CONFIG.collateral || [];
    const engine = CONFIG.contracts && CONFIG.contracts.riskEngine;
    if (!account || !assets.length || !engine) return [];

    const weekend = nextWeekendTimestamp();
    const now = Math.floor(Date.now() / 1000);

    const calls = [];
    const index = assets.map((asset) => ({
      asset,
      balance: calls.push({
        to: asset.address, data: encodeCall('balanceOf(address)', [['address', account]])
      }) - 1,
      price: calls.push({
        to: CONFIG.contracts.oracle,
        data: encodeCall('price(address)', [['address', asset.address]])
      }) - 1,
      ltvNow: calls.push({
        to: engine,
        data: encodeCall('effectiveLtv(address,uint256)',
          [['address', asset.address], ['uint256', now]])
      }) - 1,
      ltvWeekend: calls.push({
        to: engine,
        data: encodeCall('effectiveLtv(address,uint256)',
          [['address', asset.address], ['uint256', weekend]])
      }) - 1
    }));

    const raw = await batchCall(calls).catch(() => []);
    const uint = (i) => (raw[i] == null ? 0n : decodeUint(raw[i]));

    return index.map((entry) => {
      const balance = uint(entry.balance);
      const price = uint(entry.price);
      const ltvNow = uint(entry.ltvNow);
      const ltvWeekend = uint(entry.ltvWeekend);

      // Value in WAD dollars, from a balance in the token's own decimals.
      const value = balance === 0n || price === 0n
        ? 0n
        : (balance * price) / (10n ** BigInt(entry.asset.decimals));

      return {
        ...entry.asset,
        balance,
        price,
        value,
        ltvNow,
        ltvWeekend,
        unlockNow: (value * ltvNow) / WAD,
        unlockWeekend: (value * ltvWeekend) / WAD
      };
    }).filter((row) => row.balance > 0n);
  }

  const outcome = {
    get address() { return CONFIG.contracts && CONFIG.contracts.outcomePool; },

    get configured() {
      return Boolean(this.address && !/^0x0{40}$/i.test(this.address));
    },

    /**
     * Reads every series, plus the caller's position in each, in one batch.
     *
     * Series identifiers run from one to nextSeriesId, so the whole set is readable
     * without an index or an event scan. That stops being true if the list grows large,
     * at which point this needs paginating rather than reading everything every refresh.
     */
    async readAll(account) {
      if (!this.configured) return [];

      const countRaw = await ethCall(this.address, encodeCall('nextSeriesId()'));
      const count = Number(decodeUint(countRaw)) - 1;
      if (count <= 0) return [];

      const calls = [];
      const index = [];
      for (let id = 1; id <= count; id++) {
        const entry = { id };
        entry.series = calls.push({
          to: this.address, data: encodeCall('seriesOf(uint256)', [['uint256', id]])
        }) - 1;
        entry.available = calls.push({
          to: this.address, data: encodeCall('availableUnits(uint256)', [['uint256', id]])
        }) - 1;
        entry.premium = calls.push({
          to: this.address, data: encodeCall('premiumPerUnit(uint256)', [['uint256', id]])
        }) - 1;

        if (account) {
          entry.stake = calls.push({
            to: this.address,
            data: encodeCall('sellerStake(uint256,address)', [['uint256', id], ['address', account]])
          }) - 1;
          entry.units = calls.push({
            to: this.address,
            data: encodeCall('unitsHeld(uint256,address)', [['uint256', id], ['address', account]])
          }) - 1;
          entry.claimable = calls.push({
            to: this.address,
            data: encodeCall('previewClaim(uint256,address)', [['uint256', id], ['address', account]])
          }) - 1;
        }
        index.push(entry);
      }

      const raw = await batchCall(calls);
      const uint = (i) => (i === undefined || raw[i] == null ? 0n : decodeUint(raw[i]));

      return index.map((entry) => {
        const series = raw[entry.series] ? decodeSeries(raw[entry.series]) : null;
        if (!series) return null;
        return {
          id: entry.id,
          ...series,
          availableUnits: uint(entry.available),
          premiumPerUnit: uint(entry.premium),
          myStake: uint(entry.stake),
          myUnits: uint(entry.units),
          myClaimable: uint(entry.claimable)
        };
      }).filter(Boolean);
    },

    postCollateral(id, amount) {
      return wallet.send(this.address,
        encodeCall('postCollateral(uint256,uint256)', [['uint256', id], ['uint256', amount]]));
    },
    buyProtection(id, units, maxPremium) {
      return wallet.send(this.address, encodeCall('buyProtection(uint256,uint256,uint256)',
        [['uint256', id], ['uint256', units], ['uint256', maxPremium]]));
    },
    settle(id) {
      return wallet.send(this.address, encodeCall('settle(uint256)', [['uint256', id]]));
    },
    claim(id) {
      return wallet.send(this.address, encodeCall('claim(uint256)', [['uint256', id]]));
    }
  };

  // ------------------------------------------------------------------
  // Past deployments
  // ------------------------------------------------------------------

  /**
   * Reads an account's position in every previous deployment.
   *
   * Immutable contracts mean a new version is a new address, and old positions do not
   * move by themselves. Rather than asking people to withdraw by a deadline, the app
   * looks at each past deployment and shows what is still there.
   *
   * Every read is failure tolerant. An old deployment might have a paused oracle or a
   * delisted asset, and none of that should stop the interface from telling someone they
   * have money in it. A balance that cannot be valued is still a balance.
   */
  async function readLegacy(account) {
    const deployments = CONFIG.legacyDeployments || [];
    if (!account || !deployments.length) return [];

    const calls = [];
    const index = deployments.map((d) => ({
      deployment: d,
      shares: calls.push({
        to: d.pool, data: encodeCall('balanceOf(address)', [['address', account]])
      }) - 1,
      debt: calls.push({
        to: d.pool, data: encodeCall('debtOf(address)', [['address', account]])
      }) - 1,
      collateralValue: calls.push({
        to: d.pool, data: encodeCall('collateralValueOf(address)', [['address', account]])
      }) - 1,
      buffer: calls.push({
        to: d.pool, data: encodeCall('deleverageBuffer(address)', [['address', account]])
      }) - 1
    }));

    const raw = await batchCall(calls).catch(() => []);
    const uint = (i) => (raw[i] == null ? 0n : decodeUint(raw[i]));

    const results = [];
    for (const entry of index) {
      const shares = uint(entry.shares);
      const debt = uint(entry.debt);
      const collateralValue = uint(entry.collateralValue);
      const buffer = uint(entry.buffer);

      // Nothing here, so nothing to show. An account with no history in an old
      // deployment should never see a card about it.
      if (shares === 0n && debt === 0n && collateralValue === 0n && buffer === 0n) continue;

      let supplyAssets = 0n;
      if (shares > 0n) {
        const converted = await ethCall(
          entry.deployment.pool, encodeCall('convertToAssets(uint256)', [['uint256', shares]])
        ).catch(() => null);
        supplyAssets = converted ? decodeUint(converted) : 0n;
      }

      results.push({
        ...entry.deployment,
        shares,
        supplyAssets,
        debt,
        collateralValue,
        buffer
      });
    }

    return results;
  }

  /// Withdrawals and repayments against an old deployment. Deliberately limited to the
  /// actions that reduce a position: nothing here lets someone open a new one.
  const legacy = {
    withdraw(poolAddress, shares, receiver) {
      return wallet.send(poolAddress,
        encodeCall('withdraw(uint256,address)', [['uint256', shares], ['address', receiver]]));
    },
    repay(poolAddress, amount, onBehalf) {
      return wallet.send(poolAddress,
        encodeCall('repay(uint256,address)', [['uint256', amount], ['address', onBehalf]]));
    },
    withdrawCollateral(poolAddress, asset, amount, receiver) {
      return wallet.send(poolAddress, encodeCall('withdrawCollateral(address,uint256,address)',
        [['address', asset], ['uint256', amount], ['address', receiver]]));
    },
    withdrawBuffer(poolAddress, amount, receiver) {
      return wallet.send(poolAddress,
        encodeCall('withdrawBuffer(uint256,address)', [['uint256', amount], ['address', receiver]]));
    },
    collateralOf(poolAddress, account, asset) {
      return ethCall(poolAddress,
        encodeCall('collateralOf(address,address)', [['address', account], ['address', asset]])
      ).then((raw) => (raw ? decodeUint(raw) : 0n)).catch(() => 0n);
    }
  };

  // ------------------------------------------------------------------
  // Supply rebate
  // ------------------------------------------------------------------

  /**
   * The rebate returns part of the protocol's own fee to suppliers holding POND. It does
   * not create yield, and the interface should never imply otherwise.
   */
  const rebate = {
    get address() { return CONFIG.contracts && CONFIG.contracts.supplyRebate; },

    get configured() {
      return Boolean(this.address && !/^0x0{40}$/i.test(this.address));
    },

    /**
     * Everything about an account's rebate position, in one call.
     *
     * statusOf returns six words: supplied, acreBalance, tierIndex, rebateBps, pending
     * and banked. Decoded positionally, so a change to the contract's return order would
     * silently shift every value.
     */
    async statusOf(account) {
      if (!this.configured || !account) return null;

      const raw = await ethCall(
        this.address, encodeCall('statusOf(address)', [['address', account]])
      ).catch(() => null);
      if (!raw) return null;

      const clean = strip0x(raw);
      if (clean.length < 384) return null;
      const word = (i) => BigInt('0x' + (clean.slice(i * 64, (i + 1) * 64) || '0'));

      return {
        supplied: word(0),
        acreBalance: word(1),
        tierIndex: Number(word(2)),
        rebateBps: Number(word(3)),
        pending: word(4),
        banked: word(5)
      };
    },

    /// Whether the contract can currently pay what it has promised. Worth surfacing: a
    /// rebate that accrues and cannot pay is worse than none, and this is how that shows.
    async solvency() {
      if (!this.configured) return null;
      const raw = await ethCall(this.address, encodeCall('solvency()')).catch(() => null);
      if (!raw) return null;

      const clean = strip0x(raw);
      const word = (i) => BigInt('0x' + (clean.slice(i * 64, (i + 1) * 64) || '0'));
      return { owed: word(0), held: word(1), covered: word(2) !== 0n };
    },

    claim() {
      return wallet.send(this.address, encodeCall('claim()'));
    },

    /// Banks what has accrued without withdrawing it. Useful before a balance changes,
    /// since the rebate pays on the lower of the start and end balance for a period.
    checkpoint(account) {
      return wallet.send(this.address,
        encodeCall('checkpoint(address)', [['address', account]]));
    }
  };

  // ------------------------------------------------------------------
  // Deposit router
  // ------------------------------------------------------------------

  /**
   * Deposit by transfer.
   *
   * Every account has an address derived from theirs. Anything sent there is credited to
   * them, whoever sent it. This is for holders in apps that can send tokens but cannot
   * call contracts, which is most of the tokenized equity market.
   */
  const deposits = {
    get address() { return CONFIG.contracts && CONFIG.contracts.depositRouter; },

    get configured() {
      return Boolean(this.address && !/^0x0{40}$/i.test(this.address));
    },

    /**
     * Every action address for an account, plus whatever is waiting at each.
     *
     * Read in one batch. Each action has its own address, so a transfer carries an
     * instruction: send a supported token to deposit, send your supply shares to
     * withdraw, send the loan token to repay.
     *
     * There is deliberately no borrow address. A deposit address cannot tell who sent
     * the tokens, which is what makes it work, and for borrowing that is fatal: anyone
     * could send dust and force somebody into debt.
     */
    async addressesFor(account) {
      if (!this.configured || !account) return null;

      const calls = [
        { to: this.address, data: encodeCall('depositAddressOf(address)', [['address', account]]) },
        { to: this.address, data: encodeCall('withdrawAddressOf(address)', [['address', account]]) },
        { to: this.address, data: encodeCall('repayAddressOf(address)', [['address', account]]) },
        { to: this.address, data: encodeCall('pendingWithdrawal(address)', [['address', account]]) },
        { to: this.address, data: encodeCall('pendingRepayment(address)', [['address', account]]) }
      ];

      const raw = await batchCall(calls);
      if (!raw[0] || !raw[1] || !raw[2]) return null;

      return {
        deposit: decodeAddress(raw[0]),
        withdraw: decodeAddress(raw[1]),
        repay: decodeAddress(raw[2]),
        pendingWithdrawal: raw[3] == null ? 0n : decodeUint(raw[3]),
        pendingRepayment: raw[4] == null ? 0n : decodeUint(raw[4])
      };
    },

    /// The deposit address alone, for callers that need nothing else.
    async addressOf(account) {
      if (!this.configured || !account) return null;
      const raw = await ethCall(
        this.address, encodeCall('depositAddressOf(address)', [['address', account]])
      ).catch(() => null);
      return raw ? decodeAddress(raw) : null;
    },

    /// What is sitting in a deposit address across every accepted token, in one batch.
    async pending(account) {
      if (!this.configured || !account) return [];

      const tokens = [
        { ...CONFIG.loanToken, isLoan: true },
        ...CONFIG.collateral.map((c) => ({ ...c, isLoan: false }))
      ];

      const calls = tokens.map((t) => ({
        to: this.address,
        data: encodeCall('pendingOf(address,address)',
          [['address', account], ['address', t.address]])
      }));

      const raw = await batchCall(calls).catch(() => []);

      return tokens.map((token, i) => ({
        ...token,
        amount: raw[i] == null ? 0n : decodeUint(raw[i])
      })).filter((row) => row.amount > 0n);
    },

    /**
     * Everything an account has in the system, wherever it currently sits.
     *
     * Money moving through deposit by transfer passes through states that look like
     * nothing at all if you only check one place: sent but not yet collected, collected
     * into a position, sent back but not yet processed. Somebody who cannot see which
     * state they are in reasonably concludes their funds have vanished.
     */
    async fullStatus(account) {
      if (!account) return null;

      const poolAddress = CONFIG.contracts.pool;
      const tokens = [
        { ...CONFIG.loanToken, isLoan: true },
        ...CONFIG.collateral.map((c) => ({ ...c, isLoan: false }))
      ];

      const calls = [];
      const at = {};

      // In the wallet.
      at.wallet = tokens.map((t) => calls.push({
        to: t.address, data: encodeCall('balanceOf(address)', [['address', account]])
      }) - 1);

      // Credited as a position.
      at.shares = calls.push({
        to: poolAddress, data: encodeCall('balanceOf(address)', [['address', account]])
      }) - 1;
      at.debt = calls.push({
        to: poolAddress, data: encodeCall('debtOf(address)', [['address', account]])
      }) - 1;
      at.collateral = CONFIG.collateral.map((c) => calls.push({
        to: poolAddress,
        data: encodeCall('collateralOf(address,address)',
          [['address', account], ['address', c.address]])
      }) - 1);

      // In transit, if the router is deployed.
      if (this.configured) {
        at.awaitingDeposit = tokens.map((t) => calls.push({
          to: this.address,
          data: encodeCall('pendingOf(address,address)',
            [['address', account], ['address', t.address]])
        }) - 1);
        at.awaitingWithdrawal = calls.push({
          to: this.address,
          data: encodeCall('pendingWithdrawal(address)', [['address', account]])
        }) - 1;
        at.awaitingRepayment = calls.push({
          to: this.address,
          data: encodeCall('pendingRepayment(address)', [['address', account]])
        }) - 1;
      }

      const raw = await batchCall(calls);
      const uint = (i) => (i === undefined || raw[i] == null ? 0n : decodeUint(raw[i]));

      const shares = uint(at.shares);
      let supplied = 0n;
      if (shares > 0n) {
        supplied = await ethCall(poolAddress,
          encodeCall('convertToAssets(uint256)', [['uint256', shares]])
        ).then(decodeUint).catch(() => 0n);
      }

      return {
        wallet: tokens.map((t, i) => ({ ...t, amount: uint(at.wallet[i]) }))
          .filter((r) => r.amount > 0n),

        supplied,
        shares,
        debt: uint(at.debt),
        collateral: CONFIG.collateral.map((c, i) => ({
          ...c, amount: uint(at.collateral[i])
        })).filter((r) => r.amount > 0n),

        awaitingDeposit: this.configured
          ? tokens.map((t, i) => ({ ...t, amount: uint(at.awaitingDeposit[i]) }))
              .filter((r) => r.amount > 0n)
          : [],
        awaitingWithdrawal: uint(at.awaitingWithdrawal),
        awaitingRepayment: uint(at.awaitingRepayment)
      };
    },

    /**
     * Everything sitting at every action address, across every token.
     *
     * Read in one batch. Somebody will send the wrong thing to the wrong address, so each
     * address is checked for every token rather than only the one it expects. A balance
     * that is not shown is a balance somebody thinks they have lost.
     */
    async holdings(account) {
      if (!this.configured || !account) return null;

      const tokens = [
        { ...CONFIG.loanToken, kind: 'loan' },
        ...CONFIG.collateral.map((c) => ({ ...c, kind: 'collateral' })),
        {
          address: CONFIG.contracts.pool,
          symbol: CONFIG.shareSymbol || 'aUSDG',
          name: 'Your supply position',
          decimals: 18,
          kind: 'shares'
        }
      ];

      const addressCalls = [
        { to: this.address, data: encodeCall('depositAddressOf(address)', [['address', account]]) },
        { to: this.address, data: encodeCall('withdrawAddressOf(address)', [['address', account]]) },
        { to: this.address, data: encodeCall('repayAddressOf(address)', [['address', account]]) }
      ];

      const addressRaw = await batchCall(addressCalls);
      if (!addressRaw[0] || !addressRaw[1] || !addressRaw[2]) return null;

      const addresses = {
        deposit: decodeAddress(addressRaw[0]),
        withdraw: decodeAddress(addressRaw[1]),
        repay: decodeAddress(addressRaw[2])
      };

      // Balance of every token at every address. Twenty seven reads, one request.
      const balanceCalls = [];
      const index = [];
      for (const [action, where] of Object.entries(addresses)) {
        for (const token of tokens) {
          index.push({ action, token });
          balanceCalls.push({
            to: token.address,
            data: encodeCall('balanceOf(address)', [['address', where]])
          });
        }
      }

      const balances = await batchCall(balanceCalls).catch(() => []);

      const waiting = { deposit: [], withdraw: [], repay: [] };
      index.forEach((entry, i) => {
        const amount = balances[i] == null ? 0n : decodeUint(balances[i]);
        if (amount === 0n) return;

        // Whether this token belongs at this address, which decides whether it is on its
        // way in or simply in the wrong place.
        const expected =
          (entry.action === 'deposit' && entry.token.kind !== 'shares') ||
          (entry.action === 'withdraw' && entry.token.kind === 'shares') ||
          (entry.action === 'repay' && entry.token.kind === 'loan');

        waiting[entry.action].push({ ...entry.token, amount, expected });
      });

      return { addresses, waiting };
    },

    /// Returns a token from an action address to its owner. Callable by anyone, and the
    /// funds only ever go to the owner, because somebody who cannot call contracts cannot
    /// rescue their own tokens.
    rescue(account, action, token) {
      return wallet.send(this.address, encodeCall('rescue(address,uint8,address)',
        [['address', account], ['uint256', action], ['address', token]]));
    }
  };

  const MAX_UINT256 = (1n << 256n) - 1n;

  window.PondWeb3 = window.AcreWeb3 = {
    CONFIG,
    isConfigured,
    WAD,
    MAX_UINT256,
    parseUnits,
    formatUnits,
    annualisedPercent,
    encodeCall,
    decodeUint,
    rpc,
    ethCall,
    batchCall,
    readEverything,
    wallet,
    waitForReceipt,
    describeError,
    pool,
    erc20,
    calendar,
    oracle,
    outcome,
    rebate,
    deposits,
    readLegacy,
    legacy,
    readUnlockable,
    nextWeekendTimestamp,
    actions
  };
})();
