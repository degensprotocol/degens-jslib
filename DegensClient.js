const ethers = require('ethers');
const WebSocket = require('ws');
const {applyPatches, enablePatches} = require('immer');

const OrderbookClient = require('./OrderbookClient');
const degensUtils = require('./DegensUtils');


enablePatches();


const defaultOpts = {
    endpoint: 'wss://degens.com/ws',
    contractAddr: '0x8888888883585b9a8202Db34D8b09d7252bfc61C',
};


class DegensClient {
    _resetData() {
        this.data = {
            account: {},
            positions: {},
            orderFills: {},
        };
    }

    constructor(opts_) {
        this.opts = { ...defaultOpts, ...opts_, };

        this._resetData();

        this.oc = new OrderbookClient({
            version: this.opts.version,
            endpoint: this.opts.endpoint,

            WebSocket,

            onConnect: (helloResponse) => {
                this.data.config = helloResponse.config;
                this._processConfig();

                if (this.opts.onConnect) this.opts.onConnect(this);
            },
            onDisconnect: () => {
                if (this.opts.onDisconnect) this.opts.onDisconnect(this);
                this._resetData();
            },
        });

        this.oc.connect();
    }


    getEvents() {
        if (this.data.events) return this.data.events.recs;
        return {};
    }


    _processConfig() {
        this.data.tokenAddr2Sym = {};

        for (let sym of Object.keys(this.data.config.tokens)) {
            let tokenInfo = { sym, ...this.data.config.tokens[sym], };
            this.data.tokenAddr2Sym[tokenInfo.addr.toLowerCase()] = tokenInfo;
        }
    }


    _sub(spec, getter, setter) {
        this.oc.sub(spec, (err, patch) => {
            if (err) {
                console.error(`ERROR from orderbook: ${err}`);
                return;
            }

            for (let p of patch) p.path = p.path.split('/').filter(e => e !== '');

            let orig = getter();
            let updated = applyPatches(orig, patch);

            if (orig !== updated) {
                setter(updated);
                if (this.opts.onUpdate) this.opts.onUpdate();
            }
        });
    }


    subscribeAccount(addr, extras) {
        this._sub(
            { to: "account", addr, },
            () => this.data.account[addr],
            (v) => this.data.account[addr] = v,
        );

        if (extras.positions) {
            this._sub(
                { to: "positions", addr, },
                () => this.data.positions[addr],
                (v) => this.data.positions[addr] = v,
            );
        }

        if (extras.orderFills) {
            this._sub(
                { to: "orderFills", maker: addr, },
                () => this.data.orderFills[addr],
                (v) => this.data.orderFills[addr] = v,
            );
        }
    }

    subscribeEvents() {
        this._sub(
            { to: "events", },
            () => this.data.events,
            (v) => this.data.events = v,
        );
    }

    subscribeGasPrices() {
        this._sub(
            { to: "gasPrices", },
            () => this.data.gasPrices,
        );
    }
}


module.exports = DegensClient;
