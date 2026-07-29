export type TimetableEntry = {
  id: string
  subject: string
  weekdays: number[]
  /** Legacy single-day documents are normalized when edited or published. */
  weekday?: number
  startTime: string
  endTime: string
  teacher?: string
  location?: string
  meetingUrl?: string
  notes?: string
}

export type TimetableInput = {
  name: string
  effectiveFrom: string
  effectiveTo: string
  selectedUserIds: string[]
  selectedGroupIds: string[]
  entries: TimetableEntry[]
}

export const timetableWeekdays = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

export const timetableWeekdayOrder = [1, 2, 3, 4, 5, 6, 0] as const

export function daysForTimetableEntry(entry: TimetableEntry) {
  const selected = entry.weekdays?.length
    ? entry.weekdays
    : typeof entry.weekday === 'number'
      ? [entry.weekday]
      : []
  return [...new Set(selected)].sort((first, second) => first - second)
}

const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/
const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/

export function validDateKey(value: string) {
  if (!dateKeyPattern.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function validTime(value: string) {
  return timePattern.test(value)
}

export function addDays(dateKey: string, amount: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

export function weekdayForDate(dateKey: string) {
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCDay()
}

export function localDateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function localDateTimeToDate(dateKey: string, time: string, timeZone: string) {
  if (!validDateKey(dateKey) || !validTime(time)) throw new Error('Invalid local date or time.')
  const [year, month, day] = dateKey.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute)
  let candidate = desiredAsUtc

  // Resolve the IANA-zone offset without adding a timezone dependency. A second
  // pass handles offset changes around daylight-saving transitions.
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(candidate))
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
    const representedAsUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
    )
    candidate += desiredAsUtc - representedAsUtc
  }
  return new Date(candidate)
}

export function timetableEntryOverlaps(entries: TimetableEntry[]) {
  const conflicts: Array<[string, string]> = []
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const sorted = entries
      .filter(entry => daysForTimetableEntry(entry).includes(weekday))
      .sort((first, second) => first.startTime.localeCompare(second.startTime))
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index].startTime < sorted[index - 1].endTime) {
        conflicts.push([sorted[index - 1].id, sorted[index].id])
      }
    }
  }
  return conflicts
}

export function enumerateTimetableDates(input: {
  effectiveFrom: string
  effectiveTo: string
  entries: TimetableEntry[]
  notBefore?: string
}) {
  const weekdays = new Set(input.entries.flatMap(daysForTimetableEntry))
  const start = input.notBefore && input.notBefore > input.effectiveFrom
    ? input.notBefore
    : input.effectiveFrom
  const dates: string[] = []
  for (let date = start; date <= input.effectiveTo; date = addDays(date, 1)) {
    if (weekdays.has(weekdayForDate(date))) dates.push(date)
  }
  return dates
}

export function entriesForDate(entries: TimetableEntry[], dateKey: string) {
  const weekday = weekdayForDate(dateKey)
  return entries
    .filter(entry => daysForTimetableEntry(entry).includes(weekday))
    .sort((first, second) => first.startTime.localeCompare(second.startTime))
}
