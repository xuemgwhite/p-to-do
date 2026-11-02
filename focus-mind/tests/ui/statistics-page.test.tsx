import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatisticsService } from '../../src/application/StatisticsService'
import { PreviewRepository } from '../../src/infrastructure/preview/PreviewRepository'
import { StatisticsPage } from '../../src/ui/statistics/StatisticsPage'

const now = new Date('2026-08-01T12:00:00+08:00')

describe('StatisticsPage period navigation', () => {
  it('moves between months and Monday-based weeks', async () => {
    const repository = new PreviewRepository({
      themes: [], goals: [], tasks: [], occurrences: [], focusSessions: [],
    })
    render(<StatisticsPage statisticsService={new StatisticsService(repository)} now={() => now} />)

    expect(await screen.findByText('2026年 8月')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '上一月' }))
    expect(await screen.findByText('2026年 7月')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '下一月' }))
    expect(await screen.findByText('2026年 8月')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '周' }))
    expect(await screen.findByText('7月27日 – 8月2日')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '上一周' }))
    expect(await screen.findByText('7月20日 – 7月26日')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '下一周' }))
    expect(await screen.findByText('7月27日 – 8月2日')).toBeInTheDocument()
  })

  it('moves between individual days', async () => {
    const repository = new PreviewRepository({
      themes: [], goals: [], tasks: [], occurrences: [], focusSessions: [],
    })
    render(<StatisticsPage statisticsService={new StatisticsService(repository)} now={() => now} />)

    fireEvent.click(await screen.findByRole('button', { name: '日' }))
    expect(await screen.findByText('2026年 8月1日 星期六')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '上一日' }))
    expect(await screen.findByText('2026年 7月31日 星期五')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '下一日' }))
    expect(await screen.findByText('2026年 8月1日 星期六')).toBeInTheDocument()
    expect(screen.getByText('当日每小时')).toBeInTheDocument()
    expect(screen.getByText('小时均')).toBeInTheDocument()
  })

  it('exposes previous and next year controls in year mode', async () => {
    const repository = new PreviewRepository({
      themes: [], goals: [], tasks: [], occurrences: [], focusSessions: [],
    })
    render(<StatisticsPage statisticsService={new StatisticsService(repository)} now={() => now} />)

    fireEvent.click(await screen.findByRole('button', { name: '年' }))
    expect(await screen.findByText('2026年')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上一年' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一年' })).toBeInTheDocument()
  })
})
