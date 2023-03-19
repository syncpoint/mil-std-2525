#!/usr/bin/env node
const path = require('path')
const fs = require('fs')
const R = require('ramda')
const tables = require('./tables')

const assign = Object.assign
const entries = Object.entries
const fromEntries = Object.fromEntries
const split = delimiter => s => s.split(delimiter)
const splitCRLF = split(/\r?\n/)
const splitTAB = split(/\t/)
const props = R.curry((ix, xs) => ix.map(i => xs[i]).join(''))

// mapWP :: (x[n] => x[n-1] => x[n]) => x
const mapWP = fn => {
  let previous
  return x => {
    fn(x, previous)
    previous = x
    return x
  }
}

// If empty, use entity and entity type from previous entry.
const fillgaps = ix => mapWP((x, p) => { 
  p && ix.forEach(i => (x[i] = x[i] || p[i]))
  return x 
})

// Add point geometry column if necessary.
const geometry = R.curry((n, i, xs) => 
  xs.length === n
    ? (xs.splice(i, 0, 'point'), xs)
    : xs
)

const legacy = ({ standard }) => xs => [
  `symbol:${props([2, 3, 4, 5, 6], xs)}*****+${standard}`, 
  { 
    hierarchy: xs[1].trim(), 
    name: xs[7], 
    geometry: xs[0].toLowerCase(), 
    remarks: xs[8] 
  }
]

const current = ({ standard, symbolset }) => xs => [
  `symbol:100*${symbolset}*000${props([4], xs)}0000+${standard}`,
  { 
    entity: xs[0], 
    type: xs[1], 
    subtype: xs[2], 
    geometry: xs[3].toLowerCase(), 
    remarks: xs[5] 
  }
]

const modifier = ({ standard, symbolset, sector }) => xs => [
  `modifier:${symbolset}/${sector}/${xs[2]}+${standard}`,
  { 
    modifier: xs[0], 
    category: xs[1] 
  }
]

const isLegacy = ({ standard }) => ['2525+b', '2525+c'].includes(standard)

const collect = R.cond([
  [R.prop('sector'), modifier],
  [isLegacy, legacy],
  [R.T, current]
])

// Remove falsy value properties.
const purge = (([k, v]) => [k, fromEntries(entries(v).filter(([, v]) => v))])

const entry = context => R.compose(
  purge,
  collect(context),
  isLegacy(context) ? geometry(8, 0) : geometry(5, 3),
  isLegacy(context) ? R.identity : fillgaps([0, 1]) // entity, entity type
)

// Filter unwanted sector modifier entries:
const whitelist = xs => {
  const regex = /(Version Extension Flag)|({Reserved for future use})/
  return !(regex.test(xs[0]))
}

const parse = context => R.compose(
  fromEntries,
  R.map(entry(context)),
  R.filter(whitelist),
  R.map(splitTAB),
  R.filter(xs => xs.length !== 0), // drop empty lines
  R.drop(1), // drop column headers
  splitCRLF,
  filename => fs.readFileSync(filename, 'utf8')
)(context.filename)

const resolve = filename => path.join(__dirname, '../tsv-tables', filename)

const json = tables
  .map(({ filename, ...context }) => ({ ...context, filename: resolve(filename) }))
  .flatMap(parse)
  .reduce((a, b) => assign(a, b), {})

console.log(JSON.stringify(json, null, 2))
