#!/usr/bin/env node

const chalk = require('chalk')
const got = require('got') // TODO: use simple-peer when it supports promises
const minimist = require('minimist')
const opn = require('opn')
const ora = require('ora')
const pify = require('pify')
const pkgDir = require('pkg-dir')
const pkgUp = require('pkg-up')
const readPackageTree = require('read-package-tree')
const RegistryClient = require('npm-registry-client') // TODO: use npm-registry-fetch when done
const registryUrl = require('registry-url')
const setTimeoutAsync = require('timeout-as-promise')
const stripAnsi = require('strip-ansi')
const termSize = require('term-size')
const textTable = require('text-table')
const { readFile } = require('fs')

const thanks = require('./')

const readFileAsync = pify(readFile)
const readPackageTreeAsync = pify(readPackageTree)

const DOWNLOADS_URL = 'https://api.npmjs.org/downloads/point/last-month/'
const DOWNLOADS_URL_LIMIT = 128
const RE_REMOVE_URL_PREFIX = /https?:\/\/(www\.)?/
const HEARTS_SPINNER = {
  'interval': 100,
  'frames': [
    '💛 ',
    '💙 ',
    '💜 ',
    '💚 '
  ]
}

const spinner = ora({
  spinner: HEARTS_SPINNER,
  text: chalk`Getting ready to {cyan give thanks} to {magenta maintainers}...`
}).start()

init()
  .catch(function (err) {
    spinner.fail(`Error: ${err.message}\n`)
    console.error(
      chalk`{cyan Found a bug?} Open an issue at {magenta https://github.com/feross/thanks}\n`
    )
    console.error(err.stack)
    process.exitCode = 1
  })

async function init () {
  const client = createRegistryClient()

  const argv = minimist(process.argv.slice(2), {
    boolean: ['open'],
    default: {
      open: true
    }
  })
  const cwd = argv._[0] || process.cwd()

  spinner.text = chalk`Reading {cyan direct dependencies} from metadata in {magenta package.json}...`
  const directPkgNames = await readDirectPkgNames()

  spinner.text = chalk`Reading {cyan dependencies} from package tree in {magenta node_modules}...`
  const rootPath = await pkgDir(cwd)
  const packageTree = await readPackageTreeAsync(rootPath)

  // Get latest registry data on each local package, since the local data does
  // not include the list of maintainers
  spinner.text = chalk`Fetching package {cyan maintainers} from {red npm}...`
  const pkgNames = packageTree.children.map(node => node.package.name)
  const allPkgs = await Promise.all(pkgNames.map(pkgName => fetchPkg(client, pkgName)))

  spinner.text = chalk`Fetching package {cyan download counts} from {red npm}...`
  const downloadCounts = await bulkFetchDownloads(pkgNames)

  // Author name -> list of packages (sorted by direct dependencies, then download count)
  const authorsPkgNames = computeAuthorsPkgNames(allPkgs, downloadCounts, directPkgNames)

  // Array of author names who are seeking donations
  const authorsSeeking = Object.keys(authorsPkgNames)
    .filter(author => thanks.authors[author] != null)
    .sort((author1, author2) => authorsPkgNames[author2].length - authorsPkgNames[author1].length)

  const donateLinks = authorsSeeking
    .map(author => thanks.authors[author])

  if (authorsSeeking.length) {
    spinner.succeed(chalk`You depend on {cyan ${authorsSeeking.length} authors} who are {magenta seeking donations!} ✨\n`)
    printTable(authorsSeeking, authorsPkgNames, directPkgNames)
    if (argv.open) openDonateLinks(donateLinks)
  } else {
    spinner.info('You don\'t depend on any packages from maintainers seeking donations')
  }

  // TODO: compute list of **projects** seeking donations
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

async function fetchPkg (client, pkgName) {
  // Note: The registry does not support fetching versions for scoped packages
  const url = isScopedPkg(pkgName)
    ? `${registryUrl()}${pkgName.replace('/', '%2F')}`
    : `${registryUrl()}${pkgName}/latest`

  const opts = {
    timeout: 30 * 1000,
    staleOk: true
  }
  return client.getAsync(url, opts)
}

function printTable (authorsSeeking, authorsPkgNames, directPkgNames) {
  const rows = authorsSeeking
    .map(author => {
      // Highlight direct dependencies in a different color
      const authorPkgNames = authorsPkgNames[author]
        .map(pkgName => {
          return directPkgNames.includes(pkgName)
            ? chalk.green.bold(pkgName)
            : pkgName
        })

      const donateLink = thanks.authors[author].replace(RE_REMOVE_URL_PREFIX, '')
      return [
        author,
        chalk.cyan(donateLink),
        listWithMaxLen(authorPkgNames, termSize().columns - 45)
      ]
    })

  rows.unshift([
    chalk.underline('Author'),
    chalk.underline('Where to Donate'),
    chalk.underline('Dependencies')
  ])

  const opts = {
    stringLength: str => stripAnsi(str).length
  }
  const table = textTable(rows, opts)
  console.log(table + '\n')
}

async function bulkFetchDownloads (pkgNames) {
  // A few notes:
  //   - bulk queries do not support scoped packages
  //   - bulk queries are limited to at most 128 packages at a time
  const downloads = {}

  const normalPkgNames = pkgNames.filter(pkgName => !isScopedPkg(pkgName))
  const scopedPkgNames = pkgNames.filter(isScopedPkg)

  for (let start = 0; start < normalPkgNames.length; start += DOWNLOADS_URL_LIMIT) {
    const pkgNamesSubset = normalPkgNames.slice(start, start + DOWNLOADS_URL_LIMIT)
    const url = DOWNLOADS_URL + pkgNamesSubset.join(',')
    const res = await got(url, { json: true })
    Object.keys(res.body).forEach(pkgName => {
      downloads[pkgName] = res.body[pkgName].downloads
    })
  }

  await Promise.all(scopedPkgNames.map(async scopedPkgName => {
    const url = DOWNLOADS_URL + scopedPkgName
    const res = await got(url, { json: true })
    downloads[scopedPkgName] = res.body.downloads
  }))

  return downloads
}

function computeAuthorsPkgNames (pkgs, downloadCounts, directPkgNames) {
  // author name -> array of package names
  const authorPkgNames = {}

  pkgs.forEach(pkg => {
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
      .sort((pkg1, pkg2) => downloadCounts[pkg2] - downloadCounts[pkg1])

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
  const len = donateLinks.length

  const spinner = ora({
    spinner: HEARTS_SPINNER,
    text: chalk`Opening {cyan ${len} donate pages} in your {magenta web browser}...`
  }).start()

  await setTimeoutAsync(2000)

  for (let donateLink of donateLinks) {
    await opn(donateLink, { wait: false })
  }

  spinner.succeed(chalk`Opened {cyan ${len} donate pages} in your {magenta web browser} 💻`)
}

async function readDirectPkgNames () {
  const pkgPath = await pkgUp()
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
