"use strict";


const MAX_PRICE = 1000000000;



function getCurrTime() {
    return Math.floor((new Date()).getTime() / 1000);
}

function getCurrTimeMilliseconds() {
    return (new Date()).getTime();
}




let mutexGates = {};
let mutexGatesPending = {};

async function withMutexGate(gateName, cb, dontScheduleIfRunning) {
    if (mutexGates[gateName]) {
        //console.log(`mutexGate ${gateName} already running...`);
        if (!dontScheduleIfRunning) mutexGatesPending[gateName] = true;
        return;
    }

    mutexGates[gateName] = true;
    mutexGatesPending[gateName] = false;
    //console.log("Locking " + gateName);

    try {
        await cb();
    // FIXME: doesn't print out errors in async functions
    //} catch(e) {
    //    console.error(`!!! ERROR IN ${gateName}: ${e.stack}`);
    } finally {
        mutexGates[gateName] = false;
        //console.log("UNLocking " + gateName);
    };

    if (mutexGatesPending[gateName]) return withMutexGate(gateName, cb);
}



function constructMarketMap(markets) {
    let output = {};

    for (let marketId of Object.keys(markets)) {
        let info = markets[marketId].info;

        if (info.type.startsWith("1x2_") || info.type === 'ml') {
            output[info.type] = marketId;
        } else if (info.type === 'spread') {
            if (!output[info.type]) output[info.type] = {};
            output[info.type][info.spread] = marketId;
        } else if (info.type === 'total') {
            if (!output[info.type]) output[info.type] = {};
            output[info.type][info.total] = marketId;
        } else {
            console.error(`Unrecognized market type: ${info.type}`);
        }
    }

    return output;
}






function invertPointSpread(ps) {
    if (ps[0] === '-') return ps.substr(1);
    else if (ps[0] === '+') return '-' + ps.substr(1);
    else return '-' + ps;
}

function formatPointSpread(ps) {
    if (ps[0] === '-' || ps[0] === '+') return ps;
    return '+' + ps;
}



function renderOdds(price, isLong, oddsType, full) {
  let output;

  let buyRatio = price / (MAX_PRICE - price);
  let sellRatio = 1 / buyRatio;

  let round = (n, decimals) => {
    return n.toFixed(full ? 9 : decimals);
  };

  if (oddsType === 'american') {
    let sign = (isLong && buyRatio >= 1) || (!isLong && sellRatio >= 1) ? '+' : '-';
    output = sign + round(Math.max(buyRatio, sellRatio) * 100, 0);
  } else if (oddsType === 'decimal') {
    output = round(1 + (isLong ? buyRatio : sellRatio), 3);
  } else if (oddsType === 'hk') {
    output = round(isLong ? buyRatio : sellRatio, 3);
  } else if (oddsType === 'probability') {
    output = round((isLong ? MAX_PRICE - price : price) / 10000000, 1);
  } else if (oddsType === 'indo') {
    let sign = (isLong && buyRatio >= 1) || (!isLong && sellRatio >= 1) ? '' : '-';
    output = sign + round(Math.max(buyRatio, sellRatio), 3);
  } else if (oddsType === 'malay') {
    let sign = (isLong && buyRatio > 1) || (!isLong && sellRatio > 1) ? '-' : '';
    output = sign + round(Math.min(buyRatio, sellRatio), 3);
  } else {
    throw("unrecognized oddsType: " + oddsType);
  }

  return output;
}


function parseOdds(odds, oddsType) {
  let output;

  if (typeof(odds) === 'string') odds = odds.trim();

  let num = parseFloat(odds);
  if (isNaN(num) || num === undefined) return undefined;

  // pre-process

  if (oddsType === 'american') {
    if (Math.abs(num) < 100) return undefined;
    num /= 100;
    oddsType = 'indo';
  } else if (oddsType === 'hk') {
    num += 1;
    oddsType = 'decimal';
  } else if (oddsType === 'malay') {
    if (Math.abs(num) >= 1) return undefined;
    if (num < 0) num = 1 / Math.abs(num);
    num += 1;
    oddsType = 'decimal';
  }

  // conversion

  if (oddsType === 'indo') {
    output = 1 / (Math.abs(num) + 1);
    if (num > 0) output = 1 - output;
  } else if (oddsType === 'probability') {
    if (num < 0 || num > 100) return undefined;
    output = 1 - (num / 100);
  } else if (oddsType === 'decimal') {
    if (num <= 1) return undefined;
    output = 1 - (1 / num);
  } else {
    throw("unrecognized oddsType: " + oddsType);
  }

  output = Math.floor(output * MAX_PRICE);
  if (output <= 0 || output >= MAX_PRICE) return undefined;

  return output;
}






module.exports = {
    MAX_PRICE,

    getCurrTime,
    getCurrTimeMilliseconds,
    withMutexGate,

    constructMarketMap,

    renderOdds,
    parseOdds,
    invertPointSpread,
    formatPointSpread,
};
