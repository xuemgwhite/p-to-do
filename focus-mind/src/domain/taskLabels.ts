import type { Task, Weekday } from './models'

const weekdayLabels: Record<Weekday, string> = {
  0: '周日', 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六',
}

export function recurrenceLabel(task: Task): string | null {
  if (task.recurrenceType === 'weekly_quota') return `每周 ${task.weeklyQuota ?? 0} 次`
  if (task.recurrenceType !== 'daily') return null
  const excluded = task.excludedWeekdays ?? []
  return excluded.length === 0
    ? '每天'
    : `每天 · 排除${excluded.map((weekday) => weekdayLabels[weekday]).join('、')}`
}
