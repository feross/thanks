/*
 * npm username -> donate page
 *
 * Whenever a `thanks` user has a package owned by one of these authors in their
 * package tree, they will be prompted to donate.
 */
const authors = {
  andrewnez: 'https://en.liberapay.com/andrew/',
  bevacqua: 'https://www.patreon.com/bevacqua',
  feross: 'https://www.patreon.com/feross',
  getify: 'https://www.patreon.com/getify',
  hueniverse: 'https://www.patreon.com/eranhammer',
  hughsk: 'https://hughsk.io/donate/',
  mafintosh: 'https://www.patreon.com/mafintosh',
  mikeal: 'https://www.patreon.com/mikeal',
  mmckegg: 'https://www.patreon.com/MattMcKegg',
  mpj: 'https://www.patreon.com/funfunfunction',
  noffle: 'https://en.liberapay.com/noffle/',
  paulirish: 'https://en.liberapay.com/paulirish/',
  sindresorhus: 'https://www.patreon.com/sindresorhus',
  staltz: 'https://en.liberapay.com/andrestaltz/',
  thlorenz: 'https://www.patreon.com/thlorenz',
  yyx990803: 'https://www.patreon.com/evanyou'
}

/*
 * npm package name -> donate page
 *
 * Whenever a `thanks` user has one these exact packages in their package tree,
 * they will be prompted to donate.
 */
const packages = {
  'babel-core': 'https://opencollective.com/babel',
  bower: 'https://opencollective.com/bower',
  chai: 'https://opencollective.com/chaijs',
  cheerio: 'https://opencollective.com/cheerio',
  choo: 'https://opencollective.com/choo',
  gulp: 'https://opencollective.com/gulpjs',
  'gulp-cli': 'https://opencollective.com/gulpjs',
  hoodie: 'https://opencollective.com/hoodie',
  koa: 'https://opencollective.com/koajs',
  'material-ui': 'https://opencollective.com/material-ui',
  mocha: 'https://opencollective.com/mochajs',
  parcel: 'https://opencollective.com/parcel',
  preact: 'https://opencollective.com/preact',
  pug: 'https://opencollective.com/pug',
  'react-native-elements': 'https://opencollective.com/react-native-elements',
  'redux-devtools-extension': 'https://opencollective.com/redux-devtools-extension',
  rollup: 'https://opencollective.com/rollup',
  'socket.io': 'https://opencollective.com/socketio',
  'styled-components': 'https://opencollective.com/styled-components',
  tachyons: 'https://opencollective.com/tachyons',
  webpack: 'https://opencollective.com/webpack',
  yo: 'https://opencollective.com/yeoman'
}

module.exports = { authors, packages }
