import 'server-only'
import { getBrandConfig, type BrandConfig } from './branding'
import { resolveEmailSender } from './email-sender'

export type EmailAddress = string
export type EmailContent = {
  to: EmailAddress
  subject: string
  text: string
  html?: string
  metadata?: Record<string, string>
  brand?: BrandConfig
}

export function isEmailConfigured(brand: BrandConfig = getBrandConfig()) {
  return Boolean(process.env.SENDGRID_API_KEY && resolveEmailSender(brand).address)
}

export async function sendEmail({ to, subject, text, html, metadata, brand }: EmailContent) {
  const apiKey = process.env.SENDGRID_API_KEY
  const sender = resolveEmailSender(brand || getBrandConfig())

  if (!apiKey) {
    throw new Error('SendGrid is not configured. Set SENDGRID_API_KEY in your environment.')
  }
  if (!sender.address) {
    throw new Error('The sending email address is not configured. Set branding.email.fromAddress or EMAIL_FROM_ADDRESS.')
  }

  const recipient = to.trim()
  if (!recipient) {
    throw new Error('No valid email recipients were provided.')
  }

  const requestBody = {
    personalizations: [{
      to: [{ email: recipient }],
      ...(metadata && Object.keys(metadata).length ? { custom_args: metadata } : {}),
    }],
    from: { email: sender.address, name: sender.name },
    subject: subject.trim(),
    content: [
      { type: 'text/plain', value: text },
      ...(html ? [{ type: 'text/html', value: html }] : []),
    ],
  }

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`SendGrid email failed: ${response.status} ${response.statusText} ${body.slice(0, 500)}`)
  }

  return { providerMessageId: response.headers.get('x-message-id') || undefined }
}
