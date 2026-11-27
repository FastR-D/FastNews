import { test, expect } from '@playwright/test'
test('private reports unlock after login and catalog reloads without stale authorization errors', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('heading', { name: '登录 FastNews' })).toBeVisible()
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain(
    'HarmonyOS Sans SC',
  )
  await page.screenshot({ path: 'test-results/login.png', animations: 'disabled' })
  await page.getByLabel('邮箱', { exact: true }).fill('browser-test@example.com')
  await page.getByLabel('密码', { exact: true }).fill('browser-test-password-123')
  await page.getByRole('form', { name: '本地账号' }).locator('button[type=submit]').click()
  await expect(page.getByRole('heading', { name: '研究工作台', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '顶会报告', exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  const response = await page.request.get('/api/papers?pageSize=1')
  expect(response.status()).toBe(200)
  await page.goto('/login')
  await page.getByRole('button', { name: '账号菜单', exact: true }).click()
  await page.getByRole('menuitem', { name: '退出登录', exact: true }).click()
  await expect(page.getByLabel('邮箱', { exact: true })).toBeVisible()
  expect((await page.request.get('/api/catalog')).status()).toBe(401)
})

test('private entry shows only login and preserves the requested page', async ({ page }) => {
  await page.goto('/sources/')
  await expect(page).toHaveURL(/login\?next=/)
  await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0)
  await expect(page.getByTestId('source-card')).toHaveCount(0)
  expect((await page.request.get('/api/sources')).status()).toBe(401)
  await page.getByLabel('邮箱', { exact: true }).fill('browser-test@example.com')
  await page.getByLabel('密码', { exact: true }).fill('browser-test-password-123')
  await page.getByRole('form', { name: '本地账号' }).locator('button[type=submit]').click()
  await expect(page).toHaveURL(/\/sources\//)
  await expect(page.getByTestId('source-card').first()).toBeVisible()
  await expect(page.getByText('BBC World', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('contentinfo')).toHaveCount(0)
  await expect(page.getByRole('link', { name: '探索研究方向', exact: true })).toHaveCount(0)
  await page.screenshot({ path: 'test-results/private-sources.png', animations: 'disabled' })
})

test('page spacing and dark navigation are consistent', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('邮箱', { exact: true }).fill('browser-test@example.com')
  await page.getByLabel('密码', { exact: true }).fill('browser-test-password-123')
  await page.getByRole('form', { name: '本地账号' }).locator('button[type=submit]').click()
  await expect(page.getByRole('heading', { name: '研究工作台', exact: true })).toBeVisible()
  let left: number | undefined
  for (const path of ['/', '/secnews/', '/sources/', '/top-conf/', '/field-briefing/']) {
    await page.goto(path)
    const heading = page.locator('#main-content h1').first()
    await expect(heading).toBeVisible()
    const box = await heading.boundingBox()
    expect(box).not.toBeNull()
    if (left === undefined) left = box!.x
    expect(Math.abs(box!.x - left)).toBeLessThan(1)
    await expect(heading.locator('svg')).toHaveCount(0)
    await expect(page.getByRole('contentinfo')).toHaveCount(0)
  }
  await page.getByRole('button', { name: '切换深色模式' }).click()
  const selected = page.getByRole('navigation', { name: '主导航' }).locator('[aria-current="page"]')
  await expect(selected).toHaveCSS('color', 'rgb(217, 226, 255)')
  await page.screenshot({ path: 'test-results/private-dark.png', animations: 'disabled' })
})

test('administrator workspace manages users in a table and dialogs', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('邮箱', { exact: true }).fill('browser-admin@example.com')
  await page.getByLabel('密码', { exact: true }).fill('browser-test-password-123')
  await page.getByRole('form', { name: '本地账号' }).locator('button[type=submit]').click()
  await page.getByRole('link', { name: '用户管理', exact: true }).click()
  const table = page.getByRole('table', { name: '用户列表' })
  await expect(table).toContainText('browser-test@example.com')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: '创建用户', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '创建用户' })
  const email = `new-member-${Date.now()}@example.com`
  await dialog.getByLabel('邮箱', { exact: true }).fill(email)
  await dialog.getByLabel('姓名', { exact: true }).fill('新研究员')
  await dialog.getByLabel('初始密码', { exact: true }).fill('new-member-password-12345')
  await dialog.getByLabel('操作原因', { exact: true }).fill('浏览器回归测试')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(table).toContainText(email)
  await page.getByLabel('搜索用户').fill(email)
  await expect(table.locator('tbody tr')).toHaveCount(1)
  await page.getByRole('button', { name: '编辑 新研究员', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '编辑用户' })
  await dialog.getByLabel('状态', { exact: true }).selectOption('disabled')
  await dialog.getByLabel('操作原因', { exact: true }).fill('测试停用')
  await page.screenshot({
    path: '../output/ui-review/admin-user-dialog.png',
    animations: 'disabled',
  })
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(table).toContainText('停用')
  await page.getByLabel('搜索用户').fill('')
  await page.screenshot({ path: '../output/ui-review/admin-users.png', animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBeTruthy()
  await page.screenshot({
    path: '../output/ui-review/admin-users-mobile.png',
    animations: 'disabled',
  })
})

