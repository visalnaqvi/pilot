import type { BrandConfig } from './branding'
import { escapeHtml } from './task-email-content'

export type AttendanceAbsenceEmailInput = {
  brand: BrandConfig
  appUrl: string
  recipientName?: string
  organisationName: string
  subject: string
  classDate: string
  startTime?: string
  endTime?: string
  actionUrl: string
}

function absoluteLogoUrl(logoUrl: string | undefined, appUrl: string) {
  if (!logoUrl) return undefined
  return new URL(logoUrl, `${appUrl.replace(/\/+$/, '')}/`).toString()
}

function formattedClassDate(localDate: string) {
  return new Date(`${localDate}T00:00:00.000Z`).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function buildAttendanceAbsenceEmail(input: AttendanceAbsenceEmailInput) {
  const name = input.recipientName?.trim() || 'Student'
  const classDate = formattedClassDate(input.classDate)
  const className = input.subject.replace(/[\r\n]+/g, ' ').trim() || 'Class'
  const schedule = input.startTime && input.endTime
    ? `${input.startTime}–${input.endTime}`
    : input.startTime || input.endTime || ''
  const logoUrl = absoluteLogoUrl(input.brand.email?.logoUrl || input.brand.logoUrl, input.appUrl)
  const subject = `Attendance notice: absent from ${className}`
  const text = [
    `Hi ${name},`,
    '',
    `Your attendance was recorded as absent for ${className} on ${classDate}.`,
    schedule ? `Class time: ${schedule}` : '',
    `Institute: ${input.organisationName}`,
    '',
    'If you believe this was recorded incorrectly, please contact your institute.',
    `View attendance: ${input.actionUrl}`,
  ].filter(Boolean).join('\n')

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
            <h1 style="margin:0 0 20px;font-size:26px;line-height:1.3">Attendance marked absent</h1>
            <p style="margin:0 0 14px;line-height:1.6">Hi ${escapeHtml(name)},</p>
            <p style="margin:0 0 20px;line-height:1.6">Your attendance was recorded as absent for <strong>${escapeHtml(className)}</strong>.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 22px;border-radius:12px;background:#f8fafc">
              <tr><td style="padding:18px">
                <p style="margin:0 0 8px;line-height:1.5"><strong>Date:</strong> ${escapeHtml(classDate)}</p>
                ${schedule ? `<p style="margin:0 0 8px;line-height:1.5"><strong>Class time:</strong> ${escapeHtml(schedule)}</p>` : ''}
                <p style="margin:0;line-height:1.5"><strong>Institute:</strong> ${escapeHtml(input.organisationName)}</p>
              </td></tr>
            </table>
            <p style="margin:0 0 22px;line-height:1.6;color:#475569">If you believe this was recorded incorrectly, please contact your institute.</p>
            <a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;border-radius:10px;background:${input.brand.primaryColor};padding:13px 20px;color:#ffffff;text-decoration:none;font-weight:700">View attendance</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`

  return { subject, text, html }
}
