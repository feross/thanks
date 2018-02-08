#!/usr/bin/env node

const chalk = require('chalk')
const got = require('got') // TODO: use simple-peer when it supports promises
const minimist = require('minimist')
const opn = require('opn')
const ora = require('ora')
const pify = require('pify')
const pkgDir = require('pkg-dir')
const readPackageTree = require('read-package-tree')
const RegistryClient = require('npm-registry-client') // TODO: use npm-registry-fetch when done
const registryUrl = require('registry-url')
const stripAnsi = require('strip-ansi')
const termSize = require('term-size')
const textTable = require('text-table')
const setTimeoutAsync = require('timeout-as-promise')

const thanks = require('./')

const readPackageTreeAsync = pify(readPackageTree)

const DOWNLOADS_URL = 'https://api.npmjs.org/downloads/point/last-month/'
const DOWNLOADS_URL_LIMIT = 128
const RE_REMOVE_URL_PREFIX = /https?:\/\/(www\.)?/

const spinner = ora({
  spinner: 'moon',
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

  // Author name -> list of packages (sorted by download count)
  const authorsPkgNames = computeAuthorsPkgNames(allPkgs, downloadCounts)

  // Array of author names who are seeking donations
  const authorsSeeking = Object.keys(authorsPkgNames)
    .filter(author => thanks.authors[author] != null)
    .sort((author1, author2) => authorsPkgNames[author2].length - authorsPkgNames[author1].length)

  const donateLinks = authorsSeeking
    .map(author => thanks.authors[author])

  if (authorsSeeking.length) {
    spinner.succeed(chalk`You depend on {cyan ${authorsSeeking.length} authors} who are {magenta seeking donations!} ✨\n`)
    printTable(authorsSeeking, authorsPkgNames)
    if (argv.open) openDonateLinks(donateLinks)
  } else {
    spinner.info('You don\'t depend on any packages from maintainers seeking donations')
  }

  // TODO: compute list of **projects** seeking donations
  // TODO: show direct dependencies first in the list
  // console.log(readLocalDeps())
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

function printTable (authorsSeeking, authorsPkgNames) {
  const rows = authorsSeeking
    .map(author => {
      const authorPkgs = authorsPkgNames[author]
      const donateLink = thanks.authors[author].replace(RE_REMOVE_URL_PREFIX, '')
      return [
        chalk.green(author),
        chalk.cyan(donateLink),
        listWithMaxLen(authorPkgs, termSize().columns - 45)
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

function computeAuthorsPkgNames (pkgs, downloadCounts) {
  // author name -> array of package names
  const authorPkgs = {}

  pkgs.forEach(pkg => {
    pkg.maintainers
      .map(maintainer => maintainer.name)
      .forEach(author => {
        if (authorPkgs[author] == null) authorPkgs[author] = []
        authorPkgs[author].push(pkg.name)
      })
  })

  // Sort each author's package list by download count
  Object.keys(authorPkgs).forEach(author => {
    const pkgs = authorPkgs[author]
    pkgs.sort((pkg1, pkg2) => downloadCounts[pkg2] - downloadCounts[pkg1])
  })

  return authorPkgs
}

function listWithMaxLen (list, maxLen) {
  const ELLIPSIS = chalk` {magenta + XX more}`
  const ELLIPSIS_LENGTH = stripAnsi(ELLIPSIS).length
  let str = ''
  for (let i = 0; i < list.length; i++) {
    const item = (i === 0 ? '' : ', ') + list[i]
    if (stripAnsi(str).length + item.length >= maxLen - ELLIPSIS_LENGTH) {
      str += ELLIPSIS.replace('XX', list.length - i)
      break
    }
    str += item
  }
  return str
}

async function openDonateLinks (donateLinks) {
  console.log(donateLinks)
  const len = donateLinks.length

  const spinner = ora({
    text: chalk`Opening {cyan ${len} donate pages} in your {magenta web browser}...`
  }).start()

  for (let donateLink of donateLinks) {
    await opn(donateLink, { wait: false })
    await setTimeoutAsync(2000)
  }

  spinner.succeed(chalk`Opened {cyan ${len} donate pages} in your {magenta web browser}`)
}
