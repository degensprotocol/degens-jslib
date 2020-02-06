module.exports = {
  privateKey: '0x6f0590cd2507d54c0c6f75968787e2f188a1b20f461c227a20bff4fcdb9e5ad0',

  // DB

  dbPath: 'dbs/dev.db',

  // Orderbook connection

  orderbookEndpoint: 'ws://localhost:7900',
  versionName: 'test mm code',

  // Reflector connection

  reflectorUrl: 'http://localhost:46111',
  reflectorApiKey: 'junkkey',

  // Network config

  chainId: 17,
  contractAddr: '0xcf37ae5ee9d0E686c1fC586E32BC5a806A9029A5',
  tokenAddr: '0x4ECAe7754A14Bb85381C8021077128a8b3B41455',

  // Order config

  orderExpiryTimeSeconds: 60 * 5,
  orderRefreshTimeSeconds: 60,

  marketTypeLimits: {
      spread: 2,
      total: 2,
  },

  defaultStrategy: {
      oddsLimit: 1.2,
  },

  strategies: [
    {
      sport: (v) => v !== 'Soccer',
      oddsSource: 'bet365',
      baseAmount: 20,
      markupMult: 1,
    },
    {
      sport: 'Soccer',
      oddsSource: 'betfair',
      baseAmount: 30,
      markupMult: 1.01,
    }
  ],
};