test('administrator can monitor, stop and inspect collection failures', async ({ page }) => {
  const entry = {
    source: 'test_feed',
    name: '研究团队',
    state: 'running',
    fetched: 0,
    added: 0,
    stale: 0,
    error: '',
  }
  const run = {
    id: 'test-run',
    trigger: 'manual',
    selection: 'ai',
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: '',
    sources: [entry],
    error: '',
  }
  const schedule = {
    enabled: true,
    intervalHours: 6,
    source: 'all',
    nextRunAt: new Date(Date.now() + 6 * 3600000).toISOString(),
  }
  let runs: (typeof run)[] = []
  await page.route('**/api/admin/collection**', async (route) => {
    if (route.request().method() === 'POST') {
      if (route.request().url().endsWith('/schedule')) {
        Object.assign(schedule, route.request().postDataJSON())
        await route.fulfill({ json: schedule })
        return
      }
      if (route.request().url().endsWith('/cancel')) {
        run.status = 'cancelled'
        run.finishedAt = new Date().toISOString()
        entry.state = 'cancelled'
      } else {
        expect(route.request().postDataJSON()).toEqual({ source: 'ai' })
        runs = [run]
      }
      await route.fulfill({ status: 202, json: run })
    } else
      await route.fulfill({
        json: {
          runs,
          schedule,
          schedulerRunning: true,
          sources: [{ id: 'test_feed', name: '研究团队', channel: 'ai' }],
        },
      })
  })
  await page.goto('/login')
  await page.getByLabel('邮箱', { exact: true }).fill('browser-admin@example.com')
  await page.getByLabel('密码', { exact: true }).fill('browser-test-password-123')
  await page.getByRole('form', { name: '本地账号' }).locator('button[type=submit]').click()
  await page.getByRole('link', { name: '进程管理', exact: true }).click()
  await expect(page.getByText('暂无采集任务', { exact: true })).toBeVisible()
  await expect(page.getByText('每 6 小时', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '修改计划', exact: true }).click()
  const plan = page.getByRole('dialog', { name: '采集计划' })
  await plan.getByLabel('采集频率', { exact: true }).selectOption('3')
  await plan.getByRole('button', { name: '保存计划', exact: true }).click()
  await expect(page.getByText('每 3 小时', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '暂停定时采集', exact: true }).click()
  await expect(page.getByText('已暂停', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '恢复定时采集', exact: true }).click()
  await expect(page.getByText('已启用', { exact: true })).toBeVisible()
  await page.getByLabel('采集范围', { exact: true }).selectOption('ai')
  await page.getByRole('button', { name: '开始采集', exact: true }).click()
  await expect(page.getByRole('button', { name: '开始采集', exact: true })).toBeDisabled()
  await expect(page.getByRole('progressbar', { name: '采集进度' })).toHaveAttribute('max', '1')
  await expect(page.getByRole('table', { name: '信源结果' })).toContainText('研究团队')
  await page.screenshot({ path: '../output/ui-review/admin-processes.png', animations: 'disabled' })
  await page.getByRole('button', { name: '详情', exact: true }).click()
  await expect(page.getByRole('table', { name: '信源结果' })).toHaveCount(0)
  await page.getByRole('button', { name: '详情', exact: true }).click()
  await expect(page.getByRole('table', { name: '信源结果' })).toBeVisible()
  await page.getByRole('button', { name: '停止采集', exact: true }).click()
  await expect(page.getByRole('table', { name: '采集任务' })).toContainText('已停止')
  await expect(page.getByRole('button', { name: '开始采集', exact: true })).toBeEnabled()
  run.trigger = 'scheduled'
  run.status = 'partial'
  run.error = '部分信源暂时不可用'
  entry.state = 'failed'
  entry.error = 'HTTP 503'
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(page.getByRole('table', { name: '信源结果' })).toContainText('HTTP 503')
  await expect(page.getByRole('table', { name: '采集任务' })).toContainText('定时采集')
  await page.getByRole('button', { name: '切换深色模式' }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBeTruthy()
  await page.screenshot({
    path: '../output/ui-review/admin-processes-mobile-dark.png',
    animations: 'disabled',
  })
})

test('account settings contain editable profile and FastCAS only', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('邮箱', { exact: true }).fill('browser-test@example.com')
  await page.getByLabel('密码', { exact: true }).fill('browser-test-password-123')
  await page.getByRole('form', { name: '本地账号' }).locator('button[type=submit]').click()
  await page.getByRole('button', { name: '账号菜单', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'CAS 认证', exact: true })).toHaveCount(0)
  await page.getByRole('menuitem', { name: '账号设置', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'FastCAS 认证', exact: true })).toBeVisible()
  await expect(page.getByText(/FastRead 联动|Research 内容连接|Research Key|连接码/)).toHaveCount(0)
  const form = page.getByRole('form', { name: '账号信息' })
  await form.getByLabel('姓名', { exact: true }).fill('更新后的研究者')
  await form.getByLabel('当前密码', { exact: true }).fill('browser-test-password-123')
  await form.getByRole('button', { name: '保存账号信息', exact: true }).click()
  await expect(page.getByText('账号信息已更新', { exact: true })).toBeVisible()
  await page.reload()
  await expect(form.getByLabel('姓名', { exact: true })).toHaveValue('更新后的研究者')
  await expect(form.getByLabel('当前密码', { exact: true })).toHaveValue('')
  await page.screenshot({
    path: '../output/ui-review/account-settings.png',
    animations: 'disabled',
  })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBeTruthy()
  await page.screenshot({
    path: '../output/ui-review/account-settings-mobile.png',
    animations: 'disabled',
  })
})

