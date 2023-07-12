import { isValidVideoBid, registerVastTrackers, insertVastTrackers, getVastTrackers } from 'src/video.js';
import {hook} from '../../src/hook.js';
import {stubAuctionIndex} from '../helpers/indexStub.js';
import { MODULE_TYPE_ANALYTICS } from 'src/activities/modules.js';

describe('video.js', function () {
  before(() => {
    hook.ready();
  });

  it('validates valid instream bids', function () {
    const bid = {
      adId: '456xyz',
      vastUrl: 'http://www.example.com/vastUrl',
      transactionId: 'au'
    };
    const adUnits = [{
      transactionId: 'au',
      mediaTypes: {
        video: {context: 'instream'}
      }
    }];
    const valid = isValidVideoBid(bid, {index: stubAuctionIndex({adUnits})});
    expect(valid).to.equal(true);
  });

  it('catches invalid instream bids', function () {
    const bid = {
      transactionId: 'au'
    };
    const adUnits = [{
      transactionId: 'au',
      mediaTypes: {
        video: {context: 'instream'}
      }
    }];
    const valid = isValidVideoBid(bid, {index: stubAuctionIndex({adUnits})});
    expect(valid).to.equal(false);
  });

  it('catches invalid bids when prebid-cache is disabled', function () {
    const adUnits = [{
      transactionId: 'au',
      bidder: 'vastOnlyVideoBidder',
      mediaTypes: {video: {}},
    }];

    const valid = isValidVideoBid({ transactionId: 'au', vastXml: '<xml>vast</xml>' }, {index: stubAuctionIndex({adUnits})});

    expect(valid).to.equal(false);
  });

  it('validates valid outstream bids', function () {
    const bid = {
      transactionId: 'au',
      renderer: {
        url: 'render.url',
        render: () => true,
      }
    };
    const adUnits = [{
      transactionId: 'au',
      mediaTypes: {
        video: {context: 'outstream'}
      }
    }];
    const valid = isValidVideoBid(bid, {index: stubAuctionIndex({adUnits})});
    expect(valid).to.equal(true);
  });

  it('validates valid outstream bids with a publisher defined renderer', function () {
    const bid = {
      transactionId: 'au',
    };
    const adUnits = [{
      transactionId: 'au',
      mediaTypes: {
        video: {
          context: 'outstream',
        }
      },
      renderer: {
        url: 'render.url',
        render: () => true,
      }
    }];
    const valid = isValidVideoBid(bid, {index: stubAuctionIndex({adUnits})});
    expect(valid).to.equal(true);
  });

  it('catches invalid outstream bids', function () {
    const bid = {
      transactionId: 'au',
    };
    const adUnits = [{
      transactionId: 'au',
      mediaTypes: {
        video: {context: 'outstream'}
      }
    }];
    const valid = isValidVideoBid(bid, {index: stubAuctionIndex({adUnits})});
    expect(valid).to.equal(false);
  });

  it('insert into tracker list', function() {
    registerVastTrackers(MODULE_TYPE_ANALYTICS, 'test', function(bidResponse) {
      return [
        {'event': 'impression', 'url': `https://vasttracking.mydomain.com/vast?cpm=${bidResponse.cpm}`}
      ];
    });
    const trackers = getVastTrackers({'cpm': 1.0});
    expect(trackers).to.be.a('map');
    expect(trackers.get('impression')).to.exists;
    expect(trackers.get('impression').length).to.equal(1);
    expect(trackers.get('impression')[0]).to.equal('https://vasttracking.mydomain.com/vast?cpm=1');
  });

  it('insert trackers in vastXml', function() {
    const trackers = getVastTrackers({'cpm': 1.0});
    let vastXml = '<VAST><Ad><Wrapper></Wrapper></Ad></VAST>';
    vastXml = insertVastTrackers(trackers, vastXml);
    expect(vastXml).to.equal('<VAST><Ad><Wrapper><Impression><![CDATA[https://vasttracking.mydomain.com/vast?cpm=1]]></Impression></Wrapper></Ad></VAST>');
  });
});
