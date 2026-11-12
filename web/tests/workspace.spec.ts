import { test, expect, type Page } from '@playwright/test'
const route = (baseURL: string | undefined, p: string) =>
  new URL(p.replace(/^\//, ''), baseURL!.replace(/\/?$/, '/')).href
async function visit(page: Page, baseURL: string | undefined, path: string) {
  await page.goto(route(baseURL, path))
}
async function login(page: Page, baseURL: string | undefined) {
  await visit(page, baseURL, 'login')
  await page.getByLabel('邮箱', { exact: true }).fill('browser-test@example.com')
  await page.getByLabel('密码', { exact: true }).fill('browser-test-password-123')
  await page.locator('button[type=submit]').click()
  await expect(page.getByText('当前账号', { exact: true })).toBeVisible()
}
test('all old entries, real catalog, downloads, calendar, theme and responsive layout', async ({
  page,
  baseURL,
}, info) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await visit(page, baseURL, '')
  await expect(page.getByRole('heading', { name: '安全研究报告工作台' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '顶会报告', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '切换深色模式' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-fastui-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-fastui-theme', 'dark')
  await page.getByRole('button', { name: '切换浅色模式' }).click()
  for (const [path, title] of [
    ['top-conf/index.html', '顶会论文总结'],
    ['field-briefing/index.html', '领域导读'],
    ['summary-brief/index.html', '总结汇报'],
    ['secnews/index.html', '安全资讯'],
    ['inbox/index.html', '私信'],
  ]) {
    await visit(page, baseURL, path)
    await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBeTruthy()
  }
  await visit(page, baseURL, 'top-conf/')
  await expect(page.locator('.paper-row').first()).toBeVisible()
  await page.getByLabel('会议', { exact: true }).selectOption('usenix')
  await page.getByLabel('年份', { exact: true }).selectOption('2025')
  await expect(page.locator('.paper-row').first()).toContainText('USENIX Security')
  await expect(page.locator('.paper-row').first()).toContainText('2025')
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.getByRole('button', { name: '2', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  const download = page.locator('.report-row h3 a').first()
  const response = await page.request.get(
    ((await download.getAttribute('href')) || '') + '?download=1',
  )
  expect(response.status()).toBe(200)
  expect(response.headers()['content-disposition']).toContain('attachment')
  await visit(page, baseURL, 'secnews/')
  await expect(page.locator('.news-row').first()).toBeVisible()
  await page.getByRole('button', { name: '上个月' }).click()
  await expect(page.locator('.calendar')).toBeVisible()
  await visit(page, baseURL, 'field-briefing/')
  await page.getByLabel('研究方向', { exact: true }).fill('LLM jailbreak')
  await page.getByRole('button', { name: '生成导读', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('本地证据整理')
  await expect(page.getByRole('heading', { name: '高相关论文推荐', exact: true })).toBeVisible()
  await visit(page, baseURL, '')
  await page.screenshot({ path: `test-results/${info.project.name}-home.png`, fullPage: true })
  expect(errors).toEqual([])
})
test('local login, impression, authors, inbox and logout persist across reloads', async ({
  page,
  baseURL,
}, info) => {
  await login(page, baseURL)
  await page.getByRole('button', { name: '个人印象', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '个人印象' })
  await dialog
    .getByLabel('研究印象', { exact: true })
    .fill(`LLM prompt injection ${info.project.name}`)
  await dialog.getByRole('button', { name: '保存印象' }).click()
  await expect(dialog).not.toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '个人印象', exact: true }).click()
  await expect(page.getByLabel('研究印象', { exact: true })).toHaveValue(
    `LLM prompt injection ${info.project.name}`,
  )
  await page.getByRole('button', { name: '关闭个人印象', exact: true }).click()
  await visit(page, baseURL, 'authors')
  await page.getByRole('button', { name: '添加作者', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '新增作者' })
  await editor.getByLabel('姓名', { exact: true }).fill(`Alice ${info.project.name}`)
  await editor.getByLabel('主页链接', { exact: true }).fill('http://127.0.0.1:9')
  await editor.getByLabel('ML/AI Security', { exact: true }).check()
  await editor.getByRole('button', { name: '保存作者' }).click()
  await expect(editor).not.toBeVisible()
  await expect(
    page.locator('.author-row').filter({ hasText: `Alice ${info.project.name}` }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.locator('.author-row').filter({ hasText: `Alice ${info.project.name}` }),
  ).toBeVisible()
  await visit(page, baseURL, 'inbox/')
  await expect(page.locator('.paper-row').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: '今日推送', exact: true })).toBeVisible()
  await expect(page.locator('.paper-row')).toHaveCount(1)
  await visit(page, baseURL, 'login')
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByLabel('邮箱', { exact: true })).toBeVisible()
  await visit(page, baseURL, 'authors')
  await expect(page.getByText('登录后管理个人内容', { exact: true })).toBeVisible()
})

test('historical report uses maintained handoff assets and the correct API prefix', async ({
  page,
  baseURL,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const response = await page.request.get(route(baseURL, 'api/reports'))
  expect(response.ok()).toBeTruthy()
  const { reports } = await response.json()
  const report = reports.find((item: { html: string }) =>
    item.html.endsWith('USENIX_2025_Report.html'),
  )
  expect(report).toBeTruthy()
  const resourceResponses: number[] = []
  page.on('response', (resource) => {
    if (/\/assets\/fastread\.(js|css)$/.test(resource.url()))
      resourceResponses.push(resource.status())
  })
  await page.route('**/api/fastread', async (request) => {
    expect(request.request().url()).toBe(route(baseURL, 'api/fastread'))
    expect(request.request().method()).toBe('POST')
    expect(request.request().postDataJSON().title.length).toBeGreaterThan(0)
    await request.fulfill({ status: 409, json: { error: '阅读授权需要连接 Research' } })
  })
  await visit(page, baseURL, report.html)
  await expect(page.locator('button[data-fastread]').first()).toBeVisible()
  await page.locator('button[data-fastread]').first().click()
  await expect(page.getByRole('alert')).toHaveText('阅读授权需要连接 Research')
  await expect(page.locator('button[data-fastread]').first()).toBeEnabled()
  expect(resourceResponses.sort()).toEqual([200, 200])
  expect(errors).toEqual([])
})

test('subpath application accepts independent-domain root and login entries', async ({
  page,
  baseURL,
}, info) => {
  test.skip(info.project.name !== 'subpath', 'Only the prefixed build needs entry canonicalization')
  const origin = new URL(baseURL!).origin
  await page.goto(origin + '/?date=2026-09-04#reports')
  await expect(page).toHaveURL(origin + '/news/?date=2026-09-04#reports')
  await expect(page.getByRole('heading', { name: '安全研究报告工作台', exact: true })).toBeVisible()
  await page.goto(origin + '/login?from=entry')
  await expect(page).toHaveURL(origin + '/news/login?from=entry')
  await expect(page.getByLabel('邮箱', { exact: true })).toBeVisible()
})
