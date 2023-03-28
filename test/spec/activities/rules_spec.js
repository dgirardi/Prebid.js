import {ruleRegistry} from '../../../src/activities/rules.js';

describe('Activity control rules', () => {
  const MOCK_ACTIVITY = 'mockActivity';
  const MOCK_RULE = 'mockRule';

  let registerRule, isAllowed, logger;

  beforeEach(() => {
    logger = {
      logInfo: sinon.stub(),
      logWarn: sinon.stub(),
      logError: sinon.stub(),
    };
    [registerRule, isAllowed] = ruleRegistry(logger);
  });

  it('allows by default', () => {
    expect(isAllowed(MOCK_ACTIVITY, {})).to.be.true;
  });

  it('denies if a rule throws', () => {
    registerRule(MOCK_ACTIVITY, MOCK_RULE, () => {
      throw new Error('argh');
    });
    expect(isAllowed(MOCK_ACTIVITY, {})).to.be.false;
  });

  it('denies if a rule denies', () => {
    registerRule(MOCK_ACTIVITY, MOCK_RULE, () => ({allow: false}));
    expect(isAllowed(MOCK_ACTIVITY, {})).to.be.false;
  });

  it('partitions rules by activity', () => {
    registerRule(MOCK_ACTIVITY, MOCK_RULE, () => ({allow: false}));
    expect(isAllowed('other', {})).to.be.true;
  });

  it('passes params to rules', () => {
    registerRule(MOCK_ACTIVITY, MOCK_RULE, (params) => ({allow: params.foo !== 'bar'}));
    expect(isAllowed(MOCK_ACTIVITY, {foo: 'notbar'})).to.be.true;
    expect(isAllowed(MOCK_ACTIVITY, {foo: 'bar'})).to.be.false;
  });

  it('allows if rules do not opine', () => {
    registerRule(MOCK_ACTIVITY, MOCK_RULE, () => null);
    expect(isAllowed(MOCK_ACTIVITY, {foo: 'bar'})).to.be.true;
  });

  it('denies if any rule denies', () => {
    registerRule(MOCK_ACTIVITY, MOCK_RULE, () => null);
    registerRule(MOCK_ACTIVITY, MOCK_RULE, () => ({allow: true}));
    registerRule(MOCK_ACTIVITY, MOCK_RULE, () => ({allow: false}));
    expect(isAllowed(MOCK_ACTIVITY, {foo: 'bar'})).to.be.false;
  });

  it('allows if higher priority allow rule trumps a lower priority deny rule', () => {
    registerRule(MOCK_ACTIVITY, MOCK_RULE, () => ({allow: false}));
    registerRule(MOCK_ACTIVITY, MOCK_RULE, () => ({allow: true}), 0);
    expect(isAllowed(MOCK_ACTIVITY, {})).to.be.true;
  });

  it('denies if a higher priority deny rule trumps a lower priority allow rule', () => {
    registerRule(MOCK_ACTIVITY, MOCK_RULE, () => ({allow: true}));
    registerRule(MOCK_ACTIVITY, MOCK_RULE, () => ({allow: false}), 0);
    expect(isAllowed(MOCK_ACTIVITY, {})).to.be.false;
  });

  it('logs INFO when explicit allow is found', () => {
    registerRule(MOCK_ACTIVITY, MOCK_RULE, () => ({allow: true}));
    isAllowed(MOCK_ACTIVITY, {});
    sinon.assert.calledWithMatch(logger.logInfo, new RegExp(MOCK_RULE));
  });

  it('logs INFO with reason if the rule provides one', () => {
    registerRule(MOCK_ACTIVITY, MOCK_RULE, () => ({allow: true, reason: 'because'}));
    isAllowed(MOCK_ACTIVITY, {});
    sinon.assert.calledWithMatch(logger.logInfo, new RegExp(MOCK_RULE));
    sinon.assert.calledWithMatch(logger.logInfo, /because/);
  });

  it('logs WARN when a deny is found', () => {
    registerRule(MOCK_ACTIVITY, MOCK_RULE, () => ({allow: false}));
    isAllowed(MOCK_ACTIVITY, {});
    sinon.assert.calledWithMatch(logger.logWarn, new RegExp(MOCK_RULE));
  });

  it('logs WARN with reason if the rule provides one', () => {
    registerRule(MOCK_ACTIVITY, MOCK_RULE, () => ({allow: false, reason: 'fail'}));
    isAllowed(MOCK_ACTIVITY, {});
    sinon.assert.calledWithMatch(logger.logWarn, new RegExp(MOCK_RULE));
    sinon.assert.calledWithMatch(logger.logWarn, /fail/);
  });
});
