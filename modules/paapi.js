/**
 * Collect PAAPI component auction configs from bid adapters and make them available through `pbjs.getPAAPIConfig()`
 */
import {config} from '../src/config.js';
import {getHook, module} from '../src/hook.js';
import {deepSetValue, logInfo, logWarn, mergeDeep} from '../src/utils.js';
import {IMP, PBS, registerOrtbProcessor, RESPONSE} from '../src/pbjsORTB.js';
import * as events from '../src/events.js';
import CONSTANTS from '../src/constants.json';
import {currencyCompare} from '../libraries/currencyUtils/currency.js';
import {maximum, minimum} from '../src/utils/reducers.js';
import {auctionManager} from '../src/auctionManager.js';
import {getGlobal} from '../src/prebidGlobal.js';

const MODULE = 'PAAPI';

const submodules = [];
const USED = new WeakSet();

export function registerSubmodule(submod) {
  submodules.push(submod);
  submod.init && submod.init({getPAAPIConfig});
}

module('paapi', registerSubmodule);

function auctionConfigs() {
  const store = new WeakMap();
  return function (auctionId, init = {}) {
    const auction = auctionManager.index.getAuction({auctionId});
    if (auction == null) return;
    if (!store.has(auction)) {
      store.set(auction, init);
    }
    return store.get(auction);
  };
}

const pendingForAuction = auctionConfigs();
const configsForAuction = auctionConfigs();
let latestAuctionForAdUnit = {};
let moduleConfig = {};

['paapi', 'fledgeForGpt'].forEach(ns => {
  config.getConfig(ns, config => {
    init(config[ns], ns);
  });
});

export function reset() {
  submodules.splice(0, submodules.length);
  latestAuctionForAdUnit = {};
}

export function init(cfg, configNamespace) {
  if (configNamespace !== 'paapi') {
    logWarn(`'${configNamespace}' configuration options will be renamed to 'paapi'; consider using setConfig({paapi: [...]}) instead`);
  }
  if (cfg && cfg.enabled === true) {
    moduleConfig = cfg;
    logInfo(`${MODULE} enabled (browser ${isFledgeSupported() ? 'supports' : 'does NOT support'} runAdAuction)`, cfg);
  } else {
    moduleConfig = {};
    logInfo(`${MODULE} disabled`, cfg);
  }
}

getHook('addComponentAuction').before(addComponentAuctionHook);
getHook('makeBidRequests').after(markForFledge);
events.on(CONSTANTS.EVENTS.AUCTION_END, onAuctionEnd);

function getSlotSignals(bidsReceived = [], bidRequests = []) {
  let bidfloor, bidfloorcur;
  if (bidsReceived.length > 0) {
    const bestBid = bidsReceived.reduce(maximum(currencyCompare(bid => [bid.cpm, bid.currency])));
    bidfloor = bestBid.cpm;
    bidfloorcur = bestBid.currency;
  } else {
    const floors = bidRequests.map(bid => typeof bid.getFloor === 'function' && bid.getFloor()).filter(f => f);
    const minFloor = floors.length && floors.reduce(minimum(currencyCompare(floor => [floor.floor, floor.currency])));
    bidfloor = minFloor?.floor;
    bidfloorcur = minFloor?.currency;
  }
  const cfg = {};
  if (bidfloor) {
    deepSetValue(cfg, 'auctionSignals.prebid.bidfloor', bidfloor);
    bidfloorcur && deepSetValue(cfg, 'auctionSignals.prebid.bidfloorcur', bidfloorcur);
  }
  return cfg;
}

