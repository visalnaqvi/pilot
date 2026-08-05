import branding, { type BrandingDefinition } from '@/config/branding'

export type BrandConfig = {
  name: string
  shortName: string
  logoUrl?: string
  logoAlt: string
  primaryColor: string
  accentColor: string
  tagline: string
  description: string
}

const DEFAULT_BRAND = {
  name: 'MockPilot',
  shortName: 'MOCKPILOT',
  primaryColor: '#4f46e5',
  accentColor: '#7c3aed',
  tagline: 'Practice with purpose.',
  description: 'Create and take practice mock tests.',
} as const

const paletteSteps = {
  50: { target: '#ffffff', amount: 0.94 },
  100: { target: '#ffffff', amount: 0.88 },
  200: { target: '#ffffff', amount: 0.74 },
  300: { target: '#ffffff', amount: 0.55 },
  400: { target: '#ffffff', amount: 0.3 },
  500: { target: '#ffffff', amount: 0.1 },
  600: { target: '#ffffff', amount: 0 },
  700: { target: '#000000', amount: 0.16 },
  800: { target: '#000000', amount: 0.3 },
  900: { target: '#000000', amount: 0.43 },
  950: { target: '#000000', amount: 0.58 },
} as const

function valueOrDefault(value: string | undefined, fallback: string) {
  return value?.trim() || fallback
}

export function normalizeLogoUrl(value: string | undefined) {
  const candidate = value?.trim().replaceAll('\\', '/')
  if (!candidate) return undefined
  if (/^https?:\/\//i.test(candidate) || candidate.startsWith('//')) return candidate

  const path = candidate.replace(/^\/+/, '').replace(/^public\//i, '')
  return path ? `/${path}` : undefined
}

export function normalizeHexColor(value: string | undefined, fallback: string) {
  const candidate = value?.trim()
  if (!candidate) return fallback
  if (/^#[0-9a-f]{6}$/i.test(candidate)) return candidate.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(candidate)) {
    return `#${candidate.slice(1).split('').map(character => character.repeat(2)).join('')}`.toLowerCase()
  }
  return fallback
}

function mixHex(color: string, target: string, amount: number) {
  const channel = (hex: string, offset: number) => Number.parseInt(hex.slice(offset, offset + 2), 16)
  const mixed = [1, 3, 5].map(offset => Math.round(
    channel(color, offset) * (1 - amount) + channel(target, offset) * amount,
  ))
  return `#${mixed.map(value => value.toString(16).padStart(2, '0')).join('')}`
}

export function createBrandPalette(color: string) {
  return Object.fromEntries(Object.entries(paletteSteps).map(([shade, step]) => (
    [shade, mixHex(color, step.target, step.amount)]
  ))) as Record<keyof typeof paletteSteps, string>
}

export function resolveBrandConfig(definition: BrandingDefinition): BrandConfig {
  const name = valueOrDefault(definition.name, DEFAULT_BRAND.name)
  return {
    name,
    shortName: valueOrDefault(definition.shortName, name.toUpperCase()),
    logoUrl: normalizeLogoUrl(definition.logoUrl),
    logoAlt: valueOrDefault(definition.logoAlt, `${name} logo`),
    primaryColor: normalizeHexColor(definition.primaryColor, DEFAULT_BRAND.primaryColor),
    accentColor: normalizeHexColor(definition.accentColor, DEFAULT_BRAND.accentColor),
    tagline: valueOrDefault(definition.tagline, DEFAULT_BRAND.tagline),
    description: valueOrDefault(definition.description, DEFAULT_BRAND.description),
  }
}

export function getBrandConfig() {
  return resolveBrandConfig(branding)
}

export function getBrandCssVariables(brand: BrandConfig) {
  const primary = createBrandPalette(brand.primaryColor)
  const accent = createBrandPalette(brand.accentColor)
  const variables: Record<`--${string}`, string> = {
    '--brand-primary': brand.primaryColor,
    '--brand-accent': brand.accentColor,
  }

  for (const [shade, color] of Object.entries(primary)) variables[`--color-indigo-${shade}`] = color
  for (const [shade, color] of Object.entries(accent)) variables[`--color-violet-${shade}`] = color
  return variables
}
