import type { BrandConfig } from './branding'

export type EmailSenderEnvironment = {
  EMAIL_FROM_ADDRESS?: string
  EMAIL_FROM_NAME?: string
}

export function resolveEmailSender(
  brand: BrandConfig,
  environment: EmailSenderEnvironment = {
    EMAIL_FROM_ADDRESS: process.env.EMAIL_FROM_ADDRESS,
    EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME,
  },
) {
  return {
    address: brand.email?.fromAddress?.trim() || environment.EMAIL_FROM_ADDRESS?.trim() || '',
    name: brand.email?.fromName?.trim() || environment.EMAIL_FROM_NAME?.trim() || brand.name,
  }
}
