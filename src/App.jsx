import { useState, useEffect, useMemo, useReducer, useRef, useCallback } from 'react'
import Dashboard from './Dashboard'
import appIconUrl from '../assets/app-icon.svg'
import {
  DUE_REMINDER_STAGES,
  getDueReminderKey,
  getDueTimestamp,
  getReminderTimestamp
} from './reminders'
import './features.css'

const STORAGE_KEY = 'todolist.items.v3'
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const SETTINGS_KEY = 'todolist.settings.v1'
const NOTIFICATION_GUIDE_KEY = 'todolist.notification-guide.v1'
const EXPIRING_NOTIFICATION_SLOTS = [
  { hour: 10, label: '10:00' },
  { hour: 16, label: '16:00' }
]
const EXPIRING_NOTIFICATION_WINDOW_MS = 15 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

const PRIORITY = {
  high: { label: '高', color: '#e74c3c', order: 0 },
  medium: { label: '中', color: '#f39c12', order: 1 },
  low: { label: '低', color: '#27ae60', order: 2 },
  none: { label: '无', color: '#bbb', order: 3 }
}

function loadTodos() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    const defaults = {
      soundEnabled: true,
      dueNotifDismissed: null,
      dailyNotifSent: null,
      sentDueReminderKeys: [],
      expiringNotifEnabled: true,
      sentExpiringNotifSlots: []
    }
    if (!raw) return defaults
    const parsed = JSON.parse(raw)
    return {
      ...defaults,
      ...parsed,
      sentDueReminderKeys: Array.isArray(parsed.sentDueReminderKeys)
        ? parsed.sentDueReminderKeys
        : [],
      sentExpiringNotifSlots: Array.isArray(parsed.sentExpiringNotifSlots)
        ? parsed.sentExpiringNotifSlots
        : []
    }
  } catch {
    return {
      soundEnabled: true,
      dueNotifDismissed: null,
      dailyNotifSent: null,
      sentDueReminderKeys: [],
      expiringNotifEnabled: true,
      sentExpiringNotifSlots: []
    }
  }
}

function getLocalDateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function purgeExpired(todos) {
  const now = Date.now()
  return todos.filter((t) => !t.deletedAt || now - t.deletedAt < RETENTION_MS)
}

function sortTodos(todos, sortBy) {
  if (sortBy === 'priority') {
    return [...todos].sort((a, b) => {
      const pa = PRIORITY[a.priority]?.order ?? 3
      const pb = PRIORITY[b.priority]?.order ?? 3
      return pa - pb
    })
  }
  if (sortBy === 'due') {
    return [...todos].sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0
      if (!a.dueDate) return 1
      if (!b.dueDate) return -1
      return new Date(a.dueDate) - new Date(b.dueDate)
    })
  }
  return todos
}

function playDing() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08)
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.18)
    gain.gain.setValueAtTime(0.001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.3)
    osc.onended = () => ctx.close()
  } catch {}
}

const initialState = {
  todos: purgeExpired(loadTodos()),
  filter: 'active',
  search: '',
  sortBy: 'manual'
}

function reducer(state, action) {
  switch (action.type) {
    case 'INIT':
      return { ...state, todos: purgeExpired(loadTodos()) }

    case 'ADD': {
      const newTodo = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        text: action.payload.text,
        done: false,
        deletedAt: null,
        completedAt: null,
        createdAt: Date.now(),
        priority: action.payload.priority || 'none',
        dueDate: action.payload.dueDate || null,
        tags: action.payload.tags || []
      }
      return { ...state, todos: [newTodo, ...state.todos] }
    }

    case 'TOGGLE':
      return {
        ...state,
        todos: state.todos.map((t) => {
          if (t.id !== action.payload || t.deletedAt) return t
          const newDone = !t.done
          return { ...t, done: newDone, completedAt: newDone ? Date.now() : null }
        })
      }

    case 'PERMANENTLY_DELETE':
      return { ...state, todos: state.todos.filter((t) => t.id !== action.payload) }

    case 'SOFT_DELETE':
      return {
        ...state,
        todos: state.todos.map((t) =>
          t.id === action.payload ? { ...t, deletedAt: Date.now() } : t
        )
      }

    case 'RESTORE':
      return {
        ...state,
        todos: state.todos.map((t) =>
          t.id === action.payload
            ? { ...t, deletedAt: null, done: false, completedAt: null }
            : t
        )
      }

    case 'UPDATE':
      return {
        ...state,
        todos: state.todos.map((t) =>
          t.id === action.payload.id ? { ...t, ...action.payload.data } : t
        )
      }

    case 'REMOVE_TAG':
      return {
        ...state,
        todos: state.todos.map((t) => ({
          ...t,
          tags: (t.tags || []).filter((tag) => tag !== action.payload)
        }))
      }

    case 'CLEAR_COMPLETED':
      return {
        ...state,
        todos: state.todos.map((t) =>
          t.done && !t.deletedAt ? { ...t, deletedAt: Date.now() } : t
        )
      }

    case 'REORDER': {
      const { sourceId, targetId } = action.payload
      const list = [...state.todos]
      const fromIndex = list.findIndex((t) => t.id === sourceId)
      const toIndex = list.findIndex((t) => t.id === targetId)
      if (fromIndex === -1 || toIndex === -1) return state
      const [moved] = list.splice(fromIndex, 1)
      list.splice(toIndex, 0, moved)
      return { ...state, todos: list }
    }

    case 'SET_FILTER':
      return { ...state, filter: action.payload }

    case 'SET_SEARCH':
      return { ...state, search: action.payload }

    case 'SET_SORT':
      return { ...state, sortBy: action.payload }

    case 'BATCH_COMPLETE':
      return {
        ...state,
        todos: state.todos.map((t) =>
          action.payload.includes(t.id) && !t.deletedAt
            ? { ...t, done: true, completedAt: Date.now() }
            : t
        )
      }

    case 'BATCH_UNCOMPLETE':
      return {
        ...state,
        todos: state.todos.map((t) =>
          action.payload.includes(t.id) && !t.deletedAt
            ? { ...t, done: false, completedAt: null }
            : t
        )
      }

    case 'BATCH_SOFT_DELETE':
      return {
        ...state,
        todos: state.todos.map((t) =>
          action.payload.includes(t.id) && !t.deletedAt
            ? { ...t, deletedAt: Date.now() }
            : t
        )
      }

    case 'BATCH_PERMANENTLY_DELETE':
      return { ...state, todos: state.todos.filter((t) => !action.payload.includes(t.id)) }

    case 'BATCH_SET_PRIORITY':
      return {
        ...state,
        todos: state.todos.map((t) =>
          action.payload.ids.includes(t.id) ? { ...t, priority: action.payload.priority } : t
        )
      }

    case 'IMPORT':
      return { ...state, todos: purgeExpired(action.payload) }

    default:
      return state
  }
}

const EMPTY_ICONS = {
  all: '📋',
  active: '🎉',
  completed: '✨'
}

const EMPTY_MESSAGES = {
  all: '还没有完成过任务',
  active: '没有待办任务，干得漂亮！',
  completed: '还没有已完成的任务'
}

