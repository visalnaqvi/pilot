import assert from 'node:assert/strict'
import test from 'node:test'
import { clientIdForHostname, createBrandPalette, getBrandConfig, getBrandCssVariables, normalizeHexColor, normalizeHostname, normalizeLogoUrl, resolveBrandConfig } from '../lib/branding'

test('branding reads the MockPilot configuration for local development', () => {
  const brand = getBrandConfig('localhost:3000')
  assert.equal(brand.name, 'MockPilot')
  assert.equal(brand.shortName, 'MOCKPILOT')
  assert.equal(brand.primaryColor, '#4f46e5')
  assert.equal(brand.secondaryColor, '#f4f4fd')
  assert.equal(brand.accentColor, '#7c3aed')
  assert.equal(brand.logoUrl, undefined)
  assert.deepEqual(brand.email, { fromName: 'MockPilot' })
})

test('branding selects Aggarwal Education Center from its deployment hostname', () => {
  const brand = getBrandConfig('pilot.aggarwaleducationcenter.com:443')
  assert.equal(clientIdForHostname('PILOT.AGGARWALEDUCATIONCENTER.COM.'), 'aggarwal-education')
  assert.equal(brand.name, 'Aggarwal Education Center')
  assert.equal(brand.logoUrl, '/aggarwaleducation/Aggarwal-Education-Center-Logo.png')
  assert.equal(
    brand.email?.logoUrl,
    'https://pilot.aggarwaleducationcenter.com/aggarwaleducation/Aggarwal-Education-Center-Logo.png?v=20260806',
  )
  assert.equal(brand.primaryColor, '#055527')
  assert.equal(brand.secondaryColor, '#e9f5e9')
  assert.equal(brand.accentColor, '#055527')
})

test('branding safely falls back to MockPilot for an unknown hostname', () => {
  assert.equal(getBrandConfig('preview.example.com').name, 'MockPilot')
  assert.equal(normalizeHostname('https://PILOT.AGGARWALEDUCATIONCENTER.COM.:443/path'), 'pilot.aggarwaleducationcenter.com')
})

test('local development can override hostname-based branding', () => {
  const brand = getBrandConfig('localhost:3000', {
    NODE_ENV: 'development',
    LOCAL_BRAND_CLIENT_ID: 'aggarwal-education',
  })
  assert.equal(brand.name, 'Aggarwal Education Center')
})

test('production ignores the local branding override', () => {
  const brand = getBrandConfig('localhost:3000', {
    NODE_ENV: 'production',
    LOCAL_BRAND_CLIENT_ID: 'aggarwal-education',
  })
  assert.equal(brand.name, 'MockPilot')
})

test('an invalid local branding override fails with available client ids', () => {
  assert.throws(
    () => getBrandConfig('localhost:3000', {
      NODE_ENV: 'development',
      LOCAL_BRAND_CLIENT_ID: 'missing-client',
    }),
    /Unknown LOCAL_BRAND_CLIENT_ID "missing-client"\. Expected one of: mockpilot, aggarwal-education\./,
  )
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
    secondaryColor: '#f0f8f6',
    accentColor: '#ea580c',
    tagline: 'Learn with confidence.',
    description: 'Create and take practice mock tests.',
  })
})

test('branding trims branch-owned email sender settings', () => {
  const brand = resolveBrandConfig({
    name: 'Example Academy',
    email: {
      fromAddress: ' accounts@example.edu ',
      fromName: ' Example Accounts ',
    },
  })
  assert.deepEqual(brand.email, {
    fromAddress: 'accounts@example.edu',
    fromName: 'Example Accounts',
  })
})

test('branding normalizes an email-specific logo URL', () => {
  const brand = resolveBrandConfig({
    email: { logoUrl: ' https://assets.example.edu/email-logo.png?v=2 ' },
  })

  assert.equal(brand.email?.logoUrl, 'https://assets.example.edu/email-logo.png?v=2')
})

test('branding creates complete primary and accent shade variables', () => {
  const brand = resolveBrandConfig({ primaryColor: '#0f766e', accentColor: '#ea580c' })
  const variables = getBrandCssVariables(brand)
  const primary = createBrandPalette('#0f766e')

  assert.equal(variables['--brand-primary'], '#0f766e')
  assert.equal(variables['--color-indigo-50'], primary[50])
  assert.equal(variables['--color-indigo-600'], '#0f766e')
  assert.equal(variables['--color-violet-600'], '#ea580c')
  assert.equal(Object.keys(variables).length, 25)
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
