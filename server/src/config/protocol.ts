/**
 * Strongly-typed protocol configuration.
 *
 * Mirrors `pond-config.js` from the frontend so the backend can answer read-only
 * queries about the protocol without round-tripping to the chain for every static fact.
 * If the contracts are redeployed only this file needs to change.
 */

export interface TokenMeta {
  address: `0x${string}` | string;
  symbol: string;
  name?: string;
  decimals: number;
}

export interface CollateralAsset extends TokenMeta {
  correlationGroup: number;
}

export interface RebateTier {
  name: string;
  minimum: string;
  bps: number;
}

export interface LegacyDeployment {
  label: string;
  pool: `0x${string}`;
  oracle?: `0x${string}`;
  note: string;
}

export interface ProtocolContracts {
  pool: `0x${string}`;
  riskEngine: `0x${string}`;
  oracle: `0x${string}`;
  calendar: `0x${string}`;
  timelock: `0x${string}`;
  outcomePool: `0x${string}`;
  supplyRebate: `0x${string}`;
  depositRouter: `0x${string}`;
  loanTokenFeed: `0x${string}`;
}

export interface ProtocolConfig {
  chainName: string;
  chainId: number;
  chainIdHex: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  contracts: ProtocolContracts;
  legacyDeployments: LegacyDeployment[];
  acreToken: TokenMeta;
  pondToken?: TokenMeta;
  loanToken: TokenMeta & { symbol: string };
  collateral: CollateralAsset[];
  rebateTiers: RebateTier[];
  shareSymbol: string;
  keeperWatchUrl: string;
  noticeBanner: string;
}

export const PROTOCOL_CONFIG: ProtocolConfig = {
  chainName: 'Robinhood Chain',
  chainId: 4663,
  chainIdHex: '0x1237',
  rpcUrl: process.env.RPC_URL || 'https://rpc.mainnet.chain.robinhood.com/',
  explorerUrl: '',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },

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

  legacyDeployments: [
    {
      label: '28 August 2026',
      pool: '0x837f9568b7Cdb95D4188122Bb45971Cb28311449',
      oracle: '0xE9AA60f6dDD88ba21AEdcB0E2Beaf8C66368b7b1',
      note:
        'The original deployment. Predates auto-deleverage, defined outcome pools and the ' +
        'risk tier framework, and listed only NVDA, TSLA and SPCX.'
    }
  ],

  acreToken: {
    address: '',
    symbol: 'POND',
    name: 'Pond Token',
    decimals: 18
  },
  pondToken: {
    address: '',
    symbol: 'ACRE',
    name: 'Acre Token',
    decimals: 18
  },

  loanToken: {
    address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
    symbol: 'USDG',
    name: 'USDG',
    decimals: 6
  },

  collateral: [
    { address: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9', symbol: 'AAPL',  name: 'Tokenized Apple',     decimals: 18, correlationGroup: 2 },
    { address: '0xe93237C50D904957Cf27E7B1133b510C669c2e74', symbol: 'MSFT',  name: 'Tokenized Microsoft', decimals: 18, correlationGroup: 2 },
    { address: '0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3', symbol: 'GOOGL', name: 'Tokenized Alphabet',  decimals: 18, correlationGroup: 2 },
    { address: '0x12f190a9F9d7D37a250758b26824B97CE941bF54', symbol: 'AMZN',  name: 'Tokenized Amazon',    decimals: 18, correlationGroup: 2 },
    { address: '0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35', symbol: 'META',  name: 'Tokenized Meta',      decimals: 18, correlationGroup: 2 },
    { address: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC', symbol: 'NVDA',  name: 'Tokenized NVIDIA',    decimals: 18, correlationGroup: 2 },
    { address: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d', symbol: 'TSLA',  name: 'Tokenized Tesla',     decimals: 18, correlationGroup: 4 },
    { address: '0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa', symbol: 'SPCX',  name: 'Tokenized SpaceX',    decimals: 18, correlationGroup: 6 }
  ],

  rebateTiers: [
    { name: 'Bronze',   minimum: '250000',   bps: 50 },
    { name: 'Silver',   minimum: '1000000',  bps: 125 },
    { name: 'Gold',     minimum: '5000000',  bps: 250 },
    { name: 'Platinum', minimum: '25000000', bps: 500 }
  ],

  shareSymbol: 'aUSDG',
  keeperWatchUrl: process.env.KEEPER_WATCH_URL || 'https://usepond.xyz/watch',
  noticeBanner: ''
};
