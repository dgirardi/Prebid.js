import {deepAccess, deepSetValue, isArray, isNumber, isStr, logInfo, parseSizesInput} from '../src/utils.js';
import {registerBidder} from '../src/adapters/bidderFactory.js';
import {BANNER, VIDEO} from '../src/mediaTypes.js';
import {config} from '../src/config.js';
import {getBidFloor} from '../libraries/adkernelUtils/adkernelUtils.js'

const DEFAULT_ADKERNEL_DSP_DOMAIN = 'tag.adkernel.com';
const DEFAULT_MIMES = ['video/mp4', 'video/webm', 'application/x-shockwave-flash', 'application/javascript'];
const DEFAULT_PROTOCOLS = [2, 3, 5, 6];
const DEFAULT_APIS = [1, 2];
const GVLID = 14;

function isRtbDebugEnabled(refInfo) {
  return refInfo.topmostLocation?.indexOf('adk_debug=true') !== -1;
}

function buildImp(bidRequest) {
  const imp = {
    id: bidRequest.bidId,
    tagid: bidRequest.adUnitCode
  };
  let mediaType;
  const bannerReq = deepAccess(bidRequest, `mediaTypes.banner`);
  const videoReq = deepAccess(bidRequest, `mediaTypes.video`);
  if (bannerReq) {
    const sizes = canonicalizeSizesArray(bannerReq.sizes);
    imp.banner = {
      format: parseSizesInput(sizes)
    };
    mediaType = BANNER;
  } else if (videoReq) {
    const size = canonicalizeSizesArray(videoReq.playerSize)[0];
    imp.video = {
      w: size[0],
      h: size[1],
      mimes: videoReq.mimes || DEFAULT_MIMES,
      protocols: videoReq.protocols || DEFAULT_PROTOCOLS,
      api: videoReq.api || DEFAULT_APIS
    };
    mediaType = VIDEO;
  }
  const bidFloor = getBidFloor(bidRequest, mediaType, '*');
  if (bidFloor) {
    imp.bidfloor = bidFloor;
  }
  return imp;
}

/**
 * Convert input array of sizes to canonical form Array[Array[Number]]
 * @param sizes
 * @return Array[Array[Number]]
 */
function canonicalizeSizesArray(sizes) {
  if (sizes.length === 2 && !isArray(sizes[0])) {
    return [sizes];
  }
  return sizes;
}

function buildRequestParams(tags, bidderRequest) {
  const {gdprConsent, uspConsent, refererInfo, ortb2} = bidderRequest;
  const req = {
    id: bidderRequest.bidderRequestId,
    // TODO: root-level `tid` is not ORTB; is this intentional?
    tid: ortb2?.source?.tid,
    site: buildSite(refererInfo),
    imp: tags
  };
  if (gdprConsent) {
    if (gdprConsent.gdprApplies !== undefined) {
      deepSetValue(req, 'user.gdpr', ~~gdprConsent.gdprApplies);
    }
    if (gdprConsent.consentString !== undefined) {
      deepSetValue(req, 'user.consent', gdprConsent.consentString);
    }
  }
  if (uspConsent) {
    deepSetValue(req, 'user.us_privacy', uspConsent);
  }
  if (config.getConfig('coppa')) {
    deepSetValue(req, 'user.coppa', 1);
  }
  return req;
}

function buildSite(refInfo) {
  const result = {
    page: refInfo.page,
    secure: ~~(refInfo.page && refInfo.page.startsWith('https')),
    ref: refInfo.ref
  }
  const keywords = document.getElementsByTagName('meta')['keywords'];
  if (keywords && keywords.content) {
    result.keywords = keywords.content;
  }
  return result;
}

