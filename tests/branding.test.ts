import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createBrandPalette, getBrandConfig, getBrandCssVariables, normalizeHexColor, normalizeLogoUrl, resolveBrandConfig } from '../lib/branding'

test('branding reads a valid branch-owned configuration and local logo', () => {
  const brand = getBrandConfig()
  assert.ok(brand.name)
  assert.ok(brand.shortName)
  assert.match(brand.primaryColor, /^#[0-9a-f]{6}$/)
  assert.match(brand.secondaryColor, /^#[0-9a-f]{6}$/)
  if (brand.logoUrl?.startsWith('/')) {
    assert.equal(existsSync(path.join(process.cwd(), 'public', brand.logoUrl)), true)
  }
})

test('branding accepts a client identity and normalizes its colors', () => {
  const brand = resolveBrandConfig({
    name: 'Example Academy',
    shortName: 'EA',
    logoUrl: '/branding/example.svg',
    primaryColor: '#086',
    secondaryColor: '#E9F5E9',
    tagline: 'Learn with confidence.',
  })

  assert.deepEqual(brand, {
    name: 'Example Academy',
    shortName: 'EA',
    logoUrl: '/branding/example.svg',
    logoAlt: 'Example Academy logo',
    primaryColor: '#008866',
    secondaryColor: '#e9f5e9',
    tagline: 'Learn with confidence.',
    description: 'Create and take practice mock tests.',
  })
})

test('branding creates a complete palette anchored by primary and secondary colors', () => {
  const brand = resolveBrandConfig({ primaryColor: '#0f766e', secondaryColor: '#e9f5e9' })
  const variables = getBrandCssVariables(brand)
  const primary = createBrandPalette('#0f766e', '#e9f5e9')

  assert.equal(variables['--brand-primary'], '#0f766e')
  assert.equal(variables['--brand-secondary'], '#e9f5e9')
  assert.equal(variables['--color-indigo-50'], primary[50])
  assert.equal(variables['--color-indigo-600'], '#0f766e')
  assert.equal(variables['--color-violet-600'], '#0f766e')
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
