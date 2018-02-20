#!/usr/bin/env node

const chalk = require('chalk')
const got = require('got') // TODO: use simple-peer when it supports promises
const minimist = require('minimist')
const opn = require('opn')
const ora = require('ora')
const pify = require('pify')
const pkgDir = require('pkg-dir')
const pkgUp = require('pkg-up')
const PromptConfirm = require('prompt-confirm')
const readPackageTree = require('read-package-tree')
const registryAuthToken = require('registry-auth-token')
const RegistryClient = require('npm-registry-client') // TODO: use npm-registry-fetch when done
const registryUrl = require('registry-url')
const stripAnsi = require('strip-ansi')
const termSize = require('term-size')
const textTable = require('text-table')
const { readFile } = require('fs')
const { stripIndent } = require('common-tags')

const thanks = require('../')

const readFileAsync = pify(readFile)
const readPackageTreeAsync = pify(readPackageTree)

const DOWNLOADS_URL = 'https://api.npmjs.org/downloads/point/last-month/'
const DOWNLOADS_URL_LIMIT = 128
const RE_URL_PREFIX = /https?:\/\/(www\.)?/
const RE_TRAILING_SLASH = /\/$/
const HEARTS_SPINNER = {
  'interval': 100,
  'frames': [
    '💛 ',
    '💙 ',
    '💜 ',
    '💚 '
  ]
}

let spinner

init()
  .catch(function (err) {
    const message = `Error: ${err.message}\n`

    if (spinner) spinner.fail(message)
    else console.error(message)

    console.error(
      chalk`{cyan Found a bug?} Open an issue at {magenta https://github.com/feross/thanks}\n`
    )
    console.error(err.stack)
    process.exitCode = 1
  })

async function init () {
  const argv = minimist(process.argv.slice(2), {
    boolean: [
      'open'
    ],
    alias: {
      h: 'help',
      v: 'version'
    },
    default: {
      open: true
    }
  })
  const cwd = argv._[0] || process.cwd()

  if (argv.help) {
    return runHelp()
  }
  if (argv.version) {
    return runVersion()
  }
  return runThanks(cwd, argv.open)
}

function runHelp () {
  const message = stripIndent`
    thanks - 🙌 Give thanks to the open source maintainers you depend on! ✨

    Usage:
        thanks <flags> [CWD]

        If CWD is omitted, then the current working directory is used. The "nearest"
        package.json / node_modules folder will be used.

    Flags:
        -v, --version   Show current version
        -h, --help      Show usage information

  `
  console.log(message)
}

function runVersion () {
  console.log(require('../package.json').version)
}

async function runThanks (cwd, promptToOpen) {
  spinner = ora({
    spinner: HEARTS_SPINNER,
    text: chalk`Getting ready to {cyan give thanks} to {magenta maintainers}...`
  }).start()

  const client = createRegistryClient()

  spinner.text = chalk`Reading {cyan direct dependencies} from metadata in {magenta package.json}...`
  const directPkgNames = await readDirectPkgNames()

  spinner.text = chalk`Reading {cyan dependencies} from package tree in {magenta node_modules}...`
  const rootPath = await pkgDir(cwd)
  const packageTree = await readPackageTreeAsync(rootPath)
  const pkgNames = packageTree.children
    .map(node => node.package.name)
    // Filter out folders without a package.json in node_modules
    // See: https://github.com/feross/thanks/issues/72
    .filter(Boolean)

  if (pkgNames.length === 0) {
    spinner.fail(chalk`{red No packages} found in the {magenta node_modules} folder. Try running {cyan npm install} first, silly! 😆`)
    return
  }

  // Get latest registry data on each local package, since the local data does
  // not include the list of maintainers
  spinner.text = chalk`Fetching package {cyan maintainers} from {red npm}...`
  let pkgs = await fetchPkgs(client, pkgNames)

  spinner.text = chalk`Fetching package {cyan download counts} from {red npm}...`
  const pkgDownloads = await bulkFetchPkgDownloads(pkgNames)

  // Author name -> list of packages (sorted by direct dependencies, then download count)
  const authorsPkgNames = computeAuthorsPkgNames(pkgs, pkgDownloads, directPkgNames)

  // Array of author names who are seeking donations (sorted by download count)
  const authorsSeeking = Object.keys(authorsPkgNames)
    .filter(author => thanks.authors[author] != null)
    .sort((author1, author2) => authorsPkgNames[author2].length - authorsPkgNames[author1].length)

  // Array of package names that are seeking donations (sorted by download counte)
  const pkgNamesSeeking = pkgNames
    .filter(pkgName => thanks.packages[pkgName] != null)
    .sort((pkg1, pkg2) => pkgDownloads[pkg2] - pkgDownloads[pkg1])

  const donateLinks = [].concat(
    authorsSeeking.map(author => thanks.authors[author]),
    pkgNamesSeeking.map(pkgName => thanks.packages[pkgName])
  )

  const authorStr = chalk.cyan(`${authorsSeeking.length} authors`)
  const pkgNamesStr = chalk.cyan(`${pkgNamesSeeking.length} teams`)

  if (authorsSeeking.length > 0 && pkgNamesSeeking.length > 0) {
    spinner.succeed(
      chalk`You depend on ${authorStr} and ${pkgNamesStr} who are {magenta seeking donations!} ✨\n`
    )
  } else if (authorsSeeking.length > 0) {
    spinner.succeed(
      chalk`You depend on ${authorStr} who are {magenta seeking donations!} ✨\n`
    )
  } else if (pkgNamesSeeking.length > 0) {
    spinner.succeed(
      chalk`You depend on ${pkgNamesStr} who are {magenta seeking donations!} ✨\n`
    )
  } else {
    spinner.succeed(
      chalk`You depend on {cyan no authors} who are seeking donations! 😌`
    )
  }

  if (authorsSeeking.length > 0 || pkgNamesSeeking.length > 0) {
    printTable(authorsSeeking, pkgNamesSeeking, authorsPkgNames, directPkgNames)
  }

  if (donateLinks.length && promptToOpen) {
    const prompt = new PromptConfirm(
      chalk`Want to open these {cyan donate pages} in your {magenta web browser}? 🦄`
    )
    const doOpen = await prompt.run()
    if (doOpen) openDonateLinks(donateLinks)
  }
}

