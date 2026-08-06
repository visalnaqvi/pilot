export type BrandingDefinition = {
  name?: string
  shortName?: string
  logoUrl?: string
  logoAlt?: string
  primaryColor?: string
  secondaryColor?: string
  accentColor?: string
  tagline?: string
  description?: string
  email?: {
    fromAddress?: string
    fromName?: string
    logoUrl?: string
  }
}

export type ClientBrandingDefinition = BrandingDefinition & {
  hostnames: readonly string[]
}

/**
 * Shared white-label configuration selected from the request hostname.
 *
 * A file stored at `public/client-name/logo.svg` is served by Next.js at
 * `/client-name/logo.svg`, so that root-relative URL is the recommended value.
 * Absolute HTTP(S) logo URLs are supported too.
 */
export const DEFAULT_CLIENT_ID = 'mockpilot'

export const brandingByClient = {
  mockpilot: {
    hostnames: ['localhost', '127.0.0.1'],
    name: 'MockPilot',
    shortName: 'MOCKPILOT',
    logoUrl: '',
    logoAlt: 'MockPilot logo',
    primaryColor: '#4f46e5',
    accentColor: '#7c3aed',
    tagline: 'Practice with purpose.',
    description: 'Create and take practice mock tests.',
    email: {
      // Set a SendGrid-verified client address here. EMAIL_FROM_ADDRESS is the fallback.
      fromAddress: '',
      fromName: 'MockPilot',
    },
  },
  'aggarwal-education': {
    hostnames: ['pilot.aggarwaleducationcenter.com'],
    name: 'Aggarwal Education Center',
    shortName: 'AEC',
    logoUrl: '/aggarwaleducation/Aggarwal-Education-Center-Logo.png',
    logoAlt: 'Aggarwal Education Center logo',
    primaryColor: '#055527',
    secondaryColor: '#e9f5e9',
    accentColor: '#055527',
    tagline: 'Practice with purpose.',
    description: 'Create and take practice mock tests with Aggarwal Education Center.',
    email: {
      fromName: 'Aggarwal Education Center',
      // Email clients need a public, absolute URL and may cache failed image
      // requests. Keep this versioned when the asset changes.
      logoUrl: 'https://pilot.aggarwaleducationcenter.com/aggarwaleducation/Aggarwal-Education-Center-Logo.png?v=20260806',
    },
  },
} satisfies Record<string, ClientBrandingDefinition>

