import {detectReferer, ensureProtocol} from 'src/refererDetection.js';
import {config} from 'src/config.js';
import {expect} from 'chai';

/**
 * Build a walkable linked list of window-like objects for testing.
 *
 * @param {Array} urls Array of URL strings starting from the top window.
 * @param {string} [topReferrer]
 * @param {string} [canonicalUrl]
 * @param {boolean} [ancestorOrigins]
 * @returns {Object}
 */
function buildWindowTree(urls, topReferrer = null, canonicalUrl = null, ancestorOrigins = false) {
  /**
   * Find the origin from a given fully-qualified URL.
   *
   * @param {string} url The fully qualified URL
   * @returns {string|null}
   */
  function getOrigin(url) {
    const originRegex = new RegExp('^(https?://[^/]+/?)');

    const result = originRegex.exec(url);

    if (result && result[0]) {
      return result[0];
    }

    return null;
  }

  const inaccessibles = [];

  let previousWindow, topWindow;
  const topOrigin = getOrigin(urls[0]);

  const windowList = urls.map((url, index) => {
    const thisOrigin = getOrigin(url),
      sameOriginAsPrevious = index === 0 ? true : (getOrigin(urls[index - 1]) === thisOrigin),
      sameOriginAsTop = thisOrigin === topOrigin;

    const win = {
      location: {
        href: url,
      },
      document: {
        referrer: index === 0 ? topReferrer : urls[index - 1]
      }
    };

    if (topWindow == null) {
      topWindow = win;
      win.document.querySelector = function (selector) {
        if (selector === 'link[rel=\'canonical\']') {
          return {
            href: canonicalUrl
          };
        }
        return null;
      };
    }

    if (sameOriginAsPrevious) {
      win.parent = previousWindow;
    } else {
      win.parent = inaccessibles[inaccessibles.length - 1];
    }
    if (ancestorOrigins) {
      win.location.ancestorOrigins = urls.slice(0, index).reverse().map(getOrigin);
    }
    win.top = sameOriginAsTop ? topWindow : inaccessibles[0];

    const inWin = {parent: inaccessibles[inaccessibles.length - 1], top: inaccessibles[0]};
    if (index === 0) {
      inWin.top = inWin;
    }
    ['document', 'location'].forEach((prop) => {
      Object.defineProperty(inWin, prop, {
        get: function () {
          throw new Error('cross-origin access');
        }
      });
    });
    inaccessibles.push(inWin);
    previousWindow = win;

    return win;
  });

  return windowList[windowList.length - 1];
}

