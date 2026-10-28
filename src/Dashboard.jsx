import { useMemo } from 'react'

const PRIORITY_INFO = {
  high: { label: '高', color: '#e74c3c' },
  medium: { label: '中', color: '#f39c12' },
  low: { label: '低', color: '#27ae60' },
  none: { label: '无', color: '#bbb' }
}

export default function Dashboard({ todos, onOverdueClick }) {
  const weeklyCompleted = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    return todos.filter((t) => t.completedAt && t.completedAt >= weekAgo).length
  }, [todos])

  const overdueCount = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return todos.filter((t) => {
      if (!t.dueDate || t.done || t.deletedAt) return false
      const d = new Date(t.dueDate)
      d.setHours(0, 0, 0, 0)
      return d < today
    }).length
  }, [todos])

  const priorityCounts = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0, none: 0 }
    todos
      .filter((t) => !t.done && !t.deletedAt)
      .forEach((t) => {
        counts[t.priority] = (counts[t.priority] || 0) + 1
      })
    return counts
  }, [todos])

  const totalActive = Object.values(priorityCounts).reduce((a, b) => a + b, 0)
  const maxCount = Math.max(totalActive, 1)

  return (
    <div className="dashboard">
      <div className="dash-card">
        <div className="dash-icon dash-icon-week">📅</div>
        <div className="dash-content">
          <span className="dash-value">{weeklyCompleted}</span>
          <span className="dash-label">本周完成</span>
        </div>
      </div>

      <button
        type="button"
        className="dash-card dash-card-overdue"
        onClick={onOverdueClick}
        disabled={overdueCount === 0}
        aria-label={`查看逾期任务，共 ${overdueCount} 项`}
      >
        <div className="dash-icon dash-icon-overdue">⚠️</div>
        <div className="dash-content">
          <span className="dash-value" style={{ color: overdueCount > 0 ? '#e74c3c' : '' }}>
            {overdueCount}
          </span>
          <span className="dash-label">逾期任务</span>
        </div>
      </button>

      <div className="dash-card dash-card-priority">
        <div className="dash-icon">📊</div>
        <div className="dash-content">
          <span className="dash-label" style={{ marginBottom: 6 }}>优先级分布（待办 {totalActive}）</span>
          <div className="dash-priority-bars">
            {Object.entries(PRIORITY_INFO).map(([key, info]) => {
              const count = priorityCounts[key] || 0
              const pct = totalActive > 0 ? Math.round((count / maxCount) * 100) : 0
              return (
                <div className="dash-priority-row" key={key}>
                  <span
                    className="dash-priority-label"
                    style={{ color: info.color }}
                  >
                    {info.label}
                  </span>
                  <div className="dash-priority-bar-bg">
                    <div
                      className="dash-priority-bar-fill"
                      style={{
                        width: `${pct}%`,
                        background: info.color
                      }}
                    />
                  </div>
                  <span className="dash-priority-count">{count}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}