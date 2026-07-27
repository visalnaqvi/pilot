import 'server-only'

export type EmailAddress = string
export type EmailContent = {
  to: EmailAddress
  subject: string
  text: string
  html?: string
  metadata?: Record<string, string>
}

export function isEmailConfigured() {
  return Boolean(process.env.SENDGRID_API_KEY && process.env.EMAIL_FROM_ADDRESS)
}

export async function sendEmail({ to, subject, text, html, metadata }: EmailContent) {
  const apiKey = process.env.SENDGRID_API_KEY
  const fromAddress = process.env.EMAIL_FROM_ADDRESS
  const fromName = process.env.EMAIL_FROM_NAME || 'Mock Test App'

  if (!apiKey) {
    throw new Error('SendGrid is not configured. Set SENDGRID_API_KEY in your environment.')
  }
  if (!fromAddress || !fromAddress.trim()) {
    throw new Error('The sending email address is not configured. Set EMAIL_FROM_ADDRESS in your environment.')
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
    from: { email: fromAddress.trim(), name: fromName.trim() },
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
