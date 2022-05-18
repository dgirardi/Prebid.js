/**
 * The referer detection module attempts to gather referer information from the current page that prebid.js resides in.
 * The information that it tries to collect includes:
 * The detected top url in the nav bar,
 * Whether it was able to reach the top most window (if for example it was embedded in several iframes),
 * The number of iframes it was embedded in if applicable (by default max ten iframes),
 * A list of the domains of each embedded window if applicable.
 * Canonical URL which refers to an HTML link element, with the attribute of rel="canonical", found in the <head> element of your webpage
 */

import { config } from './config.js';
import {logWarn} from './utils.js';

/**
 * Prepend a URL with the page's protocol (http/https), if necessary.
 */
export function ensureProtocol(url, win = window) {
  if (!url) return url;
  if (/\w+:\/\//.exec(url)) {
    // url already has protocol
    return url;
  }
  let windowProto = win.location.protocol;
  try {
    windowProto = win.top.location.protocol;
  } catch (e) {}
  if (/^\/\//.exec(url)) {
    // url uses relative protocol ("//example.com")
    return windowProto + url;
  } else {
    return `${windowProto}//${url}`;
  }
}

/**
 * Extract the domain portion from a URL.
 * @param url
 */
export function parseDomain(url) {
  try {
    url = new URL(ensureProtocol(url));
  } catch (e) {
    return;
  }
  url = url.host;
  if (url.startsWith('www.')) {
    url = url.substring(4);
  }
  return url;
}

/**
 * @param {Window} win Window
 * @returns {Function}
 */
export function detectReferer(win) {
  /**
   * This function would return a read-only array of hostnames for all the parent frames.
   * win.location.ancestorOrigins is only supported in webkit browsers. For non-webkit browsers it will return undefined.
   *
   * @param {Window} win Window object
   * @returns {(undefined|Array)} Ancestor origins or undefined
   */
  function getAncestorOrigins(win) {
    try {
      if (!win.location.ancestorOrigins) {
        return;
      }

      return win.location.ancestorOrigins;
    } catch (e) {
      // Ignore error
    }
  }

  /**
   * This function returns canonical URL which refers to an HTML link element, with the attribute of rel="canonical", found in the <head> element of your webpage
   *
   * @param {Object} doc document
   * @returns {string|null}
   */
  function getCanonicalUrl(doc) {
    let pageURL = config.getConfig('pageUrl');

    if (pageURL) return pageURL;

    try {
      const element = doc.querySelector("link[rel='canonical']");

      if (element !== null) {
        return element.href;
      }
    } catch (e) {
      // Ignore error
    }

    return null;
  }

  /**
   * Referer info
   * @typedef {Object} refererInfo
   * @property {string} referer detected top url
   * @property {boolean} reachedTop whether prebid was able to walk upto top window or not
   * @property {number} numIframes number of iframes
   * @property {string} stack comma separated urls of all origins
   * @property {string} canonicalUrl canonical URL refers to an HTML link element, with the attribute of rel="canonical", found in the <head> element of your webpage
   */

  /**
   * Walk up the windows to get the origin stack and best available referrer, canonical URL, etc.
   *
   * @returns {refererInfo}
   */
  function refererInfo() {
    const stack = [];
    const ancestors = getAncestorOrigins(win);
    const maxNestedIframes = config.getConfig('maxNestedIframes');
    let currentWindow;
    let bestLocation;
    let bestCanonicalUrl;
    let reachedTop = false;
    let level = 0;
    let valuesFromAmp = false;
    let inAmpFrame = false;
    let hasTopLocation = false;

    do {
      const previousWindow = currentWindow;
      const wasInAmpFrame = inAmpFrame;
      let currentLocation;
      let crossOrigin = false;
      let foundLocation = null;

      inAmpFrame = false;
      currentWindow = currentWindow ? currentWindow.parent : win;

      try {
        currentLocation = currentWindow.location.href || null;
      } catch (e) {
        crossOrigin = true;
      }

      if (crossOrigin) {
        if (wasInAmpFrame) {
          const context = previousWindow.context;

          try {
            foundLocation = context.sourceUrl;
            bestLocation = foundLocation;
            hasTopLocation = true;

            valuesFromAmp = true;

            if (currentWindow === win.top) {
              reachedTop = true;
            }

            if (context.canonicalUrl) {
              bestCanonicalUrl = context.canonicalUrl;
            }
          } catch (e) { /* Do nothing */ }
        } else {
          logWarn('Trying to access cross domain iframe. Continuing without referrer and location');

          try {
            // the referrer to an iframe is the parent window
            const referrer = previousWindow.document.referrer;

            if (referrer) {
              foundLocation = referrer;

              if (currentWindow === win.top) {
                reachedTop = true;
              }
            }
          } catch (e) { /* Do nothing */ }

          if (!foundLocation && ancestors && ancestors[level - 1]) {
            foundLocation = ancestors[level - 1];
            if (currentWindow === win.top) {
              hasTopLocation = true;
            }
          }

          if (foundLocation && !valuesFromAmp) {
            bestLocation = foundLocation;
          }
        }
      } else {
        if (currentLocation) {
          foundLocation = currentLocation;
          bestLocation = foundLocation;
          valuesFromAmp = false;

          if (currentWindow === win.top) {
            reachedTop = true;

            const canonicalUrl = getCanonicalUrl(currentWindow.document);

            if (canonicalUrl) {
              bestCanonicalUrl = canonicalUrl;
            }
          }
        }

        if (currentWindow.context && currentWindow.context.sourceUrl) {
          inAmpFrame = true;
        }
      }

      stack.push(foundLocation);
      level++;
    } while (currentWindow !== win.top && level < maxNestedIframes);

    stack.reverse();

    let ref;
    try {
      ref = win.top.document.referrer;
    } catch (e) {}

    const location = reachedTop || hasTopLocation ? bestLocation : null;
    const page = ensureProtocol(bestCanonicalUrl, win) || location;

    return {
      reachedTop,
      isAmp: valuesFromAmp,
      numIframes: level - 1,
      stack,
      topmostLocation: bestLocation || null, // location of the topmost accessible frame
      location, // location of window.top, if available
      canonicalUrl: bestCanonicalUrl || null, // canonical URL as provided with setConfig({pageUrl}) or link[rel="canonical"], in that order of priority
      page, // canonicalUrl, falling back to location
      domain: parseDomain(page) || null, // the domain portion of `page`
      ref: ref || null, // window.top.document.referrer, if available
    };
  }

  return refererInfo;
}

export const getRefererInfo = detectReferer(window);