function createRegistryClient () {
  const opts = {
    log: {
      error () {},
      http () {},
      info () {},
      silly () {},
      verbose () {},
      warn () {}
    }
  }
  const client = new RegistryClient(opts)
  client.getAsync = pify(client.get.bind(client))
  return client
}

function isScopedPkg (pkgName) {
  return pkgName.includes('/')
}

async function fetchPkgs (client, pkgNames) {
  const pkgs = await Promise.all(pkgNames.map(fetchPkg))

  // Filter out `null`s which come from private packages or GitHub dependencies
  // which don't exist on npm (so don't have package metadata)
  return pkgs.filter(Boolean)

  async function fetchPkg (pkgName) {
    // Note: The registry does not support fetching versions for scoped packages
    const url = isScopedPkg(pkgName)
      ? `${registryUrl()}${pkgName.replace('/', '%2F')}`
      : `${registryUrl()}${pkgName}/latest`

    const opts = {
      timeout: 30 * 1000,
      staleOk: true,
      auth: registryAuthToken()
    }

    let pkg = null
    try {
      pkg = await client.getAsync(url, opts)
    } catch (err) {
      // Private packages or GitHub dependecies that don't exist on npm will return
      // 404 errors, so just skip those packages
    }
    return pkg
  }
}

function printTable (authorsSeeking, pkgNamesSeeking, authorsPkgNames, directPkgNames) {
  // Highlight direct dependencies in a different color
  function maybeHighlightPkgName (pkgName) {
    return directPkgNames.includes(pkgName)
      ? chalk.green.bold(pkgName)
      : pkgName
  }

  const authorRows = authorsSeeking
    .map(author => {
      const authorPkgNames = authorsPkgNames[author].map(maybeHighlightPkgName)
      const donateLink = prettyUrl(thanks.authors[author])
      return [
        author,
        chalk.cyan(donateLink),
        listWithMaxLen(authorPkgNames, termSize().columns - 50)
      ]
    })

  const packageRows = pkgNamesSeeking
    .map(pkgName => {
      const donateLink = prettyUrl(thanks.packages[pkgName])
      return [
        `${pkgName} (team)`,
        chalk.cyan(donateLink),
        maybeHighlightPkgName(pkgName)
      ]
    })

  const rows = [[
    chalk.underline('Author'),
    chalk.underline('Where to Donate'),
    chalk.underline('Dependencies')
  ]].concat(
    authorRows,
    packageRows
  )

  const opts = {
    stringLength: str => stripAnsi(str).length
  }
  const table = textTable(rows, opts)
  console.log(table + '\n')
}

function prettyUrl (url) {
  return url
    .replace(RE_URL_PREFIX, '')
    .replace(RE_TRAILING_SLASH, '')
}

