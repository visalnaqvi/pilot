import type { BrandConfig } from './branding'
import { escapeHtml } from './task-email-content'

export type AssignmentResultAttempt = {
  attemptNumber: number
  score: number
  totalMarks: number
  gradingStatus: 'not_required' | 'pending' | 'graded'
  submittedAt: Date
}

export type AssignmentResultEmailInput = {
  brand: BrandConfig
  appUrl: string
  recipientName?: string
  organisationName: string
  assignmentName: string
  testTitle: string
  attempts: AssignmentResultAttempt[]
  actionUrl: string
  timeZone: string
}

function absoluteLogoUrl(logoUrl: string | undefined, appUrl: string) {
  if (!logoUrl) return undefined
  return new URL(logoUrl, `${appUrl.replace(/\/+$/, '')}/`).toString()
}

function percentage(attempt: AssignmentResultAttempt) {
  return attempt.totalMarks > 0 ? Math.round(attempt.score / attempt.totalMarks * 100) : 0
}

function formatDate(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(value)
}

export function buildAssignmentResultEmail(input: AssignmentResultEmailInput) {
  const name = input.recipientName?.trim() || 'Student'
  const assignmentName = input.assignmentName.replace(/[\r\n]+/g, ' ').trim() || 'Assignment'
  const testTitle = input.testTitle.replace(/[\r\n]+/g, ' ').trim() || 'Test'
  const attempts = input.attempts.slice().sort((a, b) => a.attemptNumber - b.attemptNumber)
  const hasPendingGrading = attempts.some(attempt => attempt.gradingStatus === 'pending')
  const average = attempts.length
    ? Math.round(attempts.reduce((sum, attempt) => sum + percentage(attempt), 0) / attempts.length)
    : 0
  const logoUrl = absoluteLogoUrl(input.brand.email?.logoUrl || input.brand.logoUrl, input.appUrl)
  const subject = `Your result: ${assignmentName}`
  const textAttempts = attempts.map(attempt => (
    `Attempt ${attempt.attemptNumber}: ${attempt.score}/${attempt.totalMarks} marks (${percentage(attempt)}%)${attempt.gradingStatus === 'pending' ? ' - grading in progress' : ''} - submitted ${formatDate(attempt.submittedAt, input.timeZone)}`
  ))
  const text = [
    `Hi ${name},`,
    '',
    `Here are your results for ${assignmentName}.`,
    `Test: ${testTitle}`,
    `Institute: ${input.organisationName}`,
    '',
    ...textAttempts,
    '',
    `${hasPendingGrading ? 'Current average' : 'Average score'}: ${average}%`,
    hasPendingGrading ? 'One or more attempts are still being graded, so these results may change.' : '',
    `View your submissions: ${input.actionUrl}`,
  ].filter(Boolean).join('\n')

  const rows = attempts.map(attempt => `
    <tr>
      <td style="padding:12px;border-top:1px solid #e2e8f0">Attempt ${attempt.attemptNumber}</td>
      <td style="padding:12px;border-top:1px solid #e2e8f0;font-weight:700">${attempt.score}/${attempt.totalMarks} (${percentage(attempt)}%)</td>
      <td style="padding:12px;border-top:1px solid #e2e8f0;color:#475569">${attempt.gradingStatus === 'pending' ? 'Grading in progress' : 'Complete'}</td>
    </tr>`).join('')

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;background:#f8fafc">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;border:1px solid #e2e8f0;border-radius:16px;background:#ffffff">
          <tr><td style="padding:32px">
            ${logoUrl
              ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(input.brand.logoAlt)}" style="display:block;max-height:56px;max-width:220px;margin:0 0 24px" />`
              : `<p style="margin:0 0 24px;color:${input.brand.primaryColor};font-size:14px;font-weight:700;letter-spacing:.08em">${escapeHtml(input.brand.shortName)}</p>`}
            <h1 style="margin:0 0 20px;font-size:26px;line-height:1.3">Your assignment result</h1>
            <p style="margin:0 0 14px;line-height:1.6">Hi ${escapeHtml(name)},</p>
            <p style="margin:0 0 20px;line-height:1.6">Here are your results for <strong>${escapeHtml(assignmentName)}</strong>.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 22px;border-radius:12px;background:#f8fafc">
              <tr><td style="padding:18px">
                <p style="margin:0 0 8px;line-height:1.5"><strong>Test:</strong> ${escapeHtml(testTitle)}</p>
                <p style="margin:0;line-height:1.5"><strong>Institute:</strong> ${escapeHtml(input.organisationName)}</p>
              </td></tr>
            </table>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;border:1px solid #e2e8f0;border-radius:12px;border-collapse:separate;border-spacing:0">
              <tr style="background:#f8fafc;color:#475569;font-size:12px"><th align="left" style="padding:12px">ATTEMPT</th><th align="left" style="padding:12px">SCORE</th><th align="left" style="padding:12px">STATUS</th></tr>
              ${rows}
            </table>
            <p style="margin:0 0 10px;font-size:18px;font-weight:700">${hasPendingGrading ? 'Current average' : 'Average score'}: ${average}%</p>
            ${hasPendingGrading ? '<p style="margin:0 0 22px;line-height:1.6;color:#92400e">One or more attempts are still being graded, so these results may change.</p>' : '<div style="height:12px"></div>'}
            <a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;border-radius:10px;background:${input.brand.primaryColor};padding:13px 20px;color:#ffffff;text-decoration:none;font-weight:700">View submissions</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`

  return { subject, text, html }
}
