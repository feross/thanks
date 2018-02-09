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
  kgryte: 'https://www.patreon.com/athan',
  limonte: 'https://www.patreon.com/limonte',
  mafintosh: 'https://www.patreon.com/mafintosh',
  marijn: 'https://www.patreon.com/marijn',
  mikeal: 'https://www.patreon.com/mikeal',
  mmckegg: 'https://www.patreon.com/MattMcKegg',
  moox: 'https://liberapay.com/MoOx/',
  mpj: 'https://www.patreon.com/funfunfunction',
  noffle: 'https://en.liberapay.com/noffle/',
  shama: 'https://www.patreon.com/shama',
  sindresorhus: 'https://www.patreon.com/sindresorhus',
  staltz: 'https://en.liberapay.com/andrestaltz/',
  thlorenz: 'https://www.patreon.com/thlorenz',
  yyx990803: 'https://www.patreon.com/evanyou',
  juliangruber: 'https://www.patreon.com/juliangruber'
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
  phenomic: 'https://opencollective.com/phenomic',
  preact: 'https://opencollective.com/preact',
  pug: 'https://opencollective.com/pug',
  'react-native-elements': 'https://opencollective.com/react-native-elements',
  'redux-devtools-extension': 'https://opencollective.com/redux-devtools-extension',
  rollup: 'https://opencollective.com/rollup',
  'socket.io': 'https://opencollective.com/socketio',
  'styled-components': 'https://opencollective.com/styled-components',
  tachyons: 'https://opencollective.com/tachyons',
  vue: 'https://opencollective.com/vuejs',
  webpack: 'https://opencollective.com/webpack',
  yo: 'https://opencollective.com/yeoman',
  levelup: 'https://opencollective.com/level'
}

module.exports = { authors, packages }