function buildBid(tag) {
  const bid = {
    requestId: tag.impid,
    cpm: tag.bid,
    creativeId: tag.crid,
    currency: 'USD',
    ttl: 720,
    netRevenue: true
  };
  if (tag.w) {
    bid.width = tag.w;
  }
  if (tag.h) {
    bid.height = tag.h;
  }
  if (tag.tag) {
    bid.ad = tag.tag;
    bid.mediaType = BANNER;
  } else if (tag.vast_url) {
    bid.vastUrl = tag.vast_url;
    bid.mediaType = VIDEO;
  }
  fillBidMeta(bid, tag);
  return bid;
}

function fillBidMeta(bid, tag) {
  if (isStr(tag.agencyName)) {
    deepSetValue(bid, 'meta.agencyName', tag.agencyName);
  }
  if (isNumber(tag.advertiserId)) {
    deepSetValue(bid, 'meta.advertiserId', tag.advertiserId);
  }
  if (isStr(tag.advertiserName)) {
    deepSetValue(bid, 'meta.advertiserName', tag.advertiserName);
  }
  if (isArray(tag.advertiserDomains)) {
    deepSetValue(bid, 'meta.advertiserDomains', tag.advertiserDomains);
  }
  if (isStr(tag.primaryCatId)) {
    deepSetValue(bid, 'meta.primaryCatId', tag.primaryCatId);
  }
  if (isArray(tag.secondaryCatIds)) {
    deepSetValue(bid, 'meta.secondaryCatIds', tag.secondaryCatIds);
  }
}

export const spec = {
  code: 'adkernelAdn',
  gvlid: GVLID,
  supportedMediaTypes: [BANNER, VIDEO],
  aliases: ['engagesimply', 'adpluto_dsp'],

  isBidRequestValid: function(bidRequest) {
    return 'params' in bidRequest &&
      (typeof bidRequest.params.host === 'undefined' || typeof bidRequest.params.host === 'string') &&
      typeof bidRequest.params.pubId === 'number' &&
      'mediaTypes' in bidRequest &&
      ('banner' in bidRequest.mediaTypes || 'video' in bidRequest.mediaTypes);
  },

  buildRequests: function(bidRequests, bidderRequest) {
    const dispatch = bidRequests.map(buildImp)
      .reduce((acc, curr, index) => {
        const bidRequest = bidRequests[index];
        const pubId = bidRequest.params.pubId;
        const host = bidRequest.params.host || DEFAULT_ADKERNEL_DSP_DOMAIN;
        acc[host] = acc[host] || {};
        acc[host][pubId] = acc[host][pubId] || [];
        acc[host][pubId].push(curr);
        return acc;
      }, {});

    const requests = [];
    Object.keys(dispatch).forEach(host => {
      Object.keys(dispatch[host]).forEach(pubId => {
        const request = buildRequestParams(dispatch[host][pubId], bidderRequest);
        requests.push({
          method: 'POST',
          url: `https://${host}/tag?account=${pubId}&pb=1${isRtbDebugEnabled(bidderRequest.refererInfo) ? '&debug=1' : ''}`,
          data: JSON.stringify(request)
        })
      });
    });
    return requests;
  },

  interpretResponse: function(serverResponse) {
    const response = serverResponse.body;
    if (!response.tags) {
      return [];
    }
    if (response.debug) {
      logInfo(`ADKERNEL DEBUG:\n${response.debug}`);
    }
    return response.tags.map(buildBid);
  },

  getUserSyncs: function(syncOptions, serverResponses) {
    if (!serverResponses || serverResponses.length === 0) {
      return [];
    }
    if (syncOptions.iframeEnabled) {
      return buildSyncs(serverResponses, 'syncpages', 'iframe');
    } else if (syncOptions.pixelEnabled) {
      return buildSyncs(serverResponses, 'syncpixels', 'image');
    } else {
      return [];
    }
  }
};

function buildSyncs(serverResponses, propName, type) {
  return serverResponses.filter(rps => rps.body && rps.body[propName])
    .map(rsp => rsp.body[propName])
    .reduce((a, b) => a.concat(b), [])
    .map(syncUrl => ({type: type, url: syncUrl}));
}

registerBidder(spec);
