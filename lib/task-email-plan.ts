export const taskEmailEventTypes = [
  'assigned',
  'start',
  'deadline-24h',
  'deadline-1h',
  'ended',
] as const

export type TaskEmailEventType = (typeof taskEmailEventTypes)[number]

export type PlannedTaskEmailJob = {
  id: string
  taskId: string
  eventType: TaskEmailEventType
  dueAt: Date
}

const hour = 60 * 60 * 1_000

export function taskEmailJobId(taskId: string, eventType: TaskEmailEventType) {
  return `${taskId}:${eventType}`
}

export function taskEmailDeliveryId(jobId: string, userId: string) {
  return `${jobId}:${userId}`
}

export function planTaskEmailJobs(input: {
  taskId: string
  createdAt: Date
  startAt?: Date | null
  endAt?: Date | null
}) {
  const jobs: PlannedTaskEmailJob[] = [{
    id: taskEmailJobId(input.taskId, 'assigned'),
    taskId: input.taskId,
    eventType: 'assigned',
    dueAt: input.createdAt,
  }]

  if (input.startAt && input.startAt.getTime() > input.createdAt.getTime()) {
    jobs.push({
      id: taskEmailJobId(input.taskId, 'start'),
      taskId: input.taskId,
      eventType: 'start',
      dueAt: input.startAt,
    })
  }

  if (input.endAt) {
    const reminders = [
      { eventType: 'deadline-24h' as const, dueAt: new Date(input.endAt.getTime() - 24 * hour) },
      { eventType: 'deadline-1h' as const, dueAt: new Date(input.endAt.getTime() - hour) },
    ]
    reminders.forEach(reminder => {
      const afterCreation = reminder.dueAt.getTime() > input.createdAt.getTime()
      const afterStart = !input.startAt || reminder.dueAt.getTime() > input.startAt.getTime()
      if (afterCreation && afterStart) {
        jobs.push({
          id: taskEmailJobId(input.taskId, reminder.eventType),
          taskId: input.taskId,
          eventType: reminder.eventType,
          dueAt: reminder.dueAt,
        })
      }
    })
    if (input.endAt.getTime() > input.createdAt.getTime()) {
      jobs.push({
        id: taskEmailJobId(input.taskId, 'ended'),
        taskId: input.taskId,
        eventType: 'ended',
        dueAt: input.endAt,
      })
    }
  }

  return jobs
}

export function retryAtForAttempt(attempt: number, now: Date) {
  const delayMinutes = [1, 5, 15, 60][Math.max(0, Math.min(attempt - 1, 3))]
  return new Date(now.getTime() + delayMinutes * 60_000)
}

export function taskEmailSkipReason(input: {
  eventType: TaskEmailEventType
  manuallyClosed: boolean
  assigneeStatus?: string
  submitted: boolean
}) {
  if (input.eventType !== 'assigned' && input.manuallyClosed) return 'task-manually-closed'
  if (
    ['deadline-24h', 'deadline-1h', 'ended'].includes(input.eventType)
    && (input.assigneeStatus === 'done' || input.assigneeStatus === 'closed' || input.submitted)
  ) {
    return 'assignee-complete'
  }
  return null
}
