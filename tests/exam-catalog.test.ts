import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cleanAliases,
  normalizeExamKey,
  prepareExamCatalogProposal,
} from '../lib/exam-catalog'

test('exam names normalize punctuation, spacing, accents, and case', () => {
  assert.equal(normalizeExamKey('  JÉE—Main (2026)  '), 'jee main 2026')
  assert.equal(normalizeExamKey('NEET   UG'), 'neet ug')
})

test('exam aliases are normalized and de-duplicated against the canonical name', () => {
  assert.deepEqual(
    cleanAliases('Joint Entrance Examination Main', [
      'JEE Main',
      'jee-main',
      'Joint Entrance Examination Main',
      'JEE Mains',
    ]),
    ['JEE Main', 'JEE Mains'],
  )
})

test('AI exam suggestions expand acronyms into a catalog-ready proposal', () => {
  assert.deepEqual(
    prepareExamCatalogProposal('ctet', {
      recognized: true,
      canonicalName: 'Central Teacher Eligibility Test',
      primaryAlias: 'CTET',
      aliases: ['C.T.E.T.', 'Central Teacher Eligibility Test', 'ctet'],
    }),
    {
      name: 'Central Teacher Eligibility Test',
      primaryAlias: 'CTET',
      aliases: ['CTET', 'C.T.E.T.'],
    },
  )
})

test('unrecognized exam searches preserve the user input', () => {
  assert.deepEqual(
    prepareExamCatalogProposal('Custom Institute Exam', {
      recognized: false,
      canonicalName: 'Ignored model guess',
      primaryAlias: 'Ignored',
      aliases: ['Ignored alias'],
    }),
    {
      name: 'Custom Institute Exam',
      primaryAlias: 'Custom Institute Exam',
      aliases: [],
    },
  )
})
