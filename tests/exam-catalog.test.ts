import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cleanAliases,
  EXAM_CATALOG_NAMING_INSTRUCTION,
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

test('descriptive exam searches use a catalog-ready name instead of the raw query', () => {
  assert.deepEqual(
    prepareExamCatalogProposal('12th standard final board exam', {
      recognized: false,
      canonicalName: 'Class 12 Board Examination',
      primaryAlias: 'Class 12 Boards',
      aliases: ['12th Board Exam'],
    }),
    {
      name: 'Class 12 Board Examination',
      primaryAlias: 'Class 12 Boards',
      aliases: ['Class 12 Boards', '12th Board Exam', '12th standard final board exam'],
    },
  )
  assert.match(EXAM_CATALOG_NAMING_INSTRUCTION, /should become "Class 12 Board Examination"/i)
  assert.match(EXAM_CATALOG_NAMING_INSTRUCTION, /Do not merely copy or title-case/i)
})
