// ============================================================================
// 🚀 POND PROTOCOL & TOKEN CONFIGURATION (SINGLE SOURCE OF TRUTH)
// ============================================================================
// Saat listing atau deploy token/kontrak baru, Anda HANYA PERLU MENGUBAH
// konfigurasi di bawah ini (1 file ini saja). Seluruh halaman website
// (Landing page, Footer, Docs Table, App, dll.) akan otomatis ter-update!
// ============================================================================

window.POND_CONFIG = window.ACRE_CONFIG = {

  // ------------------------------------------------------------------
  // 1. TOKEN UTAMA ANDA (POND / Governance Token)
  // ------------------------------------------------------------------
  // ⚠️ SAAT LISTING: CUKUP TEMPEL ALAMAT KONTRAK TOKEN DI SINI:
  acreToken: {
    address: '', // <-- Contoh: '0x1234567890123456789012345678901234567890'
    symbol: 'POND',
    name: 'Pond Token',
    decimals: 18
  },

  // ------------------------------------------------------------------
  // 2. TOKEN PINJAMAN (Stablecoin / Loan Asset)
  // ------------------------------------------------------------------
  loanToken: {
    address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
    symbol: 'USDG',
    decimals: 6
  },

  // ------------------------------------------------------------------
  // 3. JARINGAN BLOCKCHAIN & RPC
  // ------------------------------------------------------------------
  chainName: 'Robinhood Chain',
  chainIdHex: '0x1237', // 4663
  rpcUrl: 'https://robinhood-rpc.publicnode.com',
  rpcFallbacks: [
    'https://robinhood.rpc.blxrbdn.com',
    'https://robinhood.api.pocket.network',
    'https://rpc-robinhood.blockmachine.io'
  ],
  explorerUrl: 'https://robinscan.io',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },

  // ------------------------------------------------------------------
  // 4. SMART CONTRACTS PROTOKOL
  // ------------------------------------------------------------------
  contracts: {
    pool: '0x82bD35a34891F1D8B543313101C06CF31b8daD1E',
    riskEngine: '0xdd7eF595DEea942D05Fd974E6946931ea0DC28A4',
    oracle: '0xaB1C64921dE1928a5C3Ee06bc37fAEa7b5C9D703',
    calendar: '0x351866f5f038d7233d3fb14C7dd822F62C0bC881',
    timelock: '0xe19f3b52922C126781E0e47028D3d2b2411a271d',
    outcomePool: '0xdA9E51d56d5F1cBC1d9b3FA69658b9d7F37bA4a1',
    supplyRebate: '0x4Ac5031aE0c91c70eC1310E38573757487e6D0B7',
    depositRouter: '0xAe087498e85ff50BB59eb91E77f6580d2a3cEE0D',
    loanTokenFeed: '0x32e20B845A6EC481F919fEDC26FCEa60b803167C'
  },

  // ------------------------------------------------------------------
  // 5. TIER DISKON RABAT REWARD
  // ------------------------------------------------------------------
  rebateTiers: [
    { name: 'Bronze',   minimum: '250000',   bps: 50 },
    { name: 'Silver',   minimum: '1000000',  bps: 125 },
    { name: 'Gold',     minimum: '5000000',  bps: 250 },
    { name: 'Platinum', minimum: '25000000', bps: 500 }
  ],

  // ------------------------------------------------------------------
  // 6. ASET SAHAM TER-TOKENISASI (COLLATERAL)
  // ------------------------------------------------------------------
  collateral: [
    {
      address: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9',
      symbol: 'AAPL', name: 'Tokenized Apple', decimals: 18, correlationGroup: 2
    },
    {
      address: '0xe93237C50D904957Cf27E7B1133b510C669c2e74',
      symbol: 'MSFT', name: 'Tokenized Microsoft', decimals: 18, correlationGroup: 2
    },
    {
      address: '0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3',
      symbol: 'GOOGL', name: 'Tokenized Alphabet', decimals: 18, correlationGroup: 2
    },
    {
      address: '0x12f190a9F9d7D37a250758b26824B97CE941bF54',
      symbol: 'AMZN', name: 'Tokenized Amazon', decimals: 18, correlationGroup: 2
    },
    {
      address: '0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35',
      symbol: 'META', name: 'Tokenized Meta', decimals: 18, correlationGroup: 2
    },
    {
      address: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC',
      symbol: 'NVDA', name: 'Tokenized NVIDIA', decimals: 18, correlationGroup: 2
    },
    {
      address: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d',
      symbol: 'TSLA', name: 'Tokenized Tesla', decimals: 18, correlationGroup: 4
    },
    {
      address: '0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa',
      symbol: 'SPCX', name: 'Tokenized SpaceX', decimals: 18, correlationGroup: 6
    }
  ],

  // ------------------------------------------------------------------
  // 7. PENGATURAN TAMPILAN
  // ------------------------------------------------------------------
  shareSymbol: 'aUSDG',
  refreshIntervalMs: 20000,
  keeperWatchUrl: 'https://usepond.xyz/watch',
  noticeBanner: ''
};

// ============================================================================
// 🔄 AUTOMATIC WEBSITE SYNC HELPER
// ============================================================================
// Mengupdate footer, tabel docs, dan badge secara otomatis di semua halaman
// ============================================================================
(function autoSyncToWebsite() {
  function sync() {
    const config = window.POND_CONFIG || window.ACRE_CONFIG;
    if (!config) return;

    const token = config.acreToken || {};
    const addr = (token.address || '').trim();
    const symbol = token.symbol || 'POND';
    const explorer = (config.explorerUrl || 'https://robinscan.io').replace(/\/$/, '');

    // 1. Sinkronisasi Footer Token di Semua Halaman
    document.querySelectorAll('.footer-token, [data-token-display]').forEach(el => {
      if (addr) {
        el.innerHTML = `
          <strong>${symbol} token</strong>
          <code class="footer-address"><a href="${explorer}/token/${addr}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none;">${addr}</a></code>
          <span class="footer-address-note">Verify before interacting. Lookalike addresses are common.</span>
        `;
      } else {
        el.innerHTML = `
          <strong>${symbol} token</strong>
          <span class="footer-address-note">Token address will be announced officially.</span>
        `;
      }
    });

    // 2. Sinkronisasi Baris Tabel di Docs (docs.html)
    document.querySelectorAll('[data-token-table-address]').forEach(el => {
      if (addr) {
        el.innerHTML = `<a href="${explorer}/token/${addr}" target="_blank" rel="noopener noreferrer" style="color:inherit;">${addr}</a>`;
      } else {
        el.textContent = '—';
      }
    });

    // 3. Sinkronisasi Footer Token Meta (app.html)
    document.querySelectorAll('.footer-meta-token').forEach(el => {
      if (addr) {
        el.innerHTML = `${symbol} <code class="footer-address">${addr}</code>`;
        el.style.display = '';
      } else {
        el.style.display = 'none';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sync);
  } else {
    sync();
  }
})();