async function bulkFetchPkgDownloads (pkgNames) {
  // A few notes:
  //   - bulk queries do not support scoped packages
  //   - bulk queries are limited to at most 128 packages at a time
  const pkgDownloads = {}

  const normalPkgNames = pkgNames.filter(pkgName => !isScopedPkg(pkgName))
  const scopedPkgNames = pkgNames.filter(isScopedPkg)

  for (let start = 0; start < normalPkgNames.length; start += DOWNLOADS_URL_LIMIT) {
    const pkgNamesSubset = normalPkgNames.slice(start, start + DOWNLOADS_URL_LIMIT)
    const url = DOWNLOADS_URL + pkgNamesSubset.join(',')
    let res
    try {
      res = await got(url, { json: true })
    } catch (err) {
      // If a single package is requested and does not exists, it will return a 404
      // error. Ignore the error.
      continue
    }
    Object.keys(res.body).forEach(pkgName => {
      const stats = res.body[pkgName]
      // If multiple packages are requested and some of them do not exist, those keys
      // will have a value of null. Skip those packages.
      if (stats) pkgDownloads[pkgName] = stats.downloads
    })
  }

  // Scoped packages must be requested individually since they're not supported in
  // bulk queries.
  await Promise.all(scopedPkgNames.map(async scopedPkgName => {
    const url = DOWNLOADS_URL + scopedPkgName
    let res
    try {
      res = await got(url, { json: true })
      pkgDownloads[scopedPkgName] = res.body.downloads
    } catch (err) {
      // If a single package is requested and does not exists, it will return a 404
      // error. Ignore the error.
    }
  }))

  return pkgDownloads
}

function computeAuthorsPkgNames (pkgs, pkgDownloads, directPkgNames) {
  // author name -> array of package names
  const authorPkgNames = {}

  pkgs.forEach(pkg => {
    if (!pkg.maintainers) {
      // Ignore packages that are missing a "maintainers" field (e.g.
      // http://registry.npmjs.com/vargs/latest). This appears to happen on very old
      // packages. My guess is that the "maintainers" field only started getting
      // added to release metadata recently.
      return
    }
    pkg.maintainers
      .map(maintainer => maintainer.name)
      .forEach(author => {
        if (authorPkgNames[author] == null) authorPkgNames[author] = []
        authorPkgNames[author].push(pkg.name)
      })
  })

  // Sort each author's package list by direct dependencies, then download count
  // dependencies first in the list
  Object.keys(authorPkgNames).forEach(author => {
    const authorDirectPkgNames = authorPkgNames[author]
      .filter(pkgName => directPkgNames.includes(pkgName))

    const pkgNames = authorPkgNames[author]
      .filter(pkgName => !authorDirectPkgNames.includes(pkgName))
      .sort((pkg1, pkg2) => pkgDownloads[pkg2] - pkgDownloads[pkg1])

    pkgNames.unshift(...authorDirectPkgNames)

    authorPkgNames[author] = pkgNames
  })

  return authorPkgNames
}

function listWithMaxLen (list, maxLen) {
  const ELLIPSIS = chalk` {magenta + XX more}`
  const ELLIPSIS_LENGTH = stripAnsi(ELLIPSIS).length
  let str = ''
  for (let i = 0; i < list.length; i++) {
    const item = (i === 0 ? '' : ', ') + list[i]
    if (stripAnsi(str).length + stripAnsi(item).length >= maxLen - ELLIPSIS_LENGTH) {
      str += ELLIPSIS.replace('XX', list.length - i)
      break
    }
    str += item
  }
  return str
}

async function openDonateLinks (donateLinks) {
  for (let donateLink of donateLinks) {
    await opn(donateLink, { wait: false })
  }
  console.log(chalk`\n{bold.yellow You are awesome!} 🌟`)
}

async function readDirectPkgNames () {
  const pkgPath = await pkgUp()

  if (pkgPath == null) {
    throw new Error(
      'No package.json found. Run this in a Node.js project folder!'
    )
  }

  const pkgStr = await readFileAsync(pkgPath, 'utf8')

  let pkg
  try {
    pkg = JSON.parse(pkgStr)
  } catch (err) {
    err.message = `Failed to parse package.json: ${err.message}`
    throw err
  }

  return [].concat(
    findDeps(pkg, 'dependencies'),
    findDeps(pkg, 'devDependencies'),
    findDeps(pkg, 'optionalDependencies')
  )

  function findDeps (pkg, type) {
    return pkg[type] && typeof pkg[type] === 'object'
      ? Object.keys(pkg[type])
      : []
  }
}
