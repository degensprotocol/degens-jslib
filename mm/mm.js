const Database = require('better-sqlite3');
const ethers = require('ethers');

const DegensClient = require('../lib/DegensClient');
const DegensUtils = require('../lib/DegensUtils');
const DegensContractLib = require('../lib/DegensContractLib');
const ReflectedPrices = require('./ReflectedPrices');


const pollIntervalSeconds = 2;


const configPath = process.argv[2];
if (!configPath) throw(`need config path as argument`);
const config = require(configPath);


let myAddress = config.privateKey ? (new ethers.Wallet(config.privateKey)).address.toLowerCase() : undefined;
console.log(`Using address: ${myAddress}`);



const db = new Database(config.dbPath);

let lastEventUpdate = {};




let dc = new DegensClient({
    endpoint: config.orderbookEndpoint,
    version: config.versionName,
    onConnect: () => doUpdates(),
    onUpdate: () => doUpdates(),
});

dc.subscribeAccount(myAddress, {
    positions: true,
    orderFills: true,
});

dc.subscribeEvents();



let rc = new ReflectedPrices({
    reflectorUrl: config.reflectorUrl,
    reflectorApiKey: config.reflectorApiKey,
    onUpdate: () => doUpdates(),
});



setInterval(doUpdates, pollIntervalSeconds*1000);





function doUpdates() {
    if (!dc.data.config) return;
    if (!dc.data.positions[myAddress]) return;
    if (!dc.data.orderFills[myAddress]) return;

    DegensUtils.withMutexGate('doUpdates', async () => {
        let tokenInfo = dc.data.tokenAddr2Sym[config.tokenAddr.toLowerCase()];
        if (!tokenInfo) {
            console.error(`couldn't find tokenAddr in orderbook config`);
            return;
        }

        let orders = [];
        let now = DegensUtils.getCurrTime();

        db.prepare('DELETE FROM LiveOrder WHERE expiry <= ?').run(now);

        for (let event of Object.values(dc.getEvents())) {
            if (now - config.orderRefreshTimeSeconds < (lastEventUpdate[event.eventId] || 0)) continue;
            lastEventUpdate[event.eventId] = now;

            if (event.status) continue; // game is probably live

            let kickoff = parseInt(event.event.kickoff);
            if (now > kickoff - config.orderExpiryTimeSeconds) continue; // game will start soon
            let expiry = Math.min(now + config.orderExpiryTimeSeconds, kickoff);

            let marketLookup = DegensUtils.constructMarketMap(event.markets);
            let marketPrices = computeMyPrices(event, marketLookup, tokenInfo.sym) || {};

            let addOrders = (marketId) => {
                let price = marketPrices[marketId];

                if (price.buyPrice === undefined || price.sellPrice === undefined) return; // doesn't return extreme prices

                orders.push(constructOrder(marketId, 0, price.sellAmount, price.sellPrice, expiry));
                orders.push(constructOrder(marketId, 1, price.buyAmount, price.buyPrice, expiry));
            };

            for (let marketType of Object.keys(marketLookup)) {
                let marketIds = marketLookup[marketType];
                if (typeof(marketIds) === 'object') marketIds = Object.values(marketIds);
                else marketIds = [marketIds];

                marketIds = marketIds.filter(id => marketPrices[id] && marketPrices[id].prob);
                marketIds.sort((a,b) => Math.sign(Math.abs(0.5 - marketPrices[a].prob) - Math.abs(0.5 - marketPrices[b].prob)));

                if (config.marketTypeLimits[marketType] !== undefined) {
                    marketIds = marketIds.slice(0, config.marketTypeLimits[marketType]);
                }

                for (let marketId of marketIds) addOrders(marketId);
            }
        }

        orders = orders.filter(o => !!o); // constructOrder can return undefined
        if (orders.length > 0) console.log(`UPDATING ${orders.length} ORDERS`);

        sendOrders(orders);
    });
}