function EmptyStateSVG({ type }) {
  if (type === 'active') {
    return (
      <svg viewBox="0 0 120 100" width="120" height="100" className="empty-svg">
        <defs>
          <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#667eea" />
            <stop offset="100%" stopColor="#764ba2" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="45" r="30" fill="none" stroke="url(#g1)" strokeWidth="3" strokeDasharray="4 4" opacity="0.4" />
        <path d="M45 45 L55 55 L75 35" fill="none" stroke="url(#g1)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="60" cy="45" r="4" fill="#667eea" opacity="0.6" />
        <circle cx="30" cy="75" r="3" fill="#764ba2" opacity="0.3" />
        <circle cx="90" cy="70" r="2" fill="#667eea" opacity="0.4" />
        <circle cx="25" cy="35" r="2" fill="#f093fb" opacity="0.3" />
        <circle cx="95" cy="40" r="3" fill="#f093fb" opacity="0.3" />
      </svg>
    )
  }
  if (type === 'completed') {
    return (
      <svg viewBox="0 0 120 100" width="120" height="100" className="empty-svg">
        <defs>
          <linearGradient id="g2" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f093fb" />
            <stop offset="100%" stopColor="#f5576c" />
          </linearGradient>
        </defs>
        <rect x="30" y="30" width="60" height="50" rx="8" fill="none" stroke="url(#g2)" strokeWidth="3" />
        <path d="M42 55 L52 65 L78 42" fill="none" stroke="url(#g2)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M50 25 L52 18 L54 25" fill="none" stroke="#f5576c" strokeWidth="2" strokeLinecap="round" />
        <path d="M65 22 L67 15 L69 22" fill="none" stroke="#f093fb" strokeWidth="2" strokeLinecap="round" />
        <path d="M80 28 L82 21 L84 28" fill="none" stroke="#f5576c" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 120 100" width="120" height="100" className="empty-svg">
      <defs>
        <linearGradient id="g3" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4facfe" />
          <stop offset="100%" stopColor="#00f2fe" />
        </linearGradient>
      </defs>
      <rect x="30" y="20" width="60" height="70" rx="8" fill="none" stroke="url(#g3)" strokeWidth="3" />
      <line x1="40" y1="38" x2="80" y2="38" stroke="#4facfe" strokeWidth="2" strokeLinecap="round" />
      <line x1="40" y1="50" x2="75" y2="50" stroke="#4facfe" strokeWidth="2" strokeLinecap="round" />
      <line x1="40" y1="62" x2="70" y2="62" stroke="#4facfe" strokeWidth="2" strokeLinecap="round" />
      <line x1="40" y1="74" x2="65" y2="74" stroke="#4facfe" strokeWidth="2" strokeLinecap="round" />
      <circle cx="20" cy="50" r="3" fill="#00f2fe" opacity="0.4" />
      <circle cx="100" cy="40" r="2" fill="#4facfe" opacity="0.3" />
      <circle cx="15" cy="80" r="2" fill="#00f2fe" opacity="0.3" />
    </svg>
  )
}

const PRIORITY_OPTIONS = [
  { value: 'none', label: '无优先级' },
  { value: 'low', label: '低优先级' },
  { value: 'medium', label: '中优先级' },
  { value: 'high', label: '高优先级' }
]

const SORT_OPTIONS = [
  { value: 'manual', label: '手动排序' },
  { value: 'priority', label: '按优先级' },
  { value: 'due', label: '按截止日期' }
]

function formatRelative(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (days === 0) {
    const hours = Math.floor(diff / (1000 * 60 * 60))
    if (hours === 0) {
      const mins = Math.floor(diff / (1000 * 60))
      return mins <= 1 ? '刚刚' : `${mins} 分钟前`
    }
    return `${hours} 小时前`
  }
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  if (days < 30) return `${days} 天前`
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function getDueDateStatus(dueDate) {
  if (!dueDate) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dueDate)
  due.setHours(0, 0, 0, 0)
  const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24))
  if (diffDays < 0) return { level: 'overdue', text: `逾期 ${-diffDays} 天` }
  if (diffDays === 0) return { level: 'today', text: '今天到期' }
  if (diffDays <= 3) return { level: 'soon', text: `${diffDays} 天后到期` }
  return { level: 'normal', text: `${diffDays} 天后` }
}

const CSV_HEADER_MAP = {
  任务内容: 'text',
  优先级: 'priority',
  截止日期: 'dueDate',
  标签: 'tags',
  完成: 'done',
  id: 'id',
  text: 'text',
  priority: 'priority',
  dueDate: 'dueDate',
  tags: 'tags',
  done: 'done',
  createdAt: 'createdAt',
  completedAt: 'completedAt',
  deletedAt: 'deletedAt'
}

const PRIORITY_CN = { none: '无', low: '低', medium: '中', high: '高' }
const PRIORITY_EN_CN = { 无: 'none', 低: 'low', 中: 'medium', 高: 'high', none: 'none', low: 'low', medium: 'medium', high: 'high' }

function escapeCSV(value) {
  if (value == null) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}

function toCSV(todos) {
  const headers = ['任务内容', '优先级', '截止日期', '标签', '完成']
  const rows = todos.map((t) => {
    const displayPriority = PRIORITY_CN[t.priority] || '无'
    const displayDone = t.done ? '是' : '否'
    return [
      t.text || '',
      displayPriority,
      t.dueDate || '',
      (t.tags || []).join('|'),
      displayDone
    ].map(escapeCSV).join(',')
  })
  return '\uFEFF' + [headers.join(','), ...rows].join('\r\n')
}

function getCSVDownloadTemplate() {
  const headers = ['任务内容', '优先级', '截止日期', '标签', '完成']
  const example = ['示例任务：完成周报', '中', '2026-12-31', '工作|重要', '否']
  return '\uFEFF' + [headers.join(','), example.join(',')].join('\r\n')
}

