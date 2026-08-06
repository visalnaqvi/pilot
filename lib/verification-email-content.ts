import type { BrandConfig } from './branding'
import { escapeHtml } from './task-email-content'

export type VerificationEmailTemplateInput = {
  brand: BrandConfig
  recipientName?: string
  verificationUrl: string
  appUrl: string
}

function absoluteLogoUrl(logoUrl: string | undefined, appUrl: string) {
  if (!logoUrl) return undefined
  return new URL(logoUrl, `${appUrl.replace(/\/+$/, '')}/`).toString()
}

export function buildVerificationEmail(input: VerificationEmailTemplateInput) {
  const name = input.recipientName?.trim() || 'there'
  const logoUrl = absoluteLogoUrl(input.brand.logoUrl, input.appUrl)
  const subject = `Verify your email for ${input.brand.name}`
  const text = [
    `Hi ${name},`,
    '',
    `Confirm your email address to finish creating your ${input.brand.name} account.`,
    '',
    `Verify your email: ${input.verificationUrl}`,
    '',
    'If this verification link has expired, return to the app and request a new email.',
    `If you did not create a ${input.brand.name} account, you can ignore this message.`,
  ].join('\n')

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;background:#f8fafc">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;border:1px solid #e2e8f0;border-radius:16px;background:#ffffff">
          <tr><td style="padding:32px">
            ${logoUrl
              ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(input.brand.logoAlt)}" style="display:block;max-height:56px;max-width:220px;margin:0 0 24px" />`
              : `<p style="margin:0 0 24px;color:${input.brand.primaryColor};font-size:14px;font-weight:700;letter-spacing:.08em">${escapeHtml(input.brand.shortName)}</p>`}
            <h1 style="margin:0 0 20px;font-size:26px;line-height:1.3">Verify your email address</h1>
            <p style="margin:0 0 14px;line-height:1.6">Hi ${escapeHtml(name)},</p>
            <p style="margin:0 0 24px;line-height:1.6">Confirm your email address to finish creating your ${escapeHtml(input.brand.name)} account.</p>
            <a href="${escapeHtml(input.verificationUrl)}" style="display:inline-block;border-radius:10px;background:${input.brand.primaryColor};padding:13px 20px;color:#ffffff;text-decoration:none;font-weight:700">Verify email address</a>
            <p style="margin:24px 0 8px;line-height:1.6;color:#64748b;font-size:13px">If the button does not work, copy and paste this link into your browser:</p>
            <p style="margin:0;line-height:1.5;word-break:break-all;font-size:13px"><a href="${escapeHtml(input.verificationUrl)}" style="color:${input.brand.primaryColor}">${escapeHtml(input.verificationUrl)}</a></p>
            <p style="margin:24px 0 0;line-height:1.6;color:#64748b;font-size:13px">If this link has expired, return to the app and request a new email. If you did not create this account, you can ignore this message.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`

  return { subject, text, html }
}
