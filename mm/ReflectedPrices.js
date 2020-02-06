const fetch = require('node-fetch');

class ReflectedPrices {
    constructor(opts) {
        this.opts = opts;

        if (!this.opts.reflectorUrl) throw(`ReflectedPrices needs a reflectorUrl`);
        if (!this.opts.reflectorApiKey) throw(`ReflectedPrices needs a reflectorApiKey`);

        if (!this.opts.interval) this.opts.interval = 30000;

        this.data = {};

        this.intervalHandle = setInterval(() => this.doPoll(), this.opts.interval);
        this.doPoll();
    }

    async doPoll() {
        let currEtags = {};

        for (let eventId of Object.keys(this.data || {})) {
            currEtags[this.data[eventId].etag] = 1;
        }

        let resp;

        try {
            resp = await fetch(this.opts.reflectorUrl, {
                               method: 'post',
                               headers: {
                                   'Authorization': `Bearer ${this.opts.reflectorApiKey}`,
                                   'Content-Type': 'application/json',
                               },
                               body: JSON.stringify(currEtags),
                           });

            if (resp.status !== 200) throw(`failed with status ${resp.status}`);
        } catch(e) {
            console.log(`ERROR hitting reflector: ${e}`);
            return undefined;
        }

        let items = await resp.json();

        this.data = { ...this.data, ...items, };

        if (this.opts.onUpdate) this.opts.onUpdate(this.data);
    }

    getEvent(eventId) {
        if (this.data && this.data[eventId]) return this.data[eventId].data.reflector;
        return undefined;
    }
}

module.exports = ReflectedPrices;
