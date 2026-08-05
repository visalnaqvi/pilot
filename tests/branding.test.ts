import assert from 'node:assert/strict'
import test from 'node:test'
import { createBrandPalette, getBrandConfig, getBrandCssVariables, normalizeHexColor, normalizeLogoUrl, resolveBrandConfig } from '../lib/branding'

test('branding reads the branch-owned MockPilot configuration', () => {
  const brand = getBrandConfig()
  assert.equal(brand.name, 'MockPilot')
  assert.equal(brand.shortName, 'MOCKPILOT')
  assert.equal(brand.primaryColor, '#4f46e5')
  assert.equal(brand.accentColor, '#7c3aed')
  assert.equal(brand.logoUrl, undefined)
})

test('branding accepts a client identity and normalizes its colors', () => {
  const brand = resolveBrandConfig({
    name: 'Example Academy',
    shortName: 'EA',
    logoUrl: '/branding/example.svg',
    primaryColor: '#086',
    accentColor: '#EA580C',
    tagline: 'Learn with confidence.',
  })

  assert.deepEqual(brand, {
    name: 'Example Academy',
    shortName: 'EA',
    logoUrl: '/branding/example.svg',
    logoAlt: 'Example Academy logo',
    primaryColor: '#008866',
    accentColor: '#ea580c',
    tagline: 'Learn with confidence.',
    description: 'Create and take practice mock tests.',
  })
})

test('branding creates complete primary and accent shade variables', () => {
  const brand = resolveBrandConfig({ primaryColor: '#0f766e', accentColor: '#ea580c' })
  const variables = getBrandCssVariables(brand)
  const primary = createBrandPalette('#0f766e')

  assert.equal(variables['--brand-primary'], '#0f766e')
  assert.equal(variables['--color-indigo-50'], primary[50])
  assert.equal(variables['--color-indigo-600'], '#0f766e')
  assert.equal(variables['--color-violet-600'], '#ea580c')
  assert.equal(Object.keys(variables).length, 24)
})

test('invalid brand colors safely fall back to the default palette', () => {
  assert.equal(normalizeHexColor('blue', '#4f46e5'), '#4f46e5')
})

test('public client logo paths resolve to their Next.js public URL', () => {
  assert.equal(normalizeLogoUrl('/client-a/logo.svg'), '/client-a/logo.svg')
  assert.equal(normalizeLogoUrl('public/client-a/logo.svg'), '/client-a/logo.svg')
  assert.equal(normalizeLogoUrl('/public/client-a/logo.svg'), '/client-a/logo.svg')
  assert.equal(normalizeLogoUrl('client-a\\logo.svg'), '/client-a/logo.svg')
  assert.equal(normalizeLogoUrl('https://assets.example.com/client-a.svg'), 'https://assets.example.com/client-a.svg')
})