describe('Referer detection', () => {
  describe('Non cross-origin scenarios', () => {
    describe('No iframes', () => {
      afterEach(function () {
        config.resetConfig();
      });

      it('Should return the current window location and no canonical URL', () => {
        const testWindow = buildWindowTree(['https://example.com/some/page'], 'https://othersite.com/'),
          result = detectReferer(testWindow)();

        expect(result).to.deep.equal({
          location: 'https://example.com/some/page',
          reachedTop: true,
          isAmp: false,
          numIframes: 0,
          stack: ['https://example.com/some/page'],
          canonicalUrl: null,
          page: 'https://example.com/some/page',
          ref: 'https://othersite.com/',
        });
      });

      it('Should return the current window location and a canonical URL', () => {
        const testWindow = buildWindowTree(['https://example.com/some/page'], 'https://othersite.com/', 'https://example.com/canonical/page'),
          result = detectReferer(testWindow)();

        expect(result).to.deep.equal({
          location: 'https://example.com/some/page',
          reachedTop: true,
          isAmp: false,
          numIframes: 0,
          stack: ['https://example.com/some/page'],
          canonicalUrl: 'https://example.com/canonical/page',
          page: 'https://example.com/canonical/page',
          ref: 'https://othersite.com/',
        });
      });
    });

    describe('Friendly iframes', () => {
      it('Should return the top window location and no canonical URL', () => {
        const testWindow = buildWindowTree(['https://example.com/some/page', 'https://example.com/other/page', 'https://example.com/third/page'], 'https://othersite.com/'),
          result = detectReferer(testWindow)();

        expect(result).to.deep.equal({
          location: 'https://example.com/some/page',
          reachedTop: true,
          isAmp: false,
          numIframes: 2,
          stack: [
            'https://example.com/some/page',
            'https://example.com/other/page',
            'https://example.com/third/page'
          ],
          canonicalUrl: null,
          page: 'https://example.com/some/page',
          ref: 'https://othersite.com/'
        });
      });

      it('Should return the top window location and a canonical URL', () => {
        const testWindow = buildWindowTree(['https://example.com/some/page', 'https://example.com/other/page', 'https://example.com/third/page'], 'https://othersite.com/', 'https://example.com/canonical/page'),
          result = detectReferer(testWindow)();

        expect(result).to.deep.equal({
          location: 'https://example.com/some/page',
          reachedTop: true,
          isAmp: false,
          numIframes: 2,
          stack: [
            'https://example.com/some/page',
            'https://example.com/other/page',
            'https://example.com/third/page'
          ],
          canonicalUrl: 'https://example.com/canonical/page',
          page: 'https://example.com/canonical/page',
          ref: 'https://othersite.com/'
        });
      });

      it('Should override canonical URL (and page) with config pageUrl', () => {
        config.setConfig({'pageUrl': 'https://testUrl.com'});

        const testWindow = buildWindowTree(['https://example.com/some/page', 'https://example.com/other/page', 'https://example.com/third/page'], 'https://othersite.com/', 'https://example.com/canonical/page'),
          result = detectReferer(testWindow)();

        expect(result).to.deep.equal({
          location: 'https://example.com/some/page',
          reachedTop: true,
          isAmp: false,
          numIframes: 2,
          stack: [
            'https://example.com/some/page',
            'https://example.com/other/page',
            'https://example.com/third/page'
          ],
          canonicalUrl: 'https://testUrl.com',
          page: 'https://testUrl.com',
          ref: 'https://othersite.com/',
        });
      });
    });
  });

  describe('Cross-origin scenarios', () => {
    it('Should return the top URL and no canonical URL with one cross-origin iframe', () => {
      const testWindow = buildWindowTree(['https://example.com/some/page', 'https://safe.frame/ad'], 'https://othersite.com/', 'https://canonical.example.com/'),
        result = detectReferer(testWindow)();

      expect(result).to.deep.equal({
        location: 'https://example.com/some/page',
        reachedTop: true,
        isAmp: false,
        numIframes: 1,
        stack: [
          'https://example.com/some/page',
          'https://safe.frame/ad'
        ],
        canonicalUrl: null,
        page: 'https://example.com/some/page',
        ref: null,
      });
    });

    it('Should return the top URL and no canonical URL with one cross-origin iframe and one friendly iframe', () => {
      const testWindow = buildWindowTree(['https://example.com/some/page', 'https://safe.frame/ad', 'https://safe.frame/ad'], 'https://othersite.com/', 'https://canonical.example.com/'),
        result = detectReferer(testWindow)();

      expect(result).to.deep.equal({
        location: 'https://example.com/some/page',
        reachedTop: true,
        isAmp: false,
        numIframes: 2,
        stack: [
          'https://example.com/some/page',
          'https://safe.frame/ad',
          'https://safe.frame/ad'
        ],
        canonicalUrl: null,
        page: 'https://example.com/some/page',
        ref: null,
      });
    });

    it('Should return the second iframe location with three cross-origin windows and no ancessorOrigins', () => {
      const testWindow = buildWindowTree(['https://example.com/some/page', 'https://safe.frame/ad', 'https://otherfr.ame/ad'], 'https://othersite.com/', 'https://canonical.example.com/'),
        result = detectReferer(testWindow)();

      expect(result).to.deep.equal({
        location: 'https://safe.frame/ad',
        reachedTop: false,
        isAmp: false,
        numIframes: 2,
        stack: [
          null,
          'https://safe.frame/ad',
          'https://otherfr.ame/ad'
        ],
        canonicalUrl: null,
        page: 'https://safe.frame/ad',
        ref: null
      });
    });

    it('Should return the top window origin with three cross-origin windows with ancestorOrigins', () => {
      const testWindow = buildWindowTree(['https://example.com/some/page', 'https://safe.frame/ad', 'https://otherfr.ame/ad'], 'https://othersite.com/', 'https://canonical.example.com/', true),
        result = detectReferer(testWindow)();

      expect(result).to.deep.equal({
        location: 'https://example.com/',
        reachedTop: false,
        isAmp: false,
        numIframes: 2,
        stack: [
          'https://example.com/',
          'https://safe.frame/ad',
          'https://otherfr.ame/ad'
        ],
        canonicalUrl: null,
        page: 'https://example.com/',
        ref: null,
      });
    });
  });

  describe('Cross-origin AMP page scenarios', () => {
    it('Should return the AMP page source and canonical URLs in an amp-ad iframe for a non-cached AMP page', () => {
      const testWindow = buildWindowTree(['https://example.com/some/page/amp/', 'https://ad-iframe.ampproject.org/ad']);

      testWindow.context = {
        sourceUrl: 'https://example.com/some/page/amp/',
        canonicalUrl: 'https://example.com/some/page/'
      };

      const result = detectReferer(testWindow)();

      expect(result).to.deep.equal({
        location: 'https://example.com/some/page/amp/',
        reachedTop: true,
        isAmp: true,
        numIframes: 1,
        stack: [
          'https://example.com/some/page/amp/',
          'https://ad-iframe.ampproject.org/ad'
        ],
        canonicalUrl: 'https://example.com/some/page/',
        page: 'https://example.com/some/page/',
        ref: null
      });
    });

    it('Should return the AMP page source and canonical URLs in an amp-ad iframe for a cached AMP page on top', () => {
      const testWindow = buildWindowTree(['https://example-com.amp-cache.example.com/some/page/amp/', 'https://ad-iframe.ampproject.org/ad']);

      testWindow.context = {
        sourceUrl: 'https://example.com/some/page/amp/',
        canonicalUrl: 'https://example.com/some/page/'
      };

      const result = detectReferer(testWindow)();

      expect(result).to.deep.equal({
        location: 'https://example.com/some/page/amp/',
        reachedTop: true,
        isAmp: true,
        numIframes: 1,
        stack: [
          'https://example.com/some/page/amp/',
          'https://ad-iframe.ampproject.org/ad'
        ],
        canonicalUrl: 'https://example.com/some/page/',
        page: 'https://example.com/some/page/',
        ref: null,
      });
    });

    describe('Cached AMP page in iframed search result', () => {
      it('Should return the AMP source and canonical URLs but with a null top-level stack location Without ancesorOrigins', () => {
        const testWindow = buildWindowTree(['https://google.com/amp/example-com/some/page/amp/', 'https://example-com.amp-cache.example.com/some/page/amp/', 'https://ad-iframe.ampproject.org/ad']);

        testWindow.context = {
          sourceUrl: 'https://example.com/some/page/amp/',
          canonicalUrl: 'https://example.com/some/page/'
        };

        const result = detectReferer(testWindow)();

        expect(result).to.deep.equal({
          location: 'https://example.com/some/page/amp/',
          reachedTop: false,
          isAmp: true,
          numIframes: 2,
          stack: [
            null,
            'https://example.com/some/page/amp/',
            'https://ad-iframe.ampproject.org/ad'
          ],
          canonicalUrl: 'https://example.com/some/page/',
          page: 'https://example.com/some/page/',
          ref: null,
        });
      });

      it('Should return the AMP source and canonical URLs and include the top window origin in the stack with ancesorOrigins', () => {
        const testWindow = buildWindowTree(['https://google.com/amp/example-com/some/page/amp/', 'https://example-com.amp-cache.example.com/some/page/amp/', 'https://ad-iframe.ampproject.org/ad'], null, null, true);

        testWindow.context = {
          sourceUrl: 'https://example.com/some/page/amp/',
          canonicalUrl: 'https://example.com/some/page/'
        };

        const result = detectReferer(testWindow)();

        expect(result).to.deep.equal({
          location: 'https://example.com/some/page/amp/',
          reachedTop: false,
          isAmp: true,
          numIframes: 2,
          stack: [
            'https://google.com/',
            'https://example.com/some/page/amp/',
            'https://ad-iframe.ampproject.org/ad'
          ],
          canonicalUrl: 'https://example.com/some/page/',
          page: 'https://example.com/some/page/',
          ref: null,
        });
      });

      it('Should return the AMP source and canonical URLs and include the top window origin in the stack with ancesorOrigins and a friendly iframe under the amp-ad iframe', () => {
        const testWindow = buildWindowTree(['https://google.com/amp/example-com/some/page/amp/', 'https://example-com.amp-cache.example.com/some/page/amp/', 'https://ad-iframe.ampproject.org/ad', 'https://ad-iframe.ampproject.org/ad'], null, null, true);

        testWindow.parent.context = {
          sourceUrl: 'https://example.com/some/page/amp/',
          canonicalUrl: 'https://example.com/some/page/'
        };

        const result = detectReferer(testWindow)();

        expect(result).to.deep.equal({
          location: 'https://example.com/some/page/amp/',
          reachedTop: false,
          isAmp: true,
          numIframes: 3,
          stack: [
            'https://google.com/',
            'https://example.com/some/page/amp/',
            'https://ad-iframe.ampproject.org/ad',
            'https://ad-iframe.ampproject.org/ad'
          ],
          canonicalUrl: 'https://example.com/some/page/',
          page: 'https://example.com/some/page/',
          ref: null
        });
      });
    });
  });
});

