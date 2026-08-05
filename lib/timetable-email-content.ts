import { daysForTimetableEntry, timetableWeekdays, type TimetableEntry } from './timetable'
import { escapeHtml } from './task-email-content'
import { getBrandConfig } from './branding'

export function buildTimetableAgendaEmail(input: {
  recipientName?: string
  organisationName: string
  localDate: string
  entries: Array<TimetableEntry & { timetableName: string }>
  actionUrl: string
}) {
  const name = input.recipientName?.trim() || 'Student'
  const formattedDate = new Date(`${input.localDate}T00:00:00.000Z`).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const rows = input.entries
    .sort((first, second) => first.startTime.localeCompare(second.startTime))
    .map(entry => {
      const details = [entry.teacher, entry.location].filter(Boolean).join(' · ')
      return `${entry.startTime}–${entry.endTime} — ${entry.subject} (${entry.timetableName})${details ? ` — ${details}` : ''}`
    })
  const text = [
    `Hi ${name},`,
    '',
    `Here is your class agenda for ${formattedDate}.`,
    '',
    ...rows,
    '',
    `Institute: ${input.organisationName}`,
    `Open timetable: ${input.actionUrl}`,
  ].join('\n')
  const listHtml = input.entries
    .sort((first, second) => first.startTime.localeCompare(second.startTime))
    .map(entry => `<tr><td style="padding:12px 0;border-bottom:1px solid #e2e8f0"><strong>${escapeHtml(entry.startTime)}–${escapeHtml(entry.endTime)} · ${escapeHtml(entry.subject)}</strong><br><span style="color:#64748b">${escapeHtml(entry.timetableName)}${entry.teacher ? ` · ${escapeHtml(entry.teacher)}` : ''}${entry.location ? ` · ${escapeHtml(entry.location)}` : ''}</span></td></tr>`)
    .join('')
  const html = emailShell({
    heading: `Your classes for ${formattedDate}`,
    greeting: name,
    message: `You have ${input.entries.length} class${input.entries.length === 1 ? '' : 'es'} today.`,
    details: [`Institute: ${input.organisationName}`],
    extraHtml: `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:8px 0 24px">${listHtml}</table>`,
    actionUrl: input.actionUrl,
    actionLabel: 'Open timetable',
  })
  return {
    subject: `${formattedDate}: ${input.entries.length} class${input.entries.length === 1 ? '' : 'es'} today`,
    text,
    html,
  }
}

function emailShell(input: {
  heading: string
  greeting: string
  message: string
  details: string[]
  actionUrl: string
  actionLabel: string
  extraHtml?: string
}) {
  const brand = getBrandConfig()
  return `<!doctype html>
<html><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;background:#f8fafc"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;border:1px solid #e2e8f0;border-radius:16px;background:#fff"><tr><td style="padding:32px">
<p style="margin:0 0 8px;color:${brand.primaryColor};font-size:12px;font-weight:700;letter-spacing:.08em">${escapeHtml(brand.shortName)}</p>
<h1 style="margin:0 0 20px;font-size:24px;line-height:1.3">${escapeHtml(input.heading)}</h1>
<p style="margin:0 0 14px;line-height:1.6">Hi ${escapeHtml(input.greeting)},</p>
<p style="margin:0 0 14px;line-height:1.6">${escapeHtml(input.message)}</p>
${input.extraHtml || ''}
${input.details.map(detail => `<p style="margin:0 0 8px;line-height:1.6;color:#475569">${escapeHtml(detail)}</p>`).join('')}
<a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;margin-top:16px;border-radius:10px;background:${brand.primaryColor};padding:12px 18px;color:#fff;text-decoration:none;font-weight:700">${escapeHtml(input.actionLabel)}</a>
</td></tr></table></td></tr></table></body></html>`
}

export function timetableEntrySummary(entry: TimetableEntry) {
  const days = daysForTimetableEntry(entry).map(day => timetableWeekdays[day]).join(', ')
  return `${days} ${entry.startTime}–${entry.endTime}: ${entry.subject}`
}
