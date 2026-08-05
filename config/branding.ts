export type BrandingDefinition = {
  name?: string
  shortName?: string
  logoUrl?: string
  logoAlt?: string
  primaryColor?: string
  secondaryColor?: string
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
  name: 'Aggarwal Education Center',
  shortName: 'AEC',
  logoUrl: '/aggarwaleducation/Aggarwal-Education-Center-Logo.png',
  logoAlt: 'Aggarwal Education Center logo',
  primaryColor: '#055527',
  secondaryColor: '#e9f5e9',
  tagline: 'Practice with purpose.',
  description: 'Create and take practice mock tests with Aggarwal Education Center.',
} satisfies BrandingDefinition

export default branding