function onAuctionEnd({auctionId, bidsReceived, bidderRequests, adUnitCodes}) {
  const allReqs = bidderRequests?.flatMap(br => br.bids);
  const paapiConfigs = {};
  (adUnitCodes || []).forEach(au => {
    paapiConfigs[au] = null;
    !latestAuctionForAdUnit.hasOwnProperty(au) && (latestAuctionForAdUnit[au] = null);
  })
  Object.entries(pendingForAuction(auctionId) || {}).forEach(([adUnitCode, auctionConfigs]) => {
    const forThisAdUnit = (bid) => bid.adUnitCode === adUnitCode;
    const slotSignals = getSlotSignals(bidsReceived?.filter(forThisAdUnit), allReqs?.filter(forThisAdUnit));
    paapiConfigs[adUnitCode] = {
      componentAuctions: auctionConfigs.map(cfg => mergeDeep({}, slotSignals, cfg))
    };
    latestAuctionForAdUnit[adUnitCode] = auctionId;
  });
  configsForAuction(auctionId, paapiConfigs);
  submodules.forEach(submod => submod.onAuctionConfig?.(
    auctionId,
    paapiConfigs,
    (adUnitCode) => paapiConfigs[adUnitCode] != null && USED.add(paapiConfigs[adUnitCode]))
  );
}

function setFPDSignals(auctionConfig, fpd) {
  auctionConfig.auctionSignals = mergeDeep({}, {prebid: fpd}, auctionConfig.auctionSignals);
}

export function addComponentAuctionHook(next, request, paapiConfig) {
  if (getFledgeConfig().enabled) {
    const {adUnitCode, auctionId, ortb2, ortb2Imp} = request;
    const configs = pendingForAuction(auctionId);
    if (configs != null) {
      setFPDSignals(paapiConfig.config, {ortb2, ortb2Imp});
      !configs.hasOwnProperty(adUnitCode) && (configs[adUnitCode] = []);
      configs[adUnitCode].push(paapiConfig.config);
    } else {
      logWarn(MODULE, `Received component auction config for auction that has closed (auction '${auctionId}', adUnit '${adUnitCode}')`, paapiConfig);
    }
  }
  next(request, paapiConfig);
}

/**
 * Get PAAPI auction configuration.
 *
 * @param auctionId? optional auction filter; if omitted, the latest auction for each ad unit is used
 * @param adUnitCode? optional ad unit filter
 * @param includeBlanks if true, include null entries for ad units that match the given filters but do not have any available auction configs.
 * @returns {{}} a map from ad unit code to auction config for the ad unit.
 */
export function getPAAPIConfig({auctionId, adUnitCode} = {}, includeBlanks = false) {
  const output = {};
  const targetedAuctionConfigs = auctionId && configsForAuction(auctionId);
  Object.keys((auctionId != null ? targetedAuctionConfigs : latestAuctionForAdUnit) ?? []).forEach(au => {
    const latestAuctionId = latestAuctionForAdUnit[au];
    const auctionConfigs = targetedAuctionConfigs ?? (latestAuctionId && configsForAuction(latestAuctionId));
    if ((adUnitCode ?? au) === au) {
      let candidate;
      if (targetedAuctionConfigs?.hasOwnProperty(au)) {
        candidate = targetedAuctionConfigs[au];
      } else if (auctionId == null && auctionConfigs?.hasOwnProperty(au)) {
        candidate = auctionConfigs[au];
      }
      if (candidate && !USED.has(candidate)) {
        output[au] = candidate;
        USED.add(candidate);
      } else if (includeBlanks) {
        output[au] = null;
      }
    }
  })
  return output;
}

getGlobal().getPAAPIConfig = (filters) => getPAAPIConfig(filters);

function isFledgeSupported() {
  return 'runAdAuction' in navigator && 'joinAdInterestGroup' in navigator;
}

function getFledgeConfig() {
  const bidder = config.getCurrentBidder();
  const useGlobalConfig = moduleConfig.enabled && (bidder == null || !moduleConfig.bidders?.length || moduleConfig.bidders?.includes(bidder));
  return {
    enabled: config.getConfig('fledgeEnabled') ?? useGlobalConfig,
    ae: config.getConfig('defaultForSlots') ?? (useGlobalConfig ? moduleConfig.defaultForSlots : undefined)
  };
}