test('administrator queues directory candidates and removes them from the persistent queue', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByLabel('邮箱', { exact: true }).fill('browser-admin@example.com')
  await page.getByLabel('密码', { exact: true }).fill('browser-test-password-123')
  await page.getByRole('form', { name: '本地账号' }).locator('button[type=submit]').click()
  await page.getByRole('link', { name: '信源目录', exact: true }).click()
  const card = page
    .getByTestId('source-card')
    .filter({ has: page.getByRole('heading', { name: 'CVE Program' }) })
  await card.getByRole('button', { name: '将CVE Program纳入采集队列' }).click()
  const dialog = page.getByRole('dialog', { name: '纳入采集', exact: true })
  await expect(dialog.getByRole('button', { name: '确认纳入' })).toBeDisabled()
  await dialog.getByRole('radio', { name: /直连/ }).check()
  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(card.getByRole('button', { name: '将CVE Program纳入采集队列' })).toBeEnabled()
  await card.getByRole('button', { name: '将CVE Program纳入采集队列' }).click()
  await dialog.getByRole('radio', { name: /新加坡/ }).check()
  await dialog.getByRole('button', { name: '确认纳入' }).click()
  await expect(dialog.getByRole('alert')).toContainText('新加坡采集尚未配置')
  await expect(dialog.getByRole('radio', { name: /新加坡/ })).toBeChecked()
  await dialog.getByRole('radio', { name: /直连/ }).check()
  await dialog.getByRole('button', { name: '确认纳入' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(card.getByRole('button', { name: '将CVE Program移除采集' })).toHaveText('移除采集')
  await page.reload()
  await expect(card.getByRole('button', { name: '将CVE Program移除采集' })).toBeEnabled()
  await page.getByRole('link', { name: '进程管理', exact: true }).click()
  const table = page.getByRole('table', { name: '采集队列', exact: true })
  await expect(table).toContainText('CVE Program')
  await expect(table).toContainText('待接入采集接口')
  await table.getByRole('button', { name: '移出队列' }).click()
  await expect(table).toHaveCount(0)
})

test('administrator can disable a configured subscription and preserve the change after reload', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByLabel('邮箱', { exact: true }).fill('browser-admin@example.com')
  await page.getByLabel('密码', { exact: true }).fill('browser-test-password-123')
  await page.getByRole('form', { name: '本地账号' }).locator('button[type=submit]').click()
  await page.getByRole('link', { name: '信源目录', exact: true }).click()
  const card = page
    .getByTestId('source-card')
    .filter({ has: page.getByRole('heading', { name: 'Hugging Face Blog', exact: true }) })
  await card.getByRole('button', { name: '将Hugging Face Blog移除采集' }).click()
  await expect(card.getByRole('button', { name: '将Hugging Face Blog纳入采集队列' })).toBeEnabled()
  await page.reload()
  await expect(card).toContainText('已停用')
  await expect(card.getByRole('button', { name: '将Hugging Face Blog纳入采集队列' })).toBeEnabled()
})
