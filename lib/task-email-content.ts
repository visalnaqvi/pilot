import type { TaskEmailEventType } from './task-email-plan'

export type TaskEmailTemplateInput = {
  eventType: TaskEmailEventType
  recipientName?: string
  taskTitle: string
  organisationName: string
  description?: string
  startAt?: Date | null
  endAt?: Date | null
  actionUrl: string
  timeZone: string
  now?: Date
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[character] || character)
}

export function isEmailAddress(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

function formatDate(value: Date | null | undefined, timeZone: string) {
  if (!value) return ''
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(value)
}

export function buildTaskEmail(input: TaskEmailTemplateInput) {
  const name = input.recipientName?.trim() || 'there'
  const subjectTitle = input.taskTitle.replace(/[\r\n]+/g, ' ').trim()
  const start = formatDate(input.startAt, input.timeZone)
  const end = formatDate(input.endAt, input.timeZone)
  const activeNow = !input.startAt || input.startAt.getTime() <= (input.now || new Date()).getTime()

  const copy: Record<TaskEmailEventType, { subject: string; heading: string; message: string }> = {
    assigned: {
      subject: `New task: ${subjectTitle}`,
      heading: 'A new task has been assigned to you',
      message: activeNow
        ? `${input.taskTitle} is available now${end ? ` and is due ${end}` : ''}.`
        : `${input.taskTitle} starts ${start}${end ? ` and is due ${end}` : ''}.`,
    },
    start: {
      subject: `${subjectTitle} is now available`,
      heading: 'Your task has started',
      message: `${input.taskTitle} is available now${end ? ` and is due ${end}` : ''}.`,
    },
    'deadline-24h': {
      subject: `24 hours left: ${subjectTitle}`,
      heading: 'Your task is due in 24 hours',
      message: `${input.taskTitle} is due ${end}.`,
    },
    'deadline-1h': {
      subject: `1 hour left: ${subjectTitle}`,
      heading: 'Your task is due in 1 hour',
      message: `${input.taskTitle} is due ${end}.`,
    },
    ended: {
      subject: `Deadline passed: ${subjectTitle}`,
      heading: 'Your task deadline has passed',
      message: `${input.taskTitle} was due ${end}. Open the task to review its current status.`,
    },
  }
  const selected = copy[input.eventType]
  const description = input.description?.trim()
  const text = [
    `Hi ${name},`,
    '',
    selected.message,
    description ? `Details: ${description}` : '',
    '',
    `Institute: ${input.organisationName}`,
    `Open task: ${input.actionUrl}`,
  ].filter(Boolean).join('\n')

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;background:#f8fafc">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;border:1px solid #e2e8f0;border-radius:16px;background:#ffffff">
          <tr><td style="padding:32px">
            <p style="margin:0 0 8px;color:#4f46e5;font-size:12px;font-weight:700;letter-spacing:.08em">MOCKPILOT</p>
            <h1 style="margin:0 0 20px;font-size:24px;line-height:1.3">${escapeHtml(selected.heading)}</h1>
            <p style="margin:0 0 14px;line-height:1.6">Hi ${escapeHtml(name)},</p>
            <p style="margin:0 0 14px;line-height:1.6">${escapeHtml(selected.message)}</p>
            ${description ? `<p style="margin:0 0 14px;line-height:1.6;color:#475569">${escapeHtml(description)}</p>` : ''}
            <p style="margin:0 0 24px;line-height:1.6;color:#475569">Institute: ${escapeHtml(input.organisationName)}</p>
            <a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;border-radius:10px;background:#4f46e5;padding:12px 18px;color:#ffffff;text-decoration:none;font-weight:700">Open task</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`

  return { subject: selected.subject, text, html }
}
