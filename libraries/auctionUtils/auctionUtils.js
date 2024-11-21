export function timeoutQueue() {
  const queue = [];
  return {
    submit(timeout, onResume, onTimeout) {
      const item = [
        onResume,
        setTimeout(() => {
          queue.splice(queue.indexOf(item), 1);
          // eslint-disable-next-line prefer-promise-reject-errors
          onTimeout();
        }, timeout)
      ];
      queue.push(item);
    },
    resume() {
      while (queue.length) {
        const [onResume, timerId] = queue.shift();
        clearTimeout(timerId);
        onResume();
      }
    }
  }
}

/**
 * @summary This is the function which will be called to exit module and continue the auction.
 */
export function continueAuction(hookConfig, delayedAuctions, callback) {
  // only run if hasExited
  if (!hookConfig.hasExited) {
    // if this current auction is still fetching, remove it from the _delayedAuctions
    const auctionIndex = delayedAuctions.findIndex(auctionConfig => auctionConfig.timer === hookConfig.timer);
    delayedAuctions.splice(auctionIndex, 1);

    if (callback) {
      callback();
    }

    hookConfig.nextFn.apply(hookConfig.context, [hookConfig.reqBidsConfigObj]);
    hookConfig.hasExited = true;
  }
}

/**
 * @summary If an auction was queued to be delayed (waiting for a fetch) then this function will resume
 * those delayed auctions when delay is hit or success return or fail return
 */
export function resumeDelayedAuctions(delayedAuctions, continueAuctionFn) {
  delayedAuctions.forEach(auctionConfig => {
    // clear the timeout
    clearTimeout(auctionConfig.timer);
    continueAuctionFn(auctionConfig);
  });
  delayedAuctions.length = 0;
}