function genericCompare(val, test) {
    if (typeof(test) === 'string') return val === test;
    else if (typeof(test) === 'function') return test(val);
    else throw(`unknown type of test in genericCompare: ${typeof(test)}`);
}

function strategyFilter(strat, event, marketType) {
    if (strat.sport && !genericCompare(event.event.sport, strat.sport)) return false;
    if (strat.league && !genericCompare(event.event.league, strat.league)) return false;
    if (strat.marketType && !genericCompare(marketType, strat.marketType)) return false;

    return true;
}


function unpackAndSortOrders(orders) {
    let asks = [];
    let bids = [];

    for (let order of Object.values(orders)) {
        (order.dir === 1 ? asks : bids).push(order);
    }

    asks.sort((a, b) => Math.sign(a.price - b.price));
    bids.sort((a, b) => Math.sign(b.price - a.price));

    return { asks, bids, };
}


function computeMyPrices(event, marketLookup, tokenSym) {
    let prices = rc.getEvent(event.eventId);
    if (!prices) return undefined;

    let currPositions;
    if (dc.data.positions[myAddress].events[event.eventId]) currPositions = dc.data.positions[myAddress].events[event.eventId].matches;

    let output = {};

    if (marketLookup['1x2_1'] && marketLookup['1x2_x'] && marketLookup['1x2_2']) {
        for (let strat of config.strategies) {
            if (!strategyFilter(strat, event, '1x2')) continue;

            let providerPrices = prices[strat.oddsSource] || {};
            let priceSet = [ providerPrices[marketLookup['1x2_1']], providerPrices[marketLookup['1x2_x']], providerPrices[marketLookup['1x2_2']] ].filter(p => !!p);
            if (priceSet.length !== 3) continue;

            let results = analyzePriceSet(priceSet);
            if (!results) continue;

            results.forEach(r => {
                r.strat = strat;
            });

            output[marketLookup['1x2_1']] = results[0];
            output[marketLookup['1x2_x']] = results[1];
            output[marketLookup['1x2_2']] = results[2];

            break;
        }
    }

    for (let marketId of Object.keys(event.markets)) {
        let marketType = event.markets[marketId].info.type;
        if (marketType.startsWith('1x2_')) continue;

        for (let strat of config.strategies) {
            if (!strategyFilter(strat, event, marketType)) continue;

            let providerPrices = (prices[strat.oddsSource] || {})[marketId];
            if (!providerPrices) continue;

            let result = analyzePriceSingle(providerPrices);
            if (!result) continue;

            result.strat = strat;

            output[marketId] = result;

            break;
        }
    }



    // Scale markups to get rid of longshot bias
    /*
    for (let marketId of Object.keys(output)) {
        let p = output[marketId];

        if (!p.prob || !p.markup) continue;

        p.markup *= p.strat.markup;
        p.markup = Math.max(p.markup, p.strat.minMarkup || 1);

        let x = Math.abs(p.prob - 0.5);
        let scale = -0.01/(x-.4) - .047;
        p.markup *= 1 + Math.max(0, scale);
    }
    */



    // Compute prices given the probs, markups, and current positions

    for (let marketId of Object.keys(output)) {
        let p = output[marketId];

        let strat = {
            minMarkup: 1.01,
            markupMult: 1,
            ...config.defaultStrategy,
            ...p.strat,
        };

        let baseAmount = strat.baseAmount;

        let buyAmount = baseAmount;
        let sellAmount = baseAmount;
        let buyMarkup = p.markup;
        let sellMarkup = p.markup;

        buyMarkup *= strat.markupMult;
        sellMarkup *= strat.markupMult;

        buyMarkup = Math.max(buyMarkup, strat.minMarkup);
        sellMarkup = Math.max(sellMarkup, strat.minMarkup);

        let position = currPositions && currPositions[marketId] && currPositions[marketId].tokens[tokenSym];

        if (position) {
            let myPos = ethers.utils.bigNumberify(position.pos);
            let atRisk = myPos.abs().mul(myPos.gt(0) ? position.avgPrice : DegensUtils.MAX_PRICE - position.avgPrice).div(DegensUtils.MAX_PRICE);
            atRisk = parseFloat(ethers.utils.formatEther(atRisk));
            let currPriceBand = positionToPriceBand(baseAmount, atRisk, 0.6);

            if (myPos.gt(0)) {
                buyAmount = (2 * baseAmount) - priceBandToAmount(baseAmount, currPriceBand) - atRisk;
                if (buyAmount < 0.1) buyAmount = 0;
                buyMarkup = scaleMarkup(p.markup, (1 + currPriceBand));
                sellMarkup = scaleMarkup(p.markup, 1 / (1 + currPriceBand));
            } else {
                sellAmount = (2 * baseAmount) - priceBandToAmount(baseAmount, currPriceBand) - atRisk;
                if (sellAmount < 0.1) sellAmount = 0;
                sellMarkup = scaleMarkup(p.markup, (1 + currPriceBand));
                buyMarkup = scaleMarkup(p.markup, 1 / (1 + currPriceBand));
            }
        }


        let buyPrice = Math.floor(DegensUtils.MAX_PRICE * (p.prob / buyMarkup));
        let sellPrice = Math.floor(DegensUtils.MAX_PRICE * (1 - ((1 - p.prob) / sellMarkup)));


        if (strat.oddsLimit) {
            let maxPrice = DegensUtils.MAX_PRICE * (1 / strat.oddsLimit);
            let minPrice = DegensUtils.MAX_PRICE - maxPrice;
            if (maxPrice < minPrice) [maxPrice, minPrice] = [minPrice, maxPrice]; // you can write either 1.5 or 3

            if (buyPrice < minPrice || buyPrice > maxPrice) continue;
            if (sellPrice < minPrice || sellPrice > maxPrice) continue;
        }


        let existingOrders = unpackAndSortOrders(event.markets[marketId].orders);

        if (existingOrders.asks.length && existingOrders.bids.length && existingOrders.asks[0].price < existingOrders.bids[0].price) {
            continue; // crossed orderbook. wait it out
        }

        if (existingOrders.asks.length && buyPrice > existingOrders.asks[0].price) {
            let numMyOrders = db.prepare('SELECT COUNT(*) FROM LiveOrder WHERE degensMatchId = ?').pluck().get(marketId);
            if (numMyOrders) continue; // don't risk crossing our own order
            buyPrice = existingOrders.asks[0].price;
        }

        if (existingOrders.bids.length && sellPrice < existingOrders.bids[0].price) {
            let numMyOrders = db.prepare('SELECT COUNT(*) FROM LiveOrder WHERE degensMatchId = ?').pluck().get(marketId);
            if (numMyOrders) continue; // don't risk crossing our own order
            sellPrice = existingOrders.bids[0].price;
        }


        // sanity checks

        if (buyPrice >= sellPrice) {
            console.error(`Buy >= sell price... ${buyPrice} ${sellPrice}`);
            continue;
        }

        if (isNaN(buyPrice) || isNaN(sellPrice)) continue;


        p.buyPrice = buyPrice;
        p.sellPrice = sellPrice;
        p.buyAmount = buyAmount;
        p.sellAmount = sellAmount;
    }

    return output;
}


