module.exports = {
  privateKey: 'REPLACE_ME',

  // DB

  dbPath: 'dbs/mainnet.db',

  // Orderbook connection

  orderbookEndpoint: 'wss://degens.com/ws',
  versionName: 'REPLACE_ME',

  // Reflector connection

  reflectorUrl: 'REPLACE_ME',
  reflectorApiKey: 'REPLACE_ME',

  // Network config

  chainId: 1,
  contractAddr: '0x8888888883585b9a8202Db34D8b09d7252bfc61C',
  tokenAddr: '0x6B175474E89094C44Da98b954EedeAC495271d0F',

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
      baseAmount: 50,
      markupMult: 1,
    },
    {
      sport: 'Soccer',
      oddsSource: 'betfair',
      baseAmount: 40,
      markupMult: 1.01,
    }
  ],
};
