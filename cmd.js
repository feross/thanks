#!/usr/bin/env node

const chalk = require('chalk')
const minimist = require('minimist')
const pify = require('pify')
const pkgDir = require('pkg-dir')
const readPackageTree = require('read-package-tree')
const RegistryClient = require('npm-registry-client') // TODO: use npm-registry-fetch
const registryUrl = require('registry-url')
const registryAuthToken = require('registry-auth-token')
const stripAnsi = require('strip-ansi')
const textTable = require('text-table')

const donees = require('./')

const readPackageTreeAsync = pify(readPackageTree)

init().catch(handleError)

async function init () {
  const argv = minimist(process.argv.slice(2))

  const cwd = argv._[0] || process.cwd()

  const authors = {}
  const client = createRegistryClient()

  // Get all packages in the nearest `node_modules` folder
  const rootPath = await pkgDir(cwd)
  const packageTree = await readPackageTreeAsync(rootPath)
  const pkgNames = packageTree.children.map(node => node.package.name)

  // Get latest registry data on each local package, since the local data does
  // not include the list of maintainers
  const pkgs = await Promise.all(pkgNames.map(fetchPkg))

  pkgs.forEach(pkg => {
    pkg.maintainers
      .map(maintainer => maintainer.name)
      .forEach(author => addPackageAuthor(pkg.name, author))
  })

  const rows = Object.keys(authors)
    .filter(author => donees.authors[author] != null)
    .sort((author1, author2) => authors[author2].length - authors[author1].length)
    .map(author => {
      const deps = authors[author]
      return [
        chalk.green(author),
        donees.authors[author],
        `${deps.length} packages including ${deps.slice(0, 3).join(', ')}`
      ]
    })

  rows.unshift([
    chalk.underline('Author'),
    chalk.underline('Where to Donate'),
    chalk.underline('Dependencies')
  ])

  const tableOpts = {
    // align: ['l', 'l', 'l'],
    stringLength: str => stripAnsi(str).length
  }

  const table = textTable(rows, tableOpts)
  console.log(table)

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

  async function fetchPkg (pkgName) {
    // The registry does not support fetching versions for scoped packages
    const isScopedPackage = pkgName.includes('/')
    const url = isScopedPackage
      ? `${registryUrl()}${pkgName.replace('/', '%2F')}`
      : `${registryUrl()}${pkgName}/latest`

    const opts = {
      timeout: 30 * 1000,
      staleOk: true,
      auth: registryAuthToken()
    }
    return client.getAsync(url, opts)
  }

  function addPackageAuthor (pkgName, author) {
    if (authors[author] == null) authors[author] = []
    authors[author].push(pkgName)
  }

  // const rootPkg = await fetchLocalPkg()

  // const rootDeps = [].concat(
  //   findDeps(rootPkg, 'dependencies'),
  //   findDeps(rootPkg, 'devDependencies'),
  //   findDeps(rootPkg, 'optionalDependencies')
  // )

  // const queue = [].push(...rootDeps)

  // while (queue.length > 0) {
  //   const pkgs = await Promise.all(queue.slice(0, CONCURRENCY).map(fetchPkg))
  // }
}

// async function fetchLocalPkg () {
//   const pkgPath = await pkgUp()
//   const pkgStr = await readFileAsync(pkgPath, 'utf8')

//   try {
//     const pkg = JSON.parse(pkgStr)
//     normalizePackage(pkg)
//     return pkg
//   } catch (err) {
//     err.message = `Failed to parse package.json: ${err.message}`
//     throw err
//   }
// }

// function findDeps (pkg, type) {
//   return pkg[type] && typeof pkg[type] === 'object'
//     ? Object.keys(pkg[type])
//     : []
// }

function handleError (err) {
  console.error(`thanks: Error: ${err.message}`)
  console.error(err.stack)
  process.exitCode = 1
}
