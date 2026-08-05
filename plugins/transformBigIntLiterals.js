/**
 * Rewrites BigInt literals (`123n`) into `BigInt("123")` calls.
 *
 * There is no way to transpile BigInt to ES5 - it is a primitive with no ES5
 * representation, so babel ships only a syntax plugin and preset-env leaves literals
 * untouched. A single literal anywhere in a bundle therefore makes the *whole file*
 * unparseable on any engine without BigInt (chrome < 67, firefox < 68, safari < 14),
 * which fails everything rather than just the feature.
 *
 * @sinonjs/fake-timers hits this: its Temporal support does
 * `BigInt(clock.now) * 1000000n + BigInt(getNanos())`, so loading sinon aborts with
 * "Invalid or unexpected token" and no test runs at all.
 *
 * Converting to a call restores parseability while leaving behaviour alone: on an engine
 * with BigInt the call produces the same value, and on one without it the reference would
 * throw only if evaluated. That is safe here because the code guards itself on the host
 * providing `Temporal` (`if (isPresent.Temporal)`), which no targeted browser does - so
 * the branch is unreachable, and this only needs to get past the parser.
 *
 * This deliberately does not try to make BigInt *work* on old browsers. Nothing in
 * first-party code uses it.
 */
module.exports = function ({types: t}) {
  return {
    name: 'transform-bigint-literals-to-calls',
    visitor: {
      BigIntLiteral(path) {
        path.replaceWith(
          t.callExpression(t.identifier('BigInt'), [t.stringLiteral(path.node.value)])
        );
      }
    }
  };
};
