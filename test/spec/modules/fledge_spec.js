import {
  expect
} from 'chai';
import * as fledge from 'modules/fledgeForGpt.js';
import {config} from '../../../src/config.js';
import adapterManager from '../../../src/adapterManager.js';
import * as utils from '../../../src/utils.js';
import {hook} from '../../../src/hook.js';
import 'modules/appnexusBidAdapter.js';
import 'modules/rubiconBidAdapter.js';

const CODE = 'sampleBidder';
const AD_UNIT_CODE = 'mock/placement';

describe('fledgeForGpt module', function() {
  let nextFnSpy;
  fledge.init({enabled: true})

  const bidRequest = {
    adUnitCode: AD_UNIT_CODE,
    bids: [{
      bidId: '1',
      bidder: CODE,
      auctionId: 'first-bid-id',
      adUnitCode: AD_UNIT_CODE,
      transactionId: 'au',
    }]
  };
  const fledgeAuctionConfig = {
    bidId: '1',
  }

  describe('addComponentAuctionHook', function() {
    beforeEach(function() {
      nextFnSpy = sinon.spy();
    });

    it('should call next() when a proper bidrequest and fledgeAuctionConfig are provided', function() {
      fledge.addComponentAuctionHook(nextFnSpy, bidRequest, fledgeAuctionConfig);
      expect(nextFnSpy.called).to.be.true;
    });
  });
});

describe('fledgeEnabled', function () {
  const origRunAdAuction = navigator?.runAdAuction;
  before(function () {
    // navigator.runAdAuction doesn't exist, so we can't stub it normally with
    // sinon.stub(navigator, 'runAdAuction') or something
    navigator.runAdAuction = sinon.stub();
    hook.ready();
  });

  after(function() {
    navigator.runAdAuction = origRunAdAuction;
  })

  afterEach(function () {
    config.resetConfig();
  });

  it('should set fledgeEnabled correctly per bidder', function () {
    config.setConfig({bidderSequence: 'fixed'})
    config.setBidderConfig({
      bidders: ['appnexus'],
      config: {
        fledgeEnabled: true,
      }
    });

    const adUnits = [{
      'code': '/19968336/header-bid-tag1',
      'mediaTypes': {
        'banner': {
          'sizes': [[728, 90]]
        },
      },
      'bids': [
        {
          'bidder': 'appnexus',
        },
        {
          'bidder': 'rubicon',
        },
      ]
    }];

    const bidRequests = adapterManager.makeBidRequests(
      adUnits,
      Date.now(),
      utils.getUniqueIdentifierStr(),
      function callback() {},
      []
    );

    expect(bidRequests[0].bids[0].bidder).equals('appnexus');
    expect(bidRequests[0].fledgeEnabled).to.be.true;

    expect(bidRequests[1].bids[0].bidder).equals('rubicon');
    expect(bidRequests[1].fledgeEnabled).to.be.undefined;
  });
});
