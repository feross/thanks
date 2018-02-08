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
const { promisify } = require('util')

const thanks = require('./')

const readPackageTreeAsync = pify(readPackageTree)
const setTimeoutAsync = promisify(setTimeout)

const DOWNLOADS_URL = 'https://api.npmjs.org/downloads/point/last-month/'
const DOWNLOADS_URL_LIMIT = 128

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

  // Get all packages in the nearest `node_modules` folder
  spinner.text = chalk`Reading {cyan dependencies} from package tree in {magenta node_modules}...`
  const rootPath = await pkgDir(cwd)
  const packageTree = await readPackageTreeAsync(rootPath)

  // Get latest registry data on each local package, since the local data does
  // not include the list of maintainers
  spinner.text = chalk`Fetching package {cyan maintainers} from {red npm}...`
  const pkgNames = packageTree.children.map(node => node.package.name)
  const allPkgs = await Promise.all(pkgNames.map(fetchPkg))

  // Fetch download counts for each package
  spinner.text = chalk`Fetching package {cyan download counts} from {red npm}...`
  const downloadCounts = await bulkFetchDownloads(pkgNames)

  // Author name -> list of packages, ordered by download count
  const authorInfos = computeAuthorInfos(allPkgs, downloadCounts)

  // TODO: compute list of **projects** seeking donations
  // TODO: show direct dependencies first in the list

  const donateLinks = []

  const rows = Object.keys(authorInfos)
    .filter(author => thanks.authors[author] != null)
    .sort((author1, author2) => authorInfos[author2].length - authorInfos[author1].length)
    .map(author => {
      const authorPkgs = authorInfos[author]
      const donateLink = thanks.authors[author]
      donateLinks.push(donateLink)
      const prettyDonateLink = donateLink.replace(/https?:\/\/(www\.)?/, '')
      return [
        chalk.green(author),
        chalk.cyan(prettyDonateLink),
        listWithMaxLen(authorPkgs, termSize().columns - 45)
      ]
    })

  rows.unshift([
    chalk.underline('Author'),
    chalk.underline('Where to Donate'),
    chalk.underline('Dependencies')
  ])

  if (rows.length) {
    spinner.succeed(chalk`You depend on {cyan ${rows.length} authors} who are {magenta seeking donations!} ✨\n`)
    printTable(rows)
    if (argv.open) openDonateLinks()
  } else {
    spinner.succeed('You don\'t depend on any packages from maintainers seeking donations')
  }

  async function openDonateLinks () {
    const spinner = ora({
      spinner: 'hearts',
      text: chalk`Opening {cyan donate pages} in your {magenta web browser}...`
    }).start()

    await setTimeoutAsync(1000)

    for (let donateLink of donateLinks) {
      await opn(donateLink, { wait: false })
    }
    spinner.succeed()
  }

  function printTable (rows) {
    const tableOpts = {
      stringLength: str => stripAnsi(str).length
    }
    const table = textTable(rows, tableOpts)
    console.log(table + '\n')
  }

  async function fetchPkg (pkgName) {
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

function computeAuthorInfos (pkgs, downloadCounts) {
  // author name -> array of package names
  const authorInfos = {}

  pkgs.forEach(pkg => {
    pkg.maintainers
      .map(maintainer => maintainer.name)
      .forEach(author => {
        if (authorInfos[author] == null) authorInfos[author] = []
        authorInfos[author].push(pkg.name)
      })
  })

  // Sort each author's package list by download count
  Object.keys(authorInfos).forEach(author => {
    const pkgs = authorInfos[author]
    pkgs.sort((pkg1, pkg2) => downloadCounts[pkg2] - downloadCounts[pkg1])
  })

  return authorInfos
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
