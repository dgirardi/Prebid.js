// This configures Karma, describing how to run the tests and where to output code coverage reports.
//
// For more information, see http://karma-runner.github.io/1.0/config/configuration-file.html

var _ = require('lodash');
var webpackConf = require('./webpack.conf.js');
var karmaConstants = require('karma').constants;
const path = require('path');
const helpers = require('./gulpHelpers.js');
const common = require('./webpack.common.js');
const cacheDir = path.resolve(__dirname, '.cache/babel-loader');

// Karma serves the test frameworks as plain files, so the ES5 babel pass in
// webpack.common.js never sees them - and as published they are far beyond what the
// browsers that build targets can parse: mocha uses object spread (ES2018) and sinon a
// static class field (ES2022), which between them would require chrome 72 / safari 14.1
// / firefox 75 just to load the page. Transpile them as they are served instead, so the
// unit tests can run on the versions the ES5 build actually claims to support.
const ES5_SERVED_FRAMEWORKS = [
  '**/node_modules/mocha/mocha.js',
  '**/node_modules/chai/chai.js',
  '**/node_modules/sinon/pkg/sinon.js'
];

// `globalThis` is chrome 71 / firefox 65 / safari 12.1. Sinon's dependency chain does
// `typeof globalThis === "undefined" ? global : globalThis` and so reaches for node's
// `global`, which does not exist in a browser - "ReferenceError: global is not defined",
// before any test runs. Code inside webpack gets globalThis from core-js; these files are
// served raw and do not, so give them one.
const GLOBAL_THIS_SHIM = 'typeof globalThis === "undefined" && (window.globalThis = window);\n';

function es5FrameworkPreprocessor() {
  const babel = require('@babel/core');
  return function (content, file, done) {
    let transformed;
    try {
      transformed = babel.transformSync(content, {
        filename: file.originalPath,
        babelrc: false,
        configFile: false,
        // these are UMD bundles, not modules; parsing them as modules would impose
        // strict mode on code that does not expect it
        sourceType: 'script',
        compact: false,
        presets: [['@babel/preset-env', {
          targets: {browsers: common.browsers},
          useBuiltIns: false,
          modules: false
        }]],
        // sinon carries a BigInt literal, which preset-env cannot remove and which makes
        // the whole file unparseable on the browsers this build targets
        plugins: [path.resolve(__dirname, './plugins/transformBigIntLiterals.js')]
      }).code;
    } catch (e) {
      return done(e);
    }
    done(null, GLOBAL_THIS_SHIM + transformed);
  };
}
es5FrameworkPreprocessor.$inject = [];

function newWebpackConfig(codeCoverage, disableFeatures) {
  // Make a clone here because we plan on mutating this object, and don't want parallel tasks to trample each other.
  var webpackConfig = _.cloneDeep(webpackConf);

  Object.assign(webpackConfig, {
    mode: 'development',
    devtool: 'inline-source-map',
    cache: {
      type: 'filesystem',
      cacheDirectory: path.resolve(__dirname, '.cache/webpack-test')
    },
  });
  ['entry', 'optimization'].forEach(prop => delete webpackConfig[prop]);
  webpackConfig.module = webpackConfig.module || {};
  webpackConfig.module.rules = webpackConfig.module.rules || [];
  webpackConfig.module.rules.push({
    test: /\.js$/,
    exclude: path.resolve('./node_modules'),
    loader: 'babel-loader',
    options: {
      cacheDirectory: cacheDir, cacheCompression: false,
      plugins: ['@babel/plugin-transform-modules-commonjs'].concat(codeCoverage ? ['babel-plugin-istanbul'] : [])
    }
  })
  return webpackConfig;
}

function newPluginsArray(browserstack) {
  var plugins = [
    'karma-chrome-launcher',
    'karma-safarinative-launcher',
    'karma-coverage',
    'karma-mocha',
    'karma-chai',
    'karma-sinon',
    'karma-sourcemap-loader',
    'karma-spec-reporter',
    'karma-webpack',
    'karma-mocha-reporter',
    '@chiragrupani/karma-chromium-edge-launcher',
  ];
  if (browserstack) {
    plugins.push('karma-browserstack-launcher');
  }
  plugins.push('karma-firefox-launcher');
  plugins.push('karma-opera-launcher');
  plugins.push('karma-script-launcher');
  if (common.isES5Mode) {
    plugins.push({'preprocessor:es5-framework': ['factory', es5FrameworkPreprocessor]});
  }
  return plugins;
}