function parseCSV(text) {
  if (text.startsWith('\uFEFF')) text = text.slice(1)
  const rows = []
  let currentRow = []
  let currentField = ''
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          currentField += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      currentField += ch
      i++
      continue
    } else {
      if (ch === '"') {
        inQuotes = true
        i++
        continue
      }
      if (ch === ',') {
        currentRow.push(currentField)
        currentField = ''
        i++
        continue
      }
      if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') {
          i++
        }
        i++
        currentRow.push(currentField)
        currentField = ''
        if (currentRow.length > 1 || currentRow[0] !== '') {
          rows.push(currentRow)
        }
        currentRow = []
        continue
      }
      currentField += ch
      i++
    }
  }
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField)
    if (currentRow.length > 1 || currentRow[0] !== '') {
      rows.push(currentRow)
    }
  }
  if (rows.length === 0) return []
  const rawHeaders = rows[0]
  const dataRows = rows.slice(1)
  const mappedHeaders = rawHeaders.map((h) => CSV_HEADER_MAP[h.trim()] || h.trim())
  return dataRows.map((row) => {
    const obj = {}
    mappedHeaders.forEach((h, idx) => {
      obj[h] = (row[idx] || '').trim()
    })
    const priorityVal = PRIORITY_EN_CN[obj.priority] || obj.priority || 'none'
    const doneVal = obj.done === 'true' || obj.done === '是' || obj.done === '1'
    return {
      id: obj.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
      text: obj.text || '',
      done: doneVal,
      priority: priorityVal,
      dueDate: obj.dueDate || null,
      tags: obj.tags ? obj.tags.split('|').filter(Boolean) : [],
      createdAt: Number(obj.createdAt) || Date.now(),
      completedAt: obj.completedAt ? Number(obj.completedAt) : null,
      deletedAt: obj.deletedAt ? Number(obj.deletedAt) : null
    }
  }).filter((t) => t.text)
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const { todos, filter, search, sortBy } = state

  const [input, setInput] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editingText, setEditingText] = useState('')
  const [addPriority, setAddPriority] = useState('none')
  const [addDueDate, setAddDueDate] = useState('')
  const [addTags, setAddTags] = useState('')
  const [showAddOptions, setShowAddOptions] = useState(false)
  const [tagFilter, setTagFilter] = useState(null)
  const [editingMeta, setEditingMeta] = useState(null)
  const [highlightedTodoId, setHighlightedTodoId] = useState(null)
  const dragId = useRef(null)
  const inputRef = useRef(null)
  const searchRef = useRef(null)
  const fileInputRef = useRef(null)

  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [batchPriority, setBatchPriority] = useState('none')

  const [toast, setToast] = useState(null)
  const [completedAnimId, setCompletedAnimId] = useState(null)

  const [settings, setSettings] = useState(loadSettings)
  const [darkMode, setDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('todolist.theme')
      if (saved) return saved === 'dark'
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
    } catch {
      return false
    }
  })
  const [notifPermission, setNotifPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  )
  const [showNotificationGuide, setShowNotificationGuide] = useState(() => (
    typeof window.desktopNotifications !== 'undefined' &&
    localStorage.getItem(NOTIFICATION_GUIDE_KEY) !== 'done'
  ))
  const [dueBannerDismissed, setDueBannerDismissed] = useState(false)
  const [importPreview, setImportPreview] = useState(null)
  const [pendingBatchDelete, setPendingBatchDelete] = useState(null)
  const [showCloseConfirmation, setShowCloseConfirmation] = useState(false)
  const armedReminderKeys = useRef(new Set())
  const sentDueReminderKeys = useRef(new Set(settings.sentDueReminderKeys))
  const sentExpiringNotifSlots = useRef(new Set(settings.sentExpiringNotifSlots))

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos))
  }, [todos])

  useEffect(() => {
    const unsubscribe = window.desktopWindow?.onCloseRequest(() => {
      setShowCloseConfirmation(true)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
    localStorage.setItem('todolist.theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  const activeTodos = useMemo(() => todos.filter((t) => !t.deletedAt), [todos])

  const dueTodayCount = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return activeTodos.filter((t) => {
      if (!t.dueDate || t.done) return false
      const d = new Date(t.dueDate)
      d.setHours(0, 0, 0, 0)
      return d.getTime() === today.getTime()
    }).length
  }, [activeTodos])

  const overdueCount = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return activeTodos.filter((t) => {
      if (!t.dueDate || t.done) return false
      const d = new Date(t.dueDate)
      d.setHours(0, 0, 0, 0)
      return d < today
    }).length
  }, [activeTodos])

  useEffect(() => {
    if (dueTodayCount === 0 && overdueCount === 0) {
      setDueBannerDismissed(false)
    }
  }, [dueTodayCount, overdueCount])

  useEffect(() => {
    if (typeof Notification === 'undefined') return
    if (notifPermission !== 'granted') return
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = today.toISOString().slice(0, 10)
    if (settings.dailyNotifSent === todayStr) return
    if (dueTodayCount > 0 || overdueCount > 0) {
      const bodyParts = []
      if (overdueCount > 0) bodyParts.push(`${overdueCount} 个已逾期`)
      if (dueTodayCount > 0) bodyParts.push(`${dueTodayCount} 个今天到期`)
      try {
        new Notification('📋 待办提醒', {
          body: `你有 ${bodyParts.join('、')} 的任务需要处理`,
          tag: 'todolist-daily'
        })
        setSettings((s) => ({ ...s, dailyNotifSent: todayStr }))
      } catch {}
    }
  }, [dueTodayCount, overdueCount, notifPermission, settings])

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type, id: Date.now() })
    setTimeout(() => setToast(null), 2400)
  }, [])

  const jumpToTodo = useCallback((todoId) => {
    dispatch({ type: 'SET_FILTER', payload: 'active' })
    dispatch({ type: 'SET_SEARCH', payload: '' })
    setTagFilter(null)
    setSelectionMode(false)
    setSelectedIds([])
    setEditingId(null)
    setEditingText('')
    setHighlightedTodoId(todoId)
  }, [])

  const openTodoFromNotification = useCallback(async (todoId) => {
    try {
      if (typeof window.desktopWindow?.focus === 'function') {
        await window.desktopWindow.focus()
      } else {
        window.focus()
      }
    } catch (error) {
      console.error('从桌面通知打开任务失败：', error)
      showToast('无法自动打开任务，请检查应用窗口状态', 'error')
    }
    jumpToTodo(todoId)
  }, [jumpToTodo, showToast])

  useEffect(() => {
    const checkReminders = () => {
      const now = Date.now()
      const liveKeys = new Set()

      for (const todo of activeTodos) {
        if (todo.done || !todo.dueDate) continue
        const dueAt = getDueTimestamp(todo.dueDate)
        if (dueAt === null || now >= dueAt) continue

        for (const stage of DUE_REMINDER_STAGES) {
          const key = getDueReminderKey(todo.id, todo.dueDate, stage.id)
          liveKeys.add(key)
          if (sentDueReminderKeys.current.has(key)) continue

          const triggerAt = getReminderTimestamp(dueAt, stage)
          if (now < triggerAt) {
            armedReminderKeys.current.add(key)
            continue
          }
          if (!armedReminderKeys.current.has(key) || notifPermission !== 'granted') continue

          try {
            new Notification(todo.text, {
              body: `该任务将于 ${todo.dueDate} 10:00 到期（提前 ${stage.label}），请及时处理。`,
              tag: `todolist-${todo.id}-${todo.dueDate}-${stage.id}`
            })
          } catch (error) {
            console.error('发送任务到期提醒失败：', error)
            showToast(`无法发送“${todo.text}”的到期提醒`, 'error')
          }

          sentDueReminderKeys.current.add(key)
          armedReminderKeys.current.delete(key)
          setSettings((current) => ({
            ...current,
            sentDueReminderKeys: [...new Set([
              ...(current.sentDueReminderKeys || []),
              key
            ])]
          }))
        }
      }

      for (const key of armedReminderKeys.current) {
        if (!liveKeys.has(key)) armedReminderKeys.current.delete(key)
      }
    }

    checkReminders()
    const timer = setInterval(checkReminders, 15_000)
    return () => clearInterval(timer)
  }, [activeTodos, notifPermission, showToast])

  useEffect(() => {
    if (!settings.expiringNotifEnabled || notifPermission !== 'granted') return
    if (typeof Notification === 'undefined') return

    const checkExpiringNotifications = () => {
      const now = new Date()
      const nowMs = now.getTime()
      const dateKey = getLocalDateKey(now)

      for (const slot of EXPIRING_NOTIFICATION_SLOTS) {
        const scheduledAt = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          slot.hour,
          0,
          0,
          0
        ).getTime()
        if (nowMs < scheduledAt || nowMs - scheduledAt >= EXPIRING_NOTIFICATION_WINDOW_MS) continue

        const slotKey = `${dateKey}:${slot.label}`
        if (sentExpiringNotifSlots.current.has(slotKey)) continue

        const expiringTodos = activeTodos.filter((todo) => {
          if (todo.done || !todo.dueDate) return false
          const dueAt = getDueTimestamp(todo.dueDate)
          return dueAt !== null && dueAt >= nowMs && dueAt <= nowMs + DAY_MS
        })
        if (expiringTodos.length === 0) continue

        let sentCount = 0
        let notificationError = null
        for (const todo of expiringTodos) {
          try {
            const notification = new Notification(`⏰ ${todo.text}`, {
              body: `24 小时内到期 · 截止 ${todo.dueDate} 10:00 · 点击查看任务详情`,
              tag: `todolist-expiring-${slotKey}-${todo.id}`,
              data: { todoId: todo.id }
            })
            notification.onclick = () => {
              void openTodoFromNotification(todo.id)
            }
            sentCount += 1
          } catch (error) {
            console.error(`发送任务“${todo.text}”的到期通知失败：`, error)
            if (!notificationError) notificationError = error
          }
        }

        sentExpiringNotifSlots.current.add(slotKey)
        if (sentCount > 0) {
          setSettings((current) => ({
            ...current,
            sentExpiringNotifSlots: [
              ...new Set([...(current.sentExpiringNotifSlots || []), slotKey])
            ].slice(-60)
          }))
        }
        if (notificationError) {
          showToast('无法发送即将过期任务通知，请检查系统通知设置', 'error')
        }
      }
    }

    checkExpiringNotifications()
    const timer = setInterval(checkExpiringNotifications, 15_000)
    return () => clearInterval(timer)
  }, [activeTodos, notifPermission, openTodoFromNotification, settings.expiringNotifEnabled, showToast])

  const completeNotificationGuide = () => {
    localStorage.setItem(NOTIFICATION_GUIDE_KEY, 'done')
    setShowNotificationGuide(false)
  }

  const dismissNotificationGuide = () => {
    setShowNotificationGuide(false)
  }

  const openNotificationSettings = async () => {
    if (typeof window.desktopNotifications?.openSettings !== 'function') {
      showToast('请在 Windows 设置 > 系统 > 通知中开启应用通知', 'info')
      return
    }
    try {
      await window.desktopNotifications.openSettings()
    } catch (error) {
      console.error('打开 Windows 通知设置失败：', error)
      showToast('无法打开 Windows 通知设置，请手动前往系统设置', 'error')
    }
  }

  const addTodo = () => {
    const text = input.trim()
    if (!text) {
      showToast('请先输入待办事项', 'error')
      inputRef.current?.focus()
      return
    }
    const tags = addTags
      .split(/[,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)
    dispatch({
      type: 'ADD',
      payload: { text, priority: addPriority, dueDate: addDueDate, tags }
    })
    if (settings.soundEnabled) playDing()
    showToast('任务已添加', 'success')
    setInput('')
    setAddPriority('none')
    setAddDueDate('')
    setAddTags('')
    setShowAddOptions(false)
  }

  const handleKeyAdd = (e) => {
    if (e.key === 'Enter' && !editingId) addTodo()
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditingText('')
  }

  useEffect(() => {
    const handler = (e) => {
      const target = e.target
      const isTyping = target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      )

      const hasCtrl = e.ctrlKey || e.metaKey
      const hasShift = e.shiftKey
      const hasAlt = e.altKey

      if (hasCtrl && !hasAlt) {
        const key = e.key.toLowerCase()

        if (key === 'enter' && !hasShift) {
          if (!isTyping || target === inputRef.current) {
            e.preventDefault()
            e.stopPropagation()
            addTodo()
          }
          return
        }

        if (!hasShift && key === 'z') {
          e.preventDefault()
          e.stopPropagation()
          if (selectionMode) setSelectionMode(false)
          inputRef.current?.focus()
          return
        }

        if (!hasShift && key === '/') {
          e.preventDefault()
          e.stopPropagation()
          searchRef.current?.focus()
          return
        }
      }

      if (e.key === 'Escape') {
        if (importPreview) {
          setImportPreview(null)
          return
        }
        if (selectionMode) {
          e.preventDefault()
          setSelectionMode(false)
          setSelectedIds([])
        }
        if (editingId !== null) {
          e.preventDefault()
          cancelEdit()
        }
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [selectionMode, editingId, input, addTodo, importPreview])

  const requestNotifPermission = async () => {
    if (typeof Notification === 'undefined') {
      showToast('当前浏览器不支持通知', 'error')
      return
    }
    try {
      const perm = await Notification.requestPermission()
      setNotifPermission(perm)
      if (perm === 'granted') {
        showToast('通知已开启', 'success')
      } else {
        showToast('通知未开启，请在 Windows 通知设置中允许本应用发送通知', 'error')
      }
    } catch (error) {
      console.error('申请桌面通知权限失败：', error)
      showToast('申请通知权限失败，请在 Windows 通知设置中手动开启', 'error')
    }
  }

  const filtered = useMemo(() => {
    let list
    if (filter === 'active') {
      list = todos.filter((t) => !t.done && !t.deletedAt)
    } else if (filter === 'completed') {
      list = todos.filter((t) => t.done && !t.deletedAt)
    } else {
      const activeItems = todos.filter((t) => !t.done && !t.deletedAt)
      const doneItems = todos.filter((t) => t.done && !t.deletedAt)
      const deletedItems = todos.filter((t) => t.deletedAt)
      list = [...activeItems, ...doneItems, ...deletedItems]
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((t) => t.text.toLowerCase().includes(q))
    }

    if (tagFilter) {
      list = list.filter((t) => t.tags && t.tags.includes(tagFilter))
    }

    return sortTodos(list, sortBy)
  }, [todos, filter, search, sortBy, tagFilter])

  const { activeItems, doneItems, deletedItems } = useMemo(() => {
    if (filter !== 'all') return { activeItems: [], doneItems: filtered, deletedItems: [] }
    let aItems = todos.filter((t) => !t.done && !t.deletedAt)
    let dItems = todos.filter((t) => t.done && !t.deletedAt)
    let delItems = todos.filter((t) => t.deletedAt)

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      aItems = aItems.filter((t) => t.text.toLowerCase().includes(q))
      dItems = dItems.filter((t) => t.text.toLowerCase().includes(q))
      delItems = delItems.filter((t) => t.text.toLowerCase().includes(q))
    }
    if (tagFilter) {
      aItems = aItems.filter((t) => t.tags && t.tags.includes(tagFilter))
      dItems = dItems.filter((t) => t.tags && t.tags.includes(tagFilter))
      delItems = delItems.filter((t) => t.tags && t.tags.includes(tagFilter))
    }

    return { activeItems: sortTodos(aItems, sortBy), doneItems: sortTodos(dItems, sortBy), deletedItems: sortTodos(delItems, sortBy) }
  }, [todos, filter, search, sortBy, tagFilter, filtered])

  const activeCount = todos.filter((t) => !t.done && !t.deletedAt).length
  const completedCount = todos.filter((t) => t.done && !t.deletedAt).length
  const deletedCount = todos.filter((t) => t.deletedAt).length

  const allTags = useMemo(() => {
    const s = new Set()
    todos.forEach((t) => {
      if (t.tags && !t.deletedAt) t.tags.forEach((tag) => s.add(tag))
    })
    return Array.from(s)
  }, [todos])

  const visibleItems = useMemo(() => {
    if (filter === 'all') {
      return [...activeItems, ...doneItems, ...deletedItems]
    }
    return filtered
  }, [filter, activeItems, doneItems, deletedItems, filtered])

  useEffect(() => {
    if (!highlightedTodoId) return
    const target = Array.from(document.querySelectorAll('.todo-item[data-todo-id]'))
      .find((item) => item.dataset.todoId === highlightedTodoId)
    if (!target) return

    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    target.classList.add('notification-target')
    const timer = setTimeout(() => target.classList.remove('notification-target'), 1800)
    setHighlightedTodoId(null)
    return () => clearTimeout(timer)
  }, [highlightedTodoId, visibleItems])

  const selectableIds = useMemo(() => {
    return visibleItems
      .filter((t) => !t.deletedAt)
      .map((t) => t.id)
  }, [visibleItems])

  const allSelectableSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.includes(id))
  const someSelected = selectedIds.length > 0 && !allSelectableSelected

  const startEdit = (todo) => {
    if (todo.deletedAt) return
    setEditingId(todo.id)
    setEditingText(todo.text)
  }

  const commitEdit = () => {
    if (editingId === null) return
    const text = editingText.trim()
    if (!text) {
      dispatch({ type: 'PERMANENTLY_DELETE', payload: editingId })
    } else {
      dispatch({ type: 'UPDATE', payload: { id: editingId, data: { text } } })
    }
    setEditingId(null)
    setEditingText('')
  }

  const updateMeta = (todo, patch) => {
    dispatch({ type: 'UPDATE', payload: { id: todo.id, data: patch } })
  }

  const handleToggleDone = (todo) => {
    if (settings.soundEnabled && !todo.done) {
      playDing()
    }
    if (!todo.done) {
      setCompletedAnimId(todo.id)
      setTimeout(() => setCompletedAnimId(null), 600)
    }
    updateMeta(todo, { done: !todo.done, completedAt: !todo.done ? Date.now() : null })
  }

  const handleDragStart = (id) => {
    dragId.current = id
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.currentTarget.classList.add('drag-over')
  }

  const handleDragLeave = (e) => {
    e.currentTarget.classList.remove('drag-over')
  }

  const handleDrop = (e, targetId) => {
    e.preventDefault()
    e.currentTarget.classList.remove('drag-over')
    const sourceId = dragId.current
    dragId.current = null
    if (sourceId && sourceId !== targetId) {
      dispatch({ type: 'REORDER', payload: { sourceId, targetId } })
    }
  }

  const handleDragEnd = () => {
    document.querySelectorAll('.drag-over').forEach((el) =>
      el.classList.remove('drag-over')
    )
  }

  const toggleSelect = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const toggleSelectAll = () => {
    if (allSelectableSelected) {
      setSelectedIds([])
    } else {
      setSelectedIds([...selectableIds])
    }
  }

  const exitSelectionMode = () => {
    setSelectionMode(false)
    setSelectedIds([])
  }

  const batchComplete = () => {
    if (selectedIds.length === 0) return
    dispatch({ type: 'BATCH_COMPLETE', payload: selectedIds })
    if (settings.soundEnabled) playDing()
    showToast(`已完成 ${selectedIds.length} 项任务`, 'success')
    exitSelectionMode()
  }

  const batchUncomplete = () => {
    if (selectedIds.length === 0) return
    dispatch({ type: 'BATCH_UNCOMPLETE', payload: selectedIds })
    showToast(`已恢复 ${selectedIds.length} 项为未完成`, 'success')
    exitSelectionMode()
  }

  const batchSoftDelete = () => {
    if (selectedIds.length === 0) return
    dispatch({ type: 'BATCH_SOFT_DELETE', payload: selectedIds })
    showToast(`已清除 ${selectedIds.length} 项任务`, 'success')
    exitSelectionMode()
  }

  const batchPermanentlyDelete = () => {
    if (selectedIds.length === 0) return
    setPendingBatchDelete([...selectedIds])
  }

  const removeTag = (tag) => {
    dispatch({ type: 'REMOVE_TAG', payload: tag })
    if (tagFilter === tag) setTagFilter(null)
    showToast(`已删除标签“${tag}”`, 'success')
  }

  const runWindowAction = async (action) => {
    try {
      await window.desktopWindow?.[action]()
      if (action === 'hide' || action === 'quit') setShowCloseConfirmation(false)
    } catch (error) {
      console.error(`执行窗口操作 ${action} 失败：`, error)
      showToast('窗口操作失败，请重试', 'error')
    }
  }

  const confirmBatchPermanentlyDelete = () => {
    if (!pendingBatchDelete?.length) return
    dispatch({ type: 'BATCH_PERMANENTLY_DELETE', payload: pendingBatchDelete })
    showToast(`已彻底删除 ${pendingBatchDelete.length} 项任务`, 'success')
    setPendingBatchDelete(null)
    exitSelectionMode()
  }

  const batchSetPriority = () => {
    if (selectedIds.length === 0 || batchPriority === 'none') return
    dispatch({ type: 'BATCH_SET_PRIORITY', payload: { ids: selectedIds, priority: batchPriority } })
    showToast(`已将 ${selectedIds.length} 项设为${PRIORITY[batchPriority].label}优先级`, 'success')
    exitSelectionMode()
  }

  const handleExportJSON = () => {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      todos: todos.map((t) => ({
        id: t.id,
        text: t.text,
        done: t.done,
        priority: t.priority,
        dueDate: t.dueDate,
        tags: t.tags,
        createdAt: t.createdAt,
        completedAt: t.completedAt,
        deletedAt: t.deletedAt
      }))
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const now = new Date()
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    a.download = `todolist-backup-${ts}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast('JSON 数据已导出', 'success')
  }

  const handleExportCSV = () => {
    const csv = toCSV(todos.filter((t) => !t.deletedAt))
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const now = new Date()
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    a.download = `todolist-backup-${ts}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast('CSV 数据已导出', 'success')
  }

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleDownloadTemplate = () => {
    const csv = getCSVDownloadTemplate()
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'todolist-template.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast('模板已下载', 'success')
  }

  const confirmImport = (mode) => {
    const importedTodos = importPreview.todos
    if (mode === 'merge') {
      const existingIds = new Set(todos.map((t) => t.id))
      const merged = [...todos, ...importedTodos.filter((t) => !existingIds.has(t.id))]
      dispatch({ type: 'IMPORT', payload: merged })
      showToast(`已合并 ${importedTodos.length} 条任务`, 'success')
    } else {
      if (!confirm('确定要替换所有数据吗？当前数据将被覆盖！')) {
        setImportPreview(null)
        return
      }
      dispatch({ type: 'IMPORT', payload: importedTodos })
      showToast(`已导入 ${importedTodos.length} 条任务`, 'success')
    }
    setImportPreview(null)
  }

  const cancelImportPreview = () => {
    setImportPreview(null)
  }

  const handleImportFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const text = ev.target.result
        const isCSV = file.name.toLowerCase().endsWith('.csv') || (!file.name.toLowerCase().endsWith('.json') && text.startsWith('任务内容') || text.startsWith('id,text,'))
        let importedTodos = []
        if (isCSV) {
          importedTodos = parseCSV(text)
        } else {
          const data = JSON.parse(text)
          if (Array.isArray(data)) {
            importedTodos = data
          } else if (data.todos && Array.isArray(data.todos)) {
            importedTodos = data.todos
          } else {
            throw new Error('格式不正确')
          }
        }
        const valid = importedTodos.filter(
          (t) => t && typeof t.id === 'string' && typeof t.text === 'string'
        )
        if (valid.length === 0) {
          showToast('未找到有效任务数据', 'error')
          return
        }
        setImportPreview({ todos: valid, fileName: file.name })
      } catch (err) {
        showToast('导入失败：文件格式不正确', 'error')
      }
      e.target.value = ''
    }
    reader.readAsText(file)
  }

  const toggleSound = () => {
    setSettings((s) => ({ ...s, soundEnabled: !s.soundEnabled }))
    if (!settings.soundEnabled) playDing()
    showToast(settings.soundEnabled ? '已关闭音效' : '已开启音效', 'info')
  }

  const toggleExpiringNotifications = () => {
    const enabled = !settings.expiringNotifEnabled
    setSettings((current) => ({ ...current, expiringNotifEnabled: enabled }))
    showToast(enabled ? '已开启每日 10:00、16:00 到期提醒' : '已关闭到期提醒', 'info')
    if (enabled && notifPermission !== 'granted') requestNotifPermission()
  }

  const showOverdueTodos = () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const firstOverdueTodo = activeTodos.find((todo) => {
      if (todo.done || !todo.dueDate) return false
      const dueDate = new Date(todo.dueDate)
      dueDate.setHours(0, 0, 0, 0)
      return dueDate < today
    })
    if (firstOverdueTodo) jumpToTodo(firstOverdueTodo.id)
  }

  const dismissDueBanner = () => {
    setDueBannerDismissed(true)
  }

  return (
    <div className="app">
      <div className="window-titlebar">
        <div className="window-brand" aria-label="1296Todolist">
          <img className="window-brand-icon" src={appIconUrl} alt="" />
          <span>1296Todolist</span>
        </div>
        <div className="window-controls">
          <button
            className="window-control"
            onClick={() => runWindowAction('minimize')}
            aria-label="最小化"
            title="最小化"
          >
            −
          </button>
          <button
            className="window-control"
            onClick={() => runWindowAction('toggleMaximize')}
            aria-label="最大化或还原"
            title="最大化或还原"
          >
            □
          </button>
          <button
            className="window-control window-control-close"
            onClick={() => setShowCloseConfirmation(true)}
            aria-label="关闭"
            title="关闭"
          >
            ×
          </button>
        </div>
      </div>
      <h1>
        我的待办事项
        <div className="header-btns">
          <button
            className="theme-toggle"
            onClick={() => setDarkMode(!darkMode)}
            title={darkMode ? '切换到浅色模式' : '切换到深色模式'}
          >
            {darkMode ? '🌙' : '☀️'}
          </button>
          <button
            className={`sound-toggle ${!settings.soundEnabled ? 'muted' : ''}`}
            onClick={toggleSound}
            title={settings.soundEnabled ? '关闭音效' : '开启音效'}
          >
            📢
          </button>
          <button
            className={`sound-toggle ${!settings.expiringNotifEnabled ? 'muted' : ''}`}
            onClick={toggleExpiringNotifications}
            title={`${settings.expiringNotifEnabled ? '关闭' : '开启'}到期消息通知（每日 10:00、16:00）`}
            aria-label={`${settings.expiringNotifEnabled ? '关闭' : '开启'}到期消息通知`}
            aria-pressed={settings.expiringNotifEnabled}
          >
            🔔
          </button>
        </div>
      </h1>

      {(() => {
        const total = activeTodos.length
        const done = activeTodos.filter((t) => t.done).length
        const rate = total > 0 ? Math.round((done / total) * 100) : 0
        return (
          <div className="progress-bar-wrapper">
            <div className="progress-bar" style={{ width: `${rate}%` }} />
            <span className="progress-text">
              {done} / {total} 已完成
              <span className="progress-rate"> {rate}%</span>
            </span>
          </div>
        )
      })()}

      <Dashboard todos={activeTodos} onOverdueClick={showOverdueTodos} />

      {(dueTodayCount > 0 || overdueCount > 0) && !dueBannerDismissed && (
        <div className="notification-banner">
          <span className="notif-icon">🔔</span>
          <span className="notif-text">
            {overdueCount > 0 && <strong>{overdueCount}</strong>}
            {overdueCount > 0 ? ' 个任务已逾期' : ''}
            {overdueCount > 0 && dueTodayCount > 0 ? '，' : ''}
            {dueTodayCount > 0 && <strong>{dueTodayCount}</strong>}
            {dueTodayCount > 0 ? ' 个任务今天到期' : ''}
          </span>
          <div className="notif-actions">
            {notifPermission !== 'granted' && (
              <button className="notif-btn" onClick={requestNotifPermission}>
                开启通知
              </button>
            )}
            <button className="notif-close" onClick={dismissDueBanner}>✕</button>
          </div>
        </div>
      )}

      <div className="input-row">
        <input
          ref={inputRef}
          type="text"
          value={input}
          placeholder="需要做什么？ (Ctrl+Z 聚焦)"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyAdd}
          onFocus={() => input && setShowAddOptions(true)}
        />
        <button onClick={addTodo}>添加</button>
        <button
          className={`toggle-options-btn ${
            addPriority !== 'none' || addDueDate || addTags.trim() ? 'has-options' : ''
          }`}
          onClick={() => setShowAddOptions(!showAddOptions)}
          title="设置优先级/截止日期/标签"
        >
          {showAddOptions ? '✕ 收起' : '⚙ 设置'}
        </button>
      </div>

      {showAddOptions && (
        <div className="add-options">
          <div className="option-group">
            <label>优先级</label>
            <div className="priority-picker">
              {PRIORITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`priority-chip ${opt.value} ${addPriority === opt.value ? 'active' : ''}`}
                  onClick={() => setAddPriority(opt.value)}
                  style={addPriority === opt.value ? { borderColor: PRIORITY[opt.value].color } : {}}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="option-group">
            <label>截止日期</label>
            <input
              type="date"
              className="date-input"
              value={addDueDate}
              onChange={(e) => setAddDueDate(e.target.value)}
            />
          </div>
          <div className="option-group">
            <label>标签</label>
            <input
              type="text"
              className="tag-input"
              placeholder="用逗号分隔多个标签，如：工作, 紧急"
              value={addTags}
              onChange={(e) => setAddTags(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="toolbar">
        <div className="search-bar">
          <input
            ref={searchRef}
            type="text"
            placeholder="搜索任务... (Ctrl+/)"
            value={search}
            onChange={(e) => dispatch({ type: 'SET_SEARCH', payload: e.target.value })}
          />
          {search && (
            <button
              className="clear-search"
              onClick={() => dispatch({ type: 'SET_SEARCH', payload: '' })}
            >
              ×
            </button>
          )}
        </div>

        <div className="filters">
          <button
            className={filter === 'active' ? 'active' : ''}
            onClick={() => dispatch({ type: 'SET_FILTER', payload: 'active' })}
          >
            待办
          </button>
          <button
            className={filter === 'completed' ? 'active' : ''}
            onClick={() => dispatch({ type: 'SET_FILTER', payload: 'completed' })}
          >
            完工
          </button>
          <button
            className={filter === 'all' ? 'active' : ''}
            onClick={() => dispatch({ type: 'SET_FILTER', payload: 'all' })}
          >
            全部
          </button>
        </div>

        <div className="sort-control">
          <label>排序</label>
          <select
            value={sortBy}
            onChange={(e) => dispatch({ type: 'SET_SORT', payload: e.target.value })}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <button
          className={`selection-toggle ${selectionMode ? 'active' : ''}`}
          onClick={() => {
            setSelectionMode(!selectionMode)
            setSelectedIds([])
          }}
          title="批量操作"
        >
          {selectionMode ? '✓ 选择中' : '☑ 批量'}
        </button>
      </div>

      {selectionMode && (
        <div className="batch-toolbar">
          <span className="batch-count">已选 <strong>{selectedIds.length}</strong> 项</span>
          <div className="batch-actions">
            <button
              className="batch-btn"
              onClick={toggleSelectAll}
              title="全选/取消全选"
            >
              {allSelectableSelected ? '取消全选' : someSelected ? '全选' : '全选'}
            </button>
            <button
              className="batch-btn complete"
              onClick={batchComplete}
              disabled={selectedIds.length === 0}
            >
              批量完成
            </button>
            <button
              className="batch-btn uncomplete"
              onClick={batchUncomplete}
              disabled={selectedIds.length === 0}
            >
              批量取消完成
            </button>
            <div className="batch-priority">
              <select
                value={batchPriority}
                onChange={(e) => setBatchPriority(e.target.value)}
                disabled={selectedIds.length === 0}
              >
                <option value="none">设优先级</option>
                <option value="high">高优先级</option>
                <option value="medium">中优先级</option>
                <option value="low">低优先级</option>
              </select>
              <button
                className="batch-btn"
                onClick={batchSetPriority}
                disabled={selectedIds.length === 0 || batchPriority === 'none'}
              >
                应用
              </button>
            </div>
            <button
              className="batch-btn soft-delete"
              onClick={batchSoftDelete}
              disabled={selectedIds.length === 0}
            >
              批量清除
            </button>
            <button
              className="batch-btn hard-delete"
              onClick={batchPermanentlyDelete}
              disabled={selectedIds.length === 0}
            >
              彻底删除
            </button>
            <button className="batch-btn cancel" onClick={exitSelectionMode}>
              取消
            </button>
          </div>
        </div>
      )}

      {allTags.length > 0 ? (
        <div className="tag-filter-bar">
          <span className="tag-filter-label">标签筛选：</span>
          <button
            className={`tag-filter-chip ${tagFilter === null ? 'active' : ''}`}
            onClick={() => setTagFilter(null)}
          >
            全部
          </button>
          {allTags.map((tag) => (
            <span
              key={tag}
              className="tag-filter-pill"
            >
              <button
                className={`tag-filter-chip ${tagFilter === tag ? 'active' : ''}`}
                onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
              >
                {tag}
              </button>
              <button
                className="tag-filter-delete"
                onClick={() => removeTag(tag)}
                aria-label={`删除标签${tag}`}
                title={`删除标签“${tag}”及其所有任务关联`}
              >
                ×
              </button>
            </span>
          ))}
          <span className="tag-filter-hint">点击标签可筛选对应任务</span>
        </div>
      ) : (
        <div className="tag-filter-bar tag-filter-empty">
          <span className="tag-filter-hint">
            <span className="tag-tip-icon" aria-hidden="true">✦</span>
            <span>
              <strong>小提示</strong>
              <span>点击输入框旁的「设置」，即可为任务添加工作、学习等标签。</span>
            </span>
          </span>
        </div>
      )}

      {filtered.length === 0 && !(filter === 'all' && (activeItems.length > 0 || doneItems.length > 0 || deletedItems.length > 0)) ? (
        <div className="empty">
          <EmptyStateSVG type={search || tagFilter ? 'all' : filter} />
          <span className="empty-text">
            {search || tagFilter
              ? '没有匹配的任务'
              : EMPTY_MESSAGES[filter]}
          </span>
        </div>
      ) : (
        <ul className="todo-list">
          {filter === 'all' ? (
            <>
              {activeItems.map((todo) => (
                <TodoItemView
                  key={todo.id}
                  todo={todo}
                  editingId={editingId}
                  editingText={editingText}
                  editingMeta={editingMeta}
                  onEditingTextChange={setEditingText}
                  onStartEdit={startEdit}
                  onCommitEdit={commitEdit}
                  onCancelEdit={cancelEdit}
                  onDelete={(id) => dispatch({ type: 'PERMANENTLY_DELETE', payload: id })}
                  onSoftDelete={(id) => dispatch({ type: 'SOFT_DELETE', payload: id })}
                  onUpdate={updateMeta}
                  onToggleDone={handleToggleDone}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                  isDraggable={sortBy === 'manual' && !selectionMode}
                  selectionMode={selectionMode}
                  isSelected={selectedIds.includes(todo.id)}
                  onToggleSelect={toggleSelect}
                  completedAnimId={completedAnimId}
                />
              ))}

              {activeItems.length > 0 && doneItems.length > 0 && (
                <li className="section-divider">
                  <span>已完成</span>
                </li>
              )}

              {doneItems.map((todo) => (
                <TodoItemView
                  key={todo.id}
                  todo={todo}
                  editingId={editingId}
                  editingText={editingText}
                  editingMeta={editingMeta}
                  onEditingTextChange={setEditingText}
                  onStartEdit={startEdit}
                  onCommitEdit={commitEdit}
                  onCancelEdit={cancelEdit}
                  onDelete={(id) => dispatch({ type: 'PERMANENTLY_DELETE', payload: id })}
                  onSoftDelete={(id) => dispatch({ type: 'SOFT_DELETE', payload: id })}
                  onUpdate={updateMeta}
                  onToggleDone={handleToggleDone}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                  isDraggable={sortBy === 'manual' && !selectionMode}
                  selectionMode={selectionMode}
                  isSelected={selectedIds.includes(todo.id)}
                  onToggleSelect={toggleSelect}
                  completedAnimId={completedAnimId}
                />
              ))}

              {deletedItems.length > 0 && (
                <li className="section-divider">
                  <span>已清除（保留 30 天）</span>
                </li>
              )}

              {deletedItems.map((todo) => (
                <li key={todo.id} className="todo-item deleted">
                  {selectionMode && (
                    <input
                      type="checkbox"
                      className="selection-checkbox"
                      checked={selectedIds.includes(todo.id)}
                      onChange={() => toggleSelect(todo.id)}
                    />
                  )}
                  <input type="checkbox" checked={false} disabled readOnly />
                  <span className="todo-text">
                    {todo.text}
                    <span className="deleted-tag">
                      已清除 · {formatRelative(todo.deletedAt)}
                    </span>
                  </span>
                  {todo.priority !== 'none' && (
                    <span
                      className="priority-mini"
                      style={{ background: PRIORITY[todo.priority].color }}
                    />
                  )}
                  <div className="meta-row">
                    {todo.dueDate && (
                      <span className="due-date">📅 {todo.dueDate}</span>
                    )}
                    {todo.tags && todo.tags.map((tag) => (
                      <span key={tag} className="tag-chip">{tag}</span>
                    ))}
                  </div>
                  <div className="actions">
                    <button
                      className="restore-btn"
                      onClick={() => dispatch({ type: 'RESTORE', payload: todo.id })}
                    >
                      恢复
                    </button>
                    <button
                      className="delete-btn"
                      onClick={() => dispatch({ type: 'PERMANENTLY_DELETE', payload: todo.id })}
                    >
                      彻底删除
                    </button>
                  </div>
                </li>
              ))}
            </>
          ) : (
            filtered.map((todo) => (
              <TodoItemView
                key={todo.id}
                todo={todo}
                editingId={editingId}
                editingText={editingText}
                editingMeta={editingMeta}
                onEditingTextChange={setEditingText}
                onStartEdit={startEdit}
                onCommitEdit={commitEdit}
                onCancelEdit={cancelEdit}
                onDelete={(id) => dispatch({ type: 'PERMANENTLY_DELETE', payload: id })}
                onSoftDelete={(id) => dispatch({ type: 'SOFT_DELETE', payload: id })}
                onUpdate={updateMeta}
                onToggleDone={handleToggleDone}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
                isDraggable={sortBy === 'manual' && !selectionMode}
                selectionMode={selectionMode}
                isSelected={selectedIds.includes(todo.id)}
                onToggleSelect={toggleSelect}
                completedAnimId={completedAnimId}
              />
            ))
          )}
        </ul>
      )}

      <div className="footer">
        <span className="count">
          还剩 <span className="num">{activeCount}</span> 项待办
        </span>
        <div className="footer-right">
          {filter === 'all' && deletedCount > 0 && (
            <span className="deleted-info">
              {deletedCount} 条已清除记录（30 天后自动删除）
            </span>
          )}
          {completedCount > 0 && (
            <button
              className="clear-btn"
              onClick={() => dispatch({ type: 'CLEAR_COMPLETED' })}
            >
              清除已完成 ({completedCount})
            </button>
          )}
          <div className="import-export-bar">
            <div className="export-group">
              <button className="ie-btn" onClick={handleExportJSON} title="导出 JSON 备份">
                ⬇ JSON
              </button>
              <button className="ie-btn" onClick={handleExportCSV} title="导出 CSV（可用 Excel 打开）">
                ⬇ CSV
              </button>
            </div>
            <button className="ie-btn" onClick={handleDownloadTemplate} title="下载 CSV 模板文件">
              📋 模板
            </button>
            <button className="ie-btn ie-btn-primary" onClick={handleImportClick} title="从 JSON 或 CSV 导入">
              ⬆ 导入
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.csv,application/json,text/csv"
              style={{ display: 'none' }}
              onChange={handleImportFile}
            />
          </div>
        </div>
      </div>

      {toast && (
        <div className={`toast toast-${toast.type}`} key={toast.id}>
          {toast.message}
        </div>
      )}

      {pendingBatchDelete && (
        <div className="modal-overlay">
          <div
            className="modal-content confirmation-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-confirm-title"
            aria-describedby="delete-confirm-description"
          >
            <div className="modal-header">
              <h2 id="delete-confirm-title">⚠️ 确认彻底删除</h2>
            </div>
            <div className="modal-body confirmation-body">
              <p id="delete-confirm-description">
                确定要彻底删除选中的 <strong>{pendingBatchDelete.length}</strong> 项任务吗？
              </p>
              <p>删除后将从本机保存的任务数据中移除，且无法恢复。</p>
            </div>
            <div className="modal-footer">
              <button className="modal-btn cancel" onClick={() => setPendingBatchDelete(null)}>
                取消
              </button>
              <button className="modal-btn danger" onClick={confirmBatchPermanentlyDelete}>
                彻底删除
              </button>
            </div>
          </div>
        </div>
      )}

      {showCloseConfirmation && (
        <div className="modal-overlay close-confirm-overlay">
          <div
            className="modal-content close-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-confirm-title"
            aria-describedby="close-confirm-description"
          >
            <div className="modal-header close-confirm-header">
              <span className="close-confirm-icon" aria-hidden="true">↘</span>
              <div>
                <h2 id="close-confirm-title">关闭 1296Todolist</h2>
                <p id="close-confirm-description">选择关闭窗口后的处理方式</p>
              </div>
              <button
                className="modal-close"
                onClick={() => setShowCloseConfirmation(false)}
                aria-label="取消关闭"
              >
                ×
              </button>
            </div>
            <div className="close-confirm-options">
              <button
                className="close-option close-option-tray"
                onClick={() => runWindowAction('hide')}
              >
                <span className="close-option-icon" aria-hidden="true">▣</span>
                <span>
                  <strong>隐藏到系统托盘</strong>
                  <small>继续在后台运行任务提醒</small>
                </span>
                <span className="close-option-arrow" aria-hidden="true">›</span>
              </button>
              <button
                className="close-option close-option-quit"
                onClick={() => runWindowAction('quit')}
              >
                <span className="close-option-icon" aria-hidden="true">⏻</span>
                <span>
                  <strong>退出软件</strong>
                  <small>关闭后台运行，任务提醒将停止</small>
                </span>
                <span className="close-option-arrow" aria-hidden="true">›</span>
              </button>
            </div>
            <div className="close-confirm-footer">
              <button
                className="close-confirm-cancel"
                onClick={() => setShowCloseConfirmation(false)}
              >
                继续使用
              </button>
            </div>
          </div>
        </div>
      )}

      {showNotificationGuide && (
        <div className="modal-overlay notification-guide-overlay">
          <div
            className="modal-content notification-guide-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="notification-guide-title"
          >
            <div className="modal-header">
              <h2 id="notification-guide-title">🔔 开启任务到期桌面提醒</h2>
            </div>
            <div className="modal-body notification-guide-body">
              <p>Windows 安装程序无法代替你授予通知权限。请在首次启动后允许本应用发送桌面通知。</p>
              <p>未完成任务将在到期前 5 天、2 天、12 小时和 1 小时各提醒一次。任务截止时刻按所选日期当天 10:00 计算；勾选完成后将停止后续提醒。</p>
              <p>开启到期消息通知后，每日 10:00、16:00 会推送 24 小时内即将到期的任务；点击通知可直接定位到对应任务。可通过标题栏铃铛开关此配置。</p>
              <p>如果系统通知仍未显示，请打开 Windows 通知设置，并允许“1296Todolist”发送通知。</p>
            </div>
            <div className="modal-footer notification-guide-footer">
              <button className="modal-btn cancel" onClick={dismissNotificationGuide}>
                稍后设置
              </button>
              <button className="modal-btn cancel" onClick={openNotificationSettings}>
                打开 Windows 通知设置
              </button>
              <button className="modal-btn merge" onClick={requestNotifPermission}>
                允许桌面通知
              </button>
              <button className="modal-btn merge" onClick={completeNotificationGuide}>
                完成设置
              </button>
            </div>
          </div>
        </div>
      )}

      {importPreview && (
        <div className="modal-overlay" onClick={cancelImportPreview}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>📥 导入预览</h2>
              <button className="modal-close" onClick={cancelImportPreview}>✕</button>
            </div>
            <div className="modal-body">
              <p className="import-summary">
                文件 <strong>{importPreview.fileName}</strong> 解析成功，共检测到{' '}
                <strong className="highlight">{importPreview.todos.length}</strong> 条任务：
              </p>
              <div className="preview-table-wrapper">
                <table className="preview-table">
                  <thead>
                    <tr>
                      <th className="col-text">任务内容</th>
                      <th className="col-priority">优先级</th>
                      <th className="col-date">截止日期</th>
                      <th className="col-tags">标签</th>
                      <th className="col-done">完成</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.todos.slice(0, 50).map((t) => (
                      <tr key={t.id}>
                        <td className="col-text">{t.text}</td>
                        <td className="col-priority">
                          <span className={`pri-tag pri-${t.priority}`}>
                            {PRIORITY[t.priority]?.label || '无'}
                          </span>
                        </td>
                        <td className="col-date">
                          {t.dueDate || <span className="empty">—</span>}
                        </td>
                        <td className="col-tags">
                          {t.tags?.length > 0 ? (
                            <span className="tags-cell">
                              {t.tags.map((tag) => (
                                <span key={tag} className="tag-chip">{tag}</span>
                              ))}
                            </span>
                          ) : (
                            <span className="empty">—</span>
                          )}
                        </td>
                        <td className="col-done">
                          {t.done ? <span className="done-badge">✓ 已完成</span> : <span className="undone-badge">○ 未完成</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {importPreview.todos.length > 50 && (
                  <p className="more-hint">仅预览前 50 条，导入将包含全部 {importPreview.todos.length} 条</p>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="modal-btn cancel" onClick={cancelImportPreview}>取消</button>
              <button className="modal-btn merge" onClick={() => confirmImport('merge')}>
                合并到现有数据
              </button>
              <button className="modal-btn replace" onClick={() => confirmImport('replace')}>
                替换所有数据
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="shortcuts-hint">
        <span>快捷键：</span>
        <kbd>Ctrl</kbd>+<kbd>Z</kbd> 聚焦输入
        <kbd>Ctrl</kbd>+<kbd>/</kbd> 搜索
        <kbd>Ctrl</kbd>+<kbd>Enter</kbd> 提交
        <kbd>Esc</kbd> 取消
      </div>
    </div>
  )
}

function TodoItemView({
  todo,
  editingId,
  editingText,
  onEditingTextChange,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onDelete,
  onSoftDelete,
  onUpdate,
  onToggleDone,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  isDraggable,
  selectionMode,
  isSelected,
  onToggleSelect,
  completedAnimId
}) {
  const dueStatus = todo.dueDate ? getDueDateStatus(todo.dueDate) : null
  const isEditing = editingId === todo.id
  const showCompleteAnim = completedAnimId === todo.id

  return (
    <li
      data-todo-id={todo.id}
      className={`todo-item${todo.done ? ' done' : ''} ${isDraggable ? 'draggable' : ''} ${
        selectionMode ? 'selectable' : ''
      } ${isSelected ? 'selected' : ''} ${showCompleteAnim ? 'just-completed' : ''}`}
      draggable={isDraggable && !todo.done}
      onDragStart={() => onDragStart(todo.id)}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, todo.id)}
      onDragEnd={onDragEnd}
      style={
        todo.priority !== 'none'
          ? { borderLeft: `4px solid ${PRIORITY[todo.priority].color}` }
          : {}
      }
    >
      {selectionMode && !todo.deletedAt && (
        <input
          type="checkbox"
          className="selection-checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(todo.id)}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      <input
        type="checkbox"
        className="todo-checkbox"
        checked={todo.done}
        onChange={() => onToggleDone(todo)}
      />
      {showCompleteAnim && <span className="complete-flash" />}
      {isEditing ? (
        <input
          className="todo-text editing"
          value={editingText}
          autoFocus
          onChange={(e) => onEditingTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommitEdit()
            if (e.key === 'Escape') onCancelEdit()
          }}
          onBlur={onCommitEdit}
        />
      ) : (
        <span
          className="todo-text"
          onDoubleClick={() => !selectionMode && onStartEdit(todo)}
          onClick={() => {
            if (selectionMode && !todo.deletedAt) onToggleSelect(todo.id)
          }}
        >
          {todo.text}
        </span>
      )}

      {!todo.done && !todo.deletedAt && (
        <div className="inline-meta">
          {dueStatus && (
            <span className={`due-date status-${dueStatus.level}`}>
              📅 {todo.dueDate}
              <span className="due-sub">{dueStatus.text}</span>
            </span>
          )}
          {todo.tags && todo.tags.map((tag) => (
            <span key={tag} className="tag-chip">{tag}</span>
          ))}
        </div>
      )}

      <div className="meta-actions">
        <select
          className={`priority-select priority-${todo.priority}`}
          value={todo.priority}
          onChange={(e) => onUpdate(todo, { priority: e.target.value })}
          title="优先级"
        >
          {PRIORITY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <input
          type="date"
          className="date-mini"
          value={todo.dueDate || ''}
          onChange={(e) => onUpdate(todo, { dueDate: e.target.value || null })}
          title="截止日期"
        />
      </div>

      <div className="actions">
        <button className="edit-btn" onClick={() => onStartEdit(todo)} title="编辑">
          编辑
        </button>
        <button
          className="delete-btn"
          onClick={() => onSoftDelete(todo.id)}
          title="清除（保留 30 天）"
        >
          清除
        </button>
        <button
          className="hard-delete-btn"
          onClick={() => onDelete(todo.id)}
          title="彻底删除"
        >
          删除
        </button>
      </div>
    </li>
  )
}