function constructOrder(marketId, direction, amount, price, expiry) {
    let now = DegensUtils.getCurrTime();

    if (amount < 0.1) return undefined;
    amount = ethers.utils.parseEther("" + amount);

    let orderGroup;


    let existingOrders = db.prepare('SELECT * FROM LiveOrder WHERE degensMatchId = ? AND direction = ?').all(marketId, direction);

    let existingOrder;
    if (existingOrders.length > 1) return undefined;
    else if (existingOrders.length === 1) existingOrder = existingOrders[0];


    if (existingOrder) {
        if (price === existingOrder.price && now - existingOrder.timestamp < (pollIntervalSeconds*2)) return undefined; // don't refresh orders too often

        let existingOrderAmount = ethers.utils.bigNumberify(existingOrder.amount);
        let amountRemaining = existingOrderAmount.sub(dc.data.orderFills[myAddress].recs[existingOrder.fillHash] || 0);

        if (amountRemaining.sub(amount).abs().gt(ethers.utils.parseEther('0.1'))) {
            return undefined; // wait for order with different amount to expire
        }

        orderGroup = existingOrder.orderGroup;
        amount = existingOrderAmount;
    } else {
        orderGroup = ethers.utils.hexlify(ethers.utils.randomBytes(12))
    }


    let o = new DegensContractLib.Order({
        maker: myAddress,
        taker: 0,
        token: config.tokenAddr,
        matchId: marketId,
        amount: amount,
        price: price,
        direction: direction,
        expiry: expiry,
        timestamp: now,
        orderGroup: orderGroup,
    });


    if (existingOrder) {
        if (o.fillHash !== existingOrder.fillHash) {
            console.log('fillHash mismatch on existing order'); // maybe we changed maker or token in config?
            return undefined;
        }

        db.prepare('UPDATE LiveOrder SET price = ?, timestamp = ?, expiry = ? WHERE orderId = ?')
          .run(price, now, expiry, existingOrder.orderId);
    } else {
        db.prepare(`INSERT INTO LiveOrder (degensMatchId, direction, price, timestamp, expiry, maker, token, amount, orderGroup, fillHash)
                    VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .run(marketId, direction, price, now, expiry, myAddress, config.tokenAddr, amount.toString(), orderGroup, o.fillHash);
    }


    let sig = o.signWithPrivateKey(config.privateKey, config.contractAddr, config.chainId);
    return o.asTransportPacked(sig);
}



function sendOrders(orders) {
    if (orders.length === 0) return;

    orders = orders.map(o => { return { order: o, }; });

    dc.oc.send("put", orders, (err, r) => {
        if (err) console.log(`ERROR SENDING ${orders.length} ORDERS: ${err}`);
    });
}




/// pricing utils

function scaleMarkup(markup, scale) {
    return ((markup - 1) * scale) + 1;
}



function analyzePriceSet(prices) {
    prices = prices.map(p => {
        if (!p.longOdds) return p;
        return { ...p, probability: (1 / p.longOdds), };
    });

    let probSum = prices.map(p => p.probability).reduce((a,b) => a + b);
    if (probSum < 1) {
        console.log(`Total probs < 1: ${probSum}`);
        return undefined;
    }

    let output = prices.map(p => {
        return {
            prob: p.probability / probSum,
            markup: probSum,
        };
    });

    return output;
}


function analyzePriceSingle(p) {
    if (!p.longOdds || !p.shortOdds) return undefined;

    let longProb = 1 / parseFloat(p.longOdds);
    let shortProb = 1 - (1 / parseFloat(p.shortOdds));

    if (isNaN(longProb) || isNaN(shortProb)) {
        console.log("Error parsing price:", p);
        return undefined;
    }

    if (longProb <= shortProb) {
        console.log("Prices reversed?", p);
        return undefined;
    }

    let geometricAvgProb = Math.sqrt(longProb * shortProb);

    let output = {
        prob: geometricAvgProb,
        markup: geometricAvgProb / shortProb,
    };

    return output;
}





function priceBandToAmount(baseAmount, band) {
    return 2**-band * baseAmount;
}

// P = 2 * baseAmount - 2**-band * baseAmount
// 2 * baseAmount - P = 2**-band * baseAmount
// (2 * baseAmount - P) / baseAmount = 2**-band
// -log2((2 * baseAmount - P) / baseAmount) = band

function positionToPriceBand(baseAmount, position, threshold) {
    threshold = 1 + (1 - threshold);
    let band = -Math.log2((2 * baseAmount - position) / (baseAmount * threshold)) + 1;
    return Math.floor(band);
}
