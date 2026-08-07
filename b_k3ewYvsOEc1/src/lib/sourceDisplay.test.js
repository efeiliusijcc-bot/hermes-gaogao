import assert from 'node:assert/strict'
import test from 'node:test'
import { hasDistinctSourceDetail } from './sourceDisplay.js'

test('returns false when detail is identical to summary', () => {
  assert.equal(hasDistinctSourceDetail('来源：新华社', '来源：新华社'), false)
})

test('returns false when detail differs from summary only by whitespace', () => {
  assert.equal(hasDistinctSourceDetail('  来源：新华社  ', '来源：新华社'), false)
  assert.equal(hasDistinctSourceDetail('a  b', 'a b'), false)
  assert.equal(hasDistinctSourceDetail('a\tb', 'a\n b'), false)
})

test('returns true when detail differs from summary in content', () => {
  assert.equal(hasDistinctSourceDetail('来源：新华社', '来源：人民日报'), true)
})

test('returns false when detail is empty', () => {
  assert.equal(hasDistinctSourceDetail('来源：新华社', ''), false)
  assert.equal(hasDistinctSourceDetail('来源：新华社', '   '), false)
  assert.equal(hasDistinctSourceDetail('来源：新华社', undefined), false)
  assert.equal(hasDistinctSourceDetail('来源：新华社', null), false)
})

test('returns true when summary is empty but detail has content', () => {
  assert.equal(hasDistinctSourceDetail('', '来源：新华社'), true)
  assert.equal(hasDistinctSourceDetail('   ', '来源：新华社'), true)
})
