import { expect, test, type Page } from '@playwright/test'

test('creates planning entities and exposes schedule and timer preview workflows', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))

  await page.goto('/?now=2026-07-18T12:00:00%2B08:00')
  await expect(page.getByText('预览模式')).toBeVisible()
  const sidebar = page.getByRole('complementary', { name: '应用侧栏' })
  const initialSidebarBox = await sidebar.boundingBox()
  expect(initialSidebarBox).not.toBeNull()

  await createEntity(page, '主题', '验收主题')
  await selectSortable(page, '选择主题 验收主题')
  await createEntity(page, '目标', '验收目标')
  await selectSortable(page, '选择目标 验收目标')
  await createTask(page, '普通任务', 'none')
  await createTask(page, '每日任务', 'daily')
  await createTask(page, '每周任务', 'weekly_quota')
  await expect(page.getByText('普通任务', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '每日任务' }).locator('xpath=ancestor::article')).toContainText('每天')
  await expect(page.getByRole('heading', { name: '每周任务' }).locator('xpath=ancestor::article')).toContainText('每周 2 次')

  await page.getByRole('button', { name: '开始 每日任务' }).click()
  await expect(page.getByRole('button', { name: '结束 每日任务' })).toBeVisible()
  await setPreviewNow(page, '2026-07-18T12:30:00+08:00')
  await page.getByRole('button', { name: '结束 每日任务' }).click()
  await page.getByRole('checkbox', { name: '完成 每日任务' }).click()
  await expect(page.getByRole('checkbox', { name: '恢复 每日任务' })).toBeChecked()

  await page.getByRole('checkbox', { name: '完成 普通任务' }).click()
  const completion = page.getByRole('dialog', { name: '完成任务' })
  await completion.getByLabel('开始时刻').fill('10:00')
  await completion.getByLabel('完成时刻').fill('10:30')
  await completion.getByRole('button', { name: '确认完成' }).click()
  await expect(page.getByRole('checkbox', { name: '恢复 普通任务' })).toBeChecked()

  const weeklyCard = page.getByRole('heading', { name: '每周任务' }).locator('xpath=ancestor::article')
  await weeklyCard.click({ button: 'right' })
  await page.getByRole('button', { name: '删除任务' }).click()
  const deletion = page.getByRole('dialog', { name: '确认删除任务' })
  await expect(deletion).toContainText('任务 1')
  await expect(deletion).toContainText('实例')
  await deletion.getByRole('button', { name: '取消' }).click()

  await page.getByRole('button', { name: '日程' }).click()
  await expect(page.getByRole('heading', { name: /7月18日/ })).toBeVisible()
  expect(await sidebar.boundingBox()).toEqual(initialSidebarBox)
  await page.getByRole('button', { name: '开始 完成产品原型' }).click()
  await setPreviewNow(page, '2026-07-18T13:00:00+08:00')
  await page.getByRole('button', { name: '结束 完成产品原型' }).click()
  await page.getByRole('button', { name: '周', exact: true }).click()
  await expect(page.getByRole('button', { name: '周', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '月', exact: true }).click()
  await expect(page.getByRole('button', { name: '月', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: /专注记录 完成产品原型 12:30/ }).click()
  const sessionDialog = page.getByRole('dialog', { name: '编辑专注记录' })
  await sessionDialog.getByLabel('开始时间').fill('2026-07-18T12:35')
  await sessionDialog.getByLabel('结束时间').fill('2026-07-18T12:55')
  await sessionDialog.getByRole('button', { name: '保存记录' }).click()
  await expect(sessionDialog).toBeHidden()

  await page.getByRole('button', { name: '计时', exact: true }).click()
  await expect(page.getByRole('region', { name: '计时控制' })).toBeVisible()
  await expect(page.getByRole('region', { name: '计时控制' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: '今日专注记录' })).toBeVisible()
  expect(await sidebar.boundingBox()).toEqual(initialSidebarBox)
  await expect(page.getByRole('button', { name: /开始计时|结束计时/ })).toBeVisible()
  await page.getByRole('button', { name: '日程', exact: true }).click()
  await expect(page.getByRole('button', { name: '日程', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByLabel('日程视图')).toBeVisible()
  expect(await sidebar.boundingBox()).toEqual(initialSidebarBox)
  expect(browserErrors).toEqual([])
})

async function createEntity(page: Page, kind: '主题' | '目标', name: string) {
  await page.getByRole('button', { name: `新增${kind}` }).click()
  const dialog = page.getByRole('dialog', { name: `新增${kind}` })
  await dialog.getByLabel('名称').fill(name)
  await dialog.getByRole('button', { name: '保存' }).click()
  await expect(dialog).toBeHidden()
}

async function selectSortable(page: Page, accessibleName: string) {
  const button = page.getByRole('button', { name: accessibleName })
  await button.focus()
  await button.press('Enter')
  await expect(button).toHaveAttribute('aria-pressed', 'true')
}

async function setPreviewNow(page: Page, value: string) {
  await page.evaluate((now) => {
    const url = new URL(window.location.href)
    url.searchParams.set('now', now)
    window.history.replaceState({}, '', url)
  }, value)
}

async function createTask(page: Page, name: string, recurrence: 'none' | 'daily' | 'weekly_quota') {
  await page.getByRole('button', { name: '新增任务' }).click()
  const dialog = page.getByRole('dialog', { name: '新增任务' })
  await dialog.getByLabel('名称').fill(name)
  await dialog.getByLabel('重复类型').selectOption(recurrence)
  if (recurrence === 'weekly_quota') await dialog.getByLabel('每周次数').fill('2')
  await dialog.getByRole('button', { name: '保存' }).click()
  await expect(dialog).toBeHidden()
}
