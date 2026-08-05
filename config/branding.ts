export type BrandingDefinition = {
  name?: string
  shortName?: string
  logoUrl?: string
  logoAlt?: string
  primaryColor?: string
  accentColor?: string
  tagline?: string
  description?: string
}

/**
 * Branch-owned white-label configuration.
 *
 * A file stored at `public/client-name/logo.svg` is served by Next.js at
 * `/client-name/logo.svg`, so that root-relative URL is the recommended value.
 * Absolute HTTP(S) logo URLs are supported too.
 */
const branding = {
  name: 'MockPilot',
  shortName: 'MOCKPILOT',
  logoUrl: '',
  logoAlt: 'MockPilot logo',
  primaryColor: '#4f46e5',
  accentColor: '#7c3aed',
  tagline: 'Practice with purpose.',
  description: 'Create and take practice mock tests.',
} satisfies BrandingDefinition

export default branding

