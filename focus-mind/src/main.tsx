import { bootstrapApplication, bootstrapQuickTasks } from './app/bootstrap'

const quickTasksWindow = new URLSearchParams(window.location.search).get('window') === 'quick-tasks'
if (quickTasksWindow) document.documentElement.classList.add('quick-tasks-document')
void (quickTasksWindow ? bootstrapQuickTasks() : bootstrapApplication()).catch(renderStartupError)

function renderStartupError(error: unknown) {
  const container = document.getElementById('root')
  if (!container) return

  const panel = document.createElement('main')
  panel.className = 'startup-error'
  const title = document.createElement('h1')
  title.textContent = '土豆栗丝特启动失败'
  const description = document.createElement('p')
  description.textContent = error instanceof Error ? error.message : '发生未知错误，请重新启动应用。'
  panel.append(title, description)
  container.replaceChildren(panel)
}
