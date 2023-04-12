import {isData, objectTransformer} from '../../src/activities/redactor.js';
import {deepAccess, deepClone, deepEqual, deepSetValue} from '../../src/utils.js';

/**
 * @typedef {Object} Guard
 * @property {{}} obj a view on the guarded object where reads are passed through redaction rules
 * @property {function(): void} verify a method that, when called, verifies that no disallowed writes were done;
 *    and undoes them if they were.
 */

/**
 * @param {Array[TransformationRule]} rules
 * @return {function(*, ...[*]): Guard}
 */
export function objectGuard(rules) {
  const root = {};
  const writeRules = [];

  rules.forEach(rule => {
    if (rule.wp) writeRules.push(rule);
    if (!rule.get) return;
    rule.paths.forEach(path => {
      let node = root;
      path.split('.').forEach(el => {
        node.children = node.children || {};
        node.children[el] = node.children[el] || {};
        node = node.children[el];
      })
      node.rule = rule;
    });
  });

  const wpTransformer = objectTransformer(writeRules);

  function mkApplies(session, args) {
    return function applies(rule) {
      if (!session.hasOwnProperty(rule.name)) {
        session[rule.name] = rule.applies(...args);
      }
      return session[rule.name];
    }
  }

  function mkGuard(obj, tree, applies) {
    return new Proxy(obj, {
      get(target, prop, receiver) {
        const val = Reflect.get(target, prop, receiver);
        if (tree.hasOwnProperty(prop)) {
          const {children, rule} = tree[prop];
          if (children && val != null && typeof val === 'object') {
            return mkGuard(val, children, applies);
          } else if (rule && isData(val) && applies(rule)) {
            return rule.get(val);
          }
        }
        return val;
      },
    });
  }

  function mkVerify(transformResult) {
    return function () {
      transformResult.forEach(fn => fn());
    }
  }

  return function guard(obj, ...args) {
    const session = {};
    return {
      obj: mkGuard(obj, root.children || {}, mkApplies(session, args)),
      verify: mkVerify(wpTransformer(session, obj, ...args))
    }
  };
}

export function writeProtectRule(ruleDef) {
  return Object.assign({
    wp: true,
    run(root, path, object, property, applies) {
      const origHasProp = object && object.hasOwnProperty(property);
      const original = origHasProp ? object[property] : undefined;
      const origCopy = origHasProp && typeof original === 'object' ? deepClone(original) : original;
      return function () {
        const object = path == null ? root : deepAccess(root, path);
        const finalHasProp = object && isData(object[property]);
        const finalValue = finalHasProp ? object[property] : undefined;
        if (!origHasProp && finalHasProp && applies()) {
          delete object[property];
        } else if ((origHasProp !== finalHasProp || finalValue !== original || !deepEqual(finalValue, origCopy)) && applies()) {
          deepSetValue(root, (path == null ? [] : [path]).concat(property).join('.'), origCopy);
        }
      }
    }
  }, ruleDef)
}