export function markForFledge(next, bidderRequests) {
  if (isFledgeSupported()) {
    bidderRequests.forEach((bidderReq) => {
      config.runWithBidder(bidderReq.bidderCode, () => {
        const {enabled, ae} = getFledgeConfig();
        Object.assign(bidderReq, {fledgeEnabled: enabled});
        bidderReq.bids.forEach(bidReq => {
          // https://github.com/InteractiveAdvertisingBureau/openrtb/blob/main/extensions/community_extensions/Protected%20Audience%20Support.md
          const igsAe = bidReq.ortb2Imp?.ext?.igs != null
            ? bidReq.ortb2Imp.ext.igs.ae || 1
            : null
          const extAe = bidReq.ortb2Imp?.ext?.ae;
          if (igsAe !== extAe && igsAe != null && extAe != null) {
            logWarn(`Bid request defines conflicting ortb2Imp.ext.ae and ortb2Imp.ext.igs, using the latter`, bidReq);
          }
          const bidAe = igsAe ?? extAe ?? ae;
          if (bidAe) {
            deepSetValue(bidReq, 'ortb2Imp.ext.ae', bidAe);
            bidReq.ortb2Imp.ext.igs = Object.assign({
              ae: bidAe,
              biddable: 1
            }, bidReq.ortb2Imp.ext.igs)
          }
        });
      });
    });
  }
  next(bidderRequests);
}

export function setImpExtAe(imp, bidRequest, context) {
  if (!context.bidderRequest.fledgeEnabled) {
    delete imp.ext?.ae;
    delete imp.ext?.igs;
  }
}

registerOrtbProcessor({type: IMP, name: 'impExtAe', fn: setImpExtAe});

function paapiResponseParser(configs, response, context) {
  configs.forEach((config) => {
    const impCtx = context.impContext[config.impid];
    if (!impCtx?.imp?.ext?.ae) {
      logWarn('Received PAAPI auction configuration for an impression that was not in the request or did not ask for it', config, impCtx?.imp);
    } else {
      impCtx.paapiConfigs = impCtx.paapiConfigs || [];
      impCtx.paapiConfigs.push(config);
    }
  });
}

export function parseExtIgiIgs(response, ortbResponse, context) {
  paapiResponseParser(
    (ortbResponse.ext?.igi || []).flatMap(igi => {
      return (igi?.igs || []).map(igs => {
        if (igs.impid !== igi.impid && igs.impid != null && igi.impid != null) {
          logWarn('ORTB response ext.igi.igs.impid conflicts with parent\'s impid', igi);
        }
        return {
          config: igs.config,
          impid: igs.impid ?? igi.impid
        }
      })
    }),
    response,
    context
  )
}

// to make it easier to share code between the PBS adapter and adapters whose backend is PBS, break up
// fledge response processing in two steps: first aggregate all the auction configs by their imp...

export function parseExtPrebidFledge(response, ortbResponse, context) {
  paapiResponseParser(
    (ortbResponse.ext?.prebid?.fledge?.auctionconfigs || []),
    response,
    context
  )
}

registerOrtbProcessor({type: RESPONSE, name: 'extPrebidFledge', fn: parseExtPrebidFledge, dialects: [PBS]});
registerOrtbProcessor({type: RESPONSE, name: 'extIgiIgs', fn: parseExtIgiIgs});

// ...then, make them available in the adapter's response. This is the client side version, for which the
// interpretResponse api is {fledgeAuctionConfigs: [{bidId, config}]}

export function setResponsePaapiConfigs(response, ortbResponse, context) {
  const configs = Object.values(context.impContext)
    .flatMap((impCtx) => (impCtx.paapiConfigs || []).map(cfg => ({
      bidId: impCtx.bidRequest.bidId,
      config: cfg.config
    })));
  if (configs.length > 0) {
    response.fledgeAuctionConfigs = configs;
  }
}

registerOrtbProcessor({
  type: RESPONSE,
  name: 'fledgeAuctionConfigs',
  priority: -1,
  fn: setResponsePaapiConfigs,
});
