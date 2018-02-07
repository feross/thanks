#!/usr/bin/env node

const chalk = require('chalk')
const got = require('got') // TODO: use simple-peer when it supports promises
const minimist = require('minimist')
const pify = require('pify')
const pkgDir = require('pkg-dir')
const readPackageTree = require('read-package-tree')
const RegistryClient = require('npm-registry-client') // TODO: use npm-registry-fetch when done
const registryUrl = require('registry-url')
const stripAnsi = require('strip-ansi')
const textTable = require('text-table')

const thanks = require('./')

const DOWNLOADS_URL = 'https://api.npmjs.org/downloads/point/last-month/'
const DOWNLOADS_URL_LIMIT = 128

const readPackageTreeAsync = pify(readPackageTree)

init().catch(handleError)

async function init () {
  const client = createRegistryClient()

  const argv = minimist(process.argv.slice(2))
  const cwd = argv._[0] || process.cwd()

  // Get all packages in the nearest `node_modules` folder
  const rootPath = await pkgDir(cwd)
  const packageTree = await readPackageTreeAsync(rootPath)

  // Get latest registry data on each local package, since the local data does
  // not include the list of maintainers
  const pkgNames = packageTree.children.map(node => node.package.name)
  const allPkgs = await Promise.all(pkgNames.map(fetchPkg))

  // Fetch download counts for each package
  const downloadCounts = await bulkFetchDownloads(pkgNames)

  const authorInfos = computeAuthorInfos(allPkgs, downloadCounts)

  const rows = Object.keys(authorInfos)
    .filter(author => thanks.authors[author] != null)
    .sort((author1, author2) => authorInfos[author2].length - authorInfos[author1].length)
    .map(author => {
      const authorPkgs = authorInfos[author]
      const donateLink = thanks.authors[author]
      return [
        chalk.green(author),
        donateLink,
        `${authorPkgs.length} packages including ${authorPkgs.slice(0, 2).join(', ')}`
      ]
    })

  rows.unshift([
    chalk.underline('Author'),
    chalk.underline('Where to Donate'),
    chalk.underline('Dependencies')
  ])

  const tableOpts = {
    stringLength: str => stripAnsi(str).length
  }

  const table = textTable(rows, tableOpts)
  console.log(table)

  async function fetchPkg (pkgName) {
    // The registry does not support fetching versions for scoped packages
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

/**
 * A few notes:
 *   - bulk queries do not support scoped packages
 *   - bulk queries are limited to at most 128 packages at a time
 */
async function bulkFetchDownloads (pkgNames) {
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

function handleError (err) {
  console.error(`thanks: Error: ${err.message}`)
  console.error(err.stack)
  process.exitCode = 1
}
