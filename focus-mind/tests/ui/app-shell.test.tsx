import '@testing-library/jest-dom/vitest'
import { act } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { App } from '../../src/app/App'
import { bootstrapApplication } from '../../src/app/bootstrap'
import { PreviewDesktopPort } from '../../src/infrastructure/preview/PreviewDesktopPort'
import { TauriDesktopPort } from '../../src/infrastructure/tauri/TauriDesktopPort'

it('shows preview mode only in browser preview', async () => {
  render(<App runtimeMode="preview" />)

  expect(screen.getByText('预览模式')).toBeInTheDocument()
  expect(await screen.findByText('日程')).toBeInTheDocument()
  expect(screen.getByText('计时')).toBeInTheDocument()
})

it('opens schedule and timer from the visible navigation', async () => {
  render(<App runtimeMode="preview" />)

  const navigation = await screen.findByRole('navigation', { name: '主导航' })
  expect(screen.getAllByRole('navigation', { name: '主导航' })).toHaveLength(1)
  expect(screen.getByTitle('日程图标')).toBeInTheDocument()
  expect(screen.getByTitle('计时图标')).toBeInTheDocument()

  fireEvent.click(within(navigation).getByRole('button', { name: '日程' }))
  expect(await screen.findByRole('heading', { name: /星期/ })).toBeInTheDocument()
  expect(screen.getAllByRole('navigation', { name: '主导航' })).toHaveLength(1)
  expect(screen.getByRole('button', { name: '日程' })).toHaveAttribute('aria-current', 'page')

  fireEvent.click(screen.getByRole('button', { name: '计时' }))
  expect(await screen.findByRole('region', { name: '计时控制' })).toBeInTheDocument()
  expect(screen.getAllByRole('navigation', { name: '主导航' })).toHaveLength(1)
  expect(screen.getByRole('button', { name: '计时' })).toHaveAttribute('aria-current', 'page')
})

it('does not show preview mode in the Tauri shell', async () => {
  render(<App runtimeMode={new TauriDesktopPort().mode} />)

  await screen.findByText('日程')
  expect(screen.queryByText('预览模式')).not.toBeInTheDocument()
})

it('boots the browser preview with the preview desktop port', async () => {
  document.body.innerHTML = '<div id="root"></div>'

  await act(async () => { bootstrapApplication(new PreviewDesktopPort()) })

  expect(await screen.findByText('预览模式')).toBeInTheDocument()
})

it('rejects desktop-only backup actions in browser preview', async () => {
  const desktopPort = new PreviewDesktopPort()

  await expect(desktopPort.createDailyBackup()).rejects.toThrow('浏览器预览')
  await expect(desktopPort.exportBackup()).rejects.toThrow('浏览器预览')
  await expect(desktopPort.importBackup()).rejects.toThrow('浏览器预览')
})