function setReporters(karmaConf, codeCoverage, browserstack, chunkNo) {
  // In browserstack, the default 'progress' reporter floods the logs.
  // The karma-spec-reporter reports failures more concisely
  if (browserstack) {
    karmaConf.reporters = ['spec'];
    karmaConf.specReporter = {
      maxLogLines: 100,
      suppressErrorSummary: false,
      suppressSkipped: false,
      suppressPassed: true
    };
  }

  if (codeCoverage) {
    karmaConf.reporters.push('coverage');
    karmaConf.coverageReporter = {
      dir: `build/coverage/chunks/${chunkNo}`,
      reporters: [
        { type: 'lcov', subdir: '.' }
      ]
    };
  }
}

function setBrowsers(karmaConf, browserstack) {
  karmaConf.customLaunchers = karmaConf.customLaunchers || {};
  karmaConf.customLaunchers.ChromeNoSandbox = {
    base: 'ChromeHeadless',
    // disable sandbox - necessary within Docker and when using versions installed through @puppeteer/browsers
    flags: ['--no-sandbox']
  }
  if (browserstack) {
    karmaConf.browserStack = {
      username: process.env.BROWSERSTACK_USERNAME,
      accessKey: process.env.BROWSERSTACK_ACCESS_KEY,
      build: process.env.BROWSERSTACK_BUILD_NAME
    }
    if (process.env.BROWSERSTACK_LOCAL_IDENTIFIER) {
      karmaConf.browserStack.startTunnel = false;
      karmaConf.browserStack.tunnelIdentifier = process.env.BROWSERSTACK_LOCAL_IDENTIFIER;
    }
    // BROWSERS_JSON lets CI point the suite at an explicit browser set - the ES5 job uses
    // it to test the versions that build targets. `||` rather than `??`: an omitted
    // workflow input arrives as the empty string, not as undefined.
    karmaConf.customLaunchers = require(`./${process.env.BROWSERS_JSON || 'browsers.json'}`);
    karmaConf.browsers = Object.keys(karmaConf.customLaunchers);
  } else {
    var isDocker = require('is-docker')();
    if (isDocker) {
      karmaConf.browsers = ['ChromeNoSandbox'];
    } else {
      karmaConf.browsers = ['ChromeHeadless'];
    }
  }
}

module.exports = function(codeCoverage, browserstack, watchMode, file, disableFeatures, chunkNo) {
  var webpackConfig = newWebpackConfig(codeCoverage, disableFeatures);
  var plugins = newPluginsArray(browserstack);
  if (file) {
    file = Array.isArray(file) ? ['test/pipeline_setup.js', ...file] : [file]
  }

  var files = file ? ['test/test_deps.js', ...file, 'test/helpers/hookSetup.js'].flatMap(f => f) : ['test/test_index.js'];
  files = files.map(helpers.getPrecompiledPath);

  var config = {
    // base path that will be used to resolve all patterns (eg. files, exclude)
    basePath: './',

    webpack: webpackConfig,
    webpackMiddleware: {
      stats: 'errors-only',
      noInfo: true
    },
    // frameworks to use
    // available frameworks: https://npmjs.org/browse/keyword/karma-adapter
    frameworks: ['mocha', 'chai', 'sinon', 'webpack'],

    // test files should not be watched or they'll run twice after an update
    // (they are still, in fact, watched through autoWatch: true)
    files: files.map(fn => ({pattern: fn, watched: false, served: true, included: true})),

    // preprocess matching files before serving them to the browser
    // available preprocessors: https://npmjs.org/browse/keyword/karma-preprocessor
    preprocessors: Object.assign(
      Object.fromEntries(files.map(f => [f, ['webpack', 'sourcemap']])),
      common.isES5Mode
        ? Object.fromEntries(ES5_SERVED_FRAMEWORKS.map(f => [f, ['es5-framework']]))
        : {}
    ),

    // web server port
    port: 9876,

    // enable / disable colors in the output (reporters and logs)
    colors: true,

    // level of logging
    // possible values: LOG_DISABLE || LOG_ERROR || LOG_WARN || LOG_INFO || LOG_DEBUG
    logLevel: karmaConstants.LOG_INFO,

    // enable / disable watching file and executing tests whenever any file changes
    autoWatch: watchMode,
    autoWatchBatchDelay: 2000,

    reporters: ['mocha'],

    client: {
      mocha: {
        timeout: 3000
      }
    },

    mochaReporter: {
      showDiff: true,
      output: 'minimal'
    },

    // Continuous Integration mode
    // if true, Karma captures browsers, runs the tests and exits
    singleRun: !watchMode,
    browserDisconnectTimeout: 1e4,
    browserNoActivityTimeout: 3e4,
    captureTimeout: 2e4,
    browserDisconnectTolerance: 5,
    concurrency: 5, // browserstack allows us 5 concurrent sessions

    plugins: plugins
  };

  setReporters(config, codeCoverage, browserstack, chunkNo);
  setBrowsers(config, browserstack);
  return config;
}
