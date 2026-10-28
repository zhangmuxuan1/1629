const DAY_MS = 24 * 60 * 60 * 1000

export const DUE_REMINDER_STAGES = [
  { id: '5-days', daysBefore: 5, label: '5 天' },
  { id: '2-days', daysBefore: 2, label: '2 天' },
  { id: '12-hours', offsetMs: 12 * 60 * 60 * 1000, label: '12 小时' },
  { id: '1-hour', offsetMs: 60 * 60 * 1000, label: '1 小时' }
]

export function getDueTimestamp(dueDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate || '')
  if (!match) return null

  const [, year, month, day] = match
  const due = new Date(Number(year), Number(month) - 1, Number(day), 10, 0, 0, 0)
  if (
    due.getFullYear() !== Number(year) ||
    due.getMonth() !== Number(month) - 1 ||
    due.getDate() !== Number(day)
  ) {
    return null
  }

  return due.getTime()
}

export function getDueReminderKey(todoId, dueDate, stageId) {
  return `${todoId}:${dueDate}:${stageId}`
}

export function getReminderTimestamp(dueAt, stage) {
  if (stage.daysBefore) {
    const reminder = new Date(dueAt)
    reminder.setDate(reminder.getDate() - stage.daysBefore)
    return reminder.getTime()
  }
  return dueAt - stage.offsetMs
}