describe('ensureProtocol', () => {
  ['', null, undefined].forEach((val) => {
    it(`should return unchanged invalid input: ${val}`, () => {
      expect(ensureProtocol(val)).to.eql(val);
    });
  });

  ['http:', 'https:'].forEach((protocol) => {
    Object.entries({
      'window.top.location.protocol': {
        top: {
          location: {
            protocol
          }
        },
        location: {
          protocol: 'unused'
        }
      },
      'window.location.protocol': (() => {
        const w = {
          top: {},
          location: {
            protocol
          }
        };
        Object.defineProperty(w.top, 'location', {
          get: function () {
            throw new Error('cross-origin');
          }
        });
        return w;
      })(),
    }).forEach(([t, win]) => {
      describe(`when ${t} declares ${protocol}`, () => {
        Object.entries({
          'declared': {
            url: 'proto://example.com/page',
            expect: 'proto://example.com/page'
          },
          'relative': {
            url: '//example.com/page',
            expect: `${protocol}//example.com/page`
          },
          'missing': {
            url: 'example.com/page',
            expect: `${protocol}//example.com/page`
          }
        }).forEach(([t, {url, expect: expected}]) => {
          it(`should handle URLs with ${t} protocols`, () => {
            expect(ensureProtocol(url, win)).to.equal(expected);
          });
        });
      });
    });
  })
  });
