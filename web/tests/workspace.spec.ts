import { test, expect, type Page } from '@playwright/test'
import type { NewsArticle } from '../src/types'
test('coverage navigation and filters show actual local evidence counts', async ({
  page,
  baseURL,
}, info) => {
  const response = await page.request.get(route(baseURL, 'api/coverage'))
  expect(response.ok()).toBeTruthy()
  const { conferences } = await response.json()
  expect(conferences.length).toBeGreaterThan(0)
  await visit(page, baseURL, '')
  if (info.project.name === 'mobile') await page.getByRole('button', { name: '打开导航' }).click()
  await page.getByRole('link', { name: '数据覆盖', exact: true }).click()
  await expect(page.getByRole('heading', { name: '数据覆盖', level: 1 })).toBeVisible()
  await expect(page.getByTestId('coverage-row')).toHaveCount(conferences.length)
  const first = conferences[0]
  await expect(
    page.getByRole('progressbar', { name: `${first.name} ${first.year} 原始摘要`, exact: true }),
  ).toHaveAttribute('value', String(first.abstracts))
  await expect(
    page.getByRole('progressbar', { name: `${first.name} ${first.year} 有效总结`, exact: true }),
  ).toHaveAttribute('value', String(first.summaries))
  await page.getByLabel('覆盖会议', { exact: true }).selectOption(first.conference)
  await expect(page.getByTestId('coverage-row')).toHaveCount(
    conferences.filter((row: { conference: string }) => row.conference === first.conference).length,
  )
  await page.reload()
  await expect(page.getByLabel('覆盖会议', { exact: true })).toHaveValue(first.conference)
  await page.getByRole('button', { name: '刷新覆盖率', exact: true }).click()
  await expect(
    page.getByRole('progressbar', { name: `${first.name} ${first.year} 原始摘要`, exact: true }),
  ).toHaveAttribute('max', String(Math.max(first.papers, 1)))
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBeTruthy()
})
const route = (baseURL: string | undefined, p: string) =>
  new URL(p.replace(/^\//, ''), baseURL!.replace(/\/?$/, '/')).href
test('conference panorama uses the full selected corpus instead of a saved personal topic', async ({
  page,
  baseURL,
}) => {
  await login(page, baseURL)
  await page.getByRole('button', { name: '个人印象', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '个人印象' })
  await dialog.getByLabel('研究印象', { exact: true }).fill('Software testing and coding agents')
  await dialog.getByRole('button', { name: '保存印象', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const catalog = await (await page.request.get(route(baseURL, 'api/catalog'))).json()
  await visit(page, baseURL, 'summary-brief/')
  const response = page.waitForResponse(
    (item) => item.url().endsWith('/api/summary-brief') && item.request().method() === 'POST',
  )
  await page.getByRole('button', { name: '会议论文全景', exact: true }).click()
  const result = await response
  expect(result.ok()).toBeTruthy()
  expect(result.request().postDataJSON().query).toBe('')
  expect(result.request().postDataJSON().impression).toBe('')
  expect((await result.json()).stats.sample_size).toBe(catalog.topPapers)
})
async function visit(page: Page, baseURL: string | undefined, path: string) {
  await page.goto(route(baseURL, path))
}
async function login(page: Page, baseURL: string | undefined) {
  await visit(page, baseURL, 'login')
  await page.getByLabel('邮箱', { exact: true }).fill('browser-test@example.com')
  await page.getByLabel('密码', { exact: true }).fill('browser-test-password-123')
  await page.getByRole('form', { name: '本地账号' }).locator('button[type=submit]').click()
  await expect(page.getByText('当前账号', { exact: true })).toBeVisible()
}
test('research trends rank the selected archive and expose original evidence', async ({
  page,
  baseURL,
}, info) => {
  const response = await page.request.get(route(baseURL, 'api/trend?scope=ai&days=30'))
  expect(response.ok()).toBeTruthy()
  const trend = await response.json()
  expect(trend.topics.length).toBeGreaterThan(0)
  await visit(page, baseURL, '/')
  if (info.project.name === 'mobile') await page.getByRole('button', { name: '打开导航' }).click()
  await page.getByRole('link', { name: '研究趋势', exact: true }).click()
  await expect(page.getByRole('heading', { name: '研究趋势', level: 1 })).toBeVisible()
  const ranking = page.getByRole('list', { name: '研究方向排名' })
  const leader = ranking.locator('summary').first()
  await expect(leader).toContainText(trend.topics[0].label)
  await leader.click()
  await expect(
    ranking.getByRole('link', { name: trend.topics[0].evidence[0].title }),
  ).toHaveAttribute('href', trend.topics[0].evidence[0].url)
  if (trend.comparable) {
    await page.getByLabel('排序').selectOption('growth')
    const fastest = [...trend.topics].sort((left, right) => right.change - left.change)[0]
    await expect(leader).toContainText(fastest.label)
  }
  await page.getByLabel('研究领域').selectOption('security')
  await page.getByLabel('统计窗口').selectOption('14')
  await page.reload()
  await expect(page.getByLabel('研究领域')).toHaveValue('security')
  await expect(page.getByLabel('统计窗口')).toHaveValue('14')
  await expect(page.getByText('本期样本', { exact: true })).toBeVisible()
})

test('arXiv navigation, dated corpus, fields, pagination and reading use real API records', async ({
  page,
  baseURL,
}, info) => {
  await login(page, baseURL)
  const catalog = await (await page.request.get(route(baseURL, 'api/catalog'))).json()
  let date = ''
  let articles: { source: string; title: string; categories?: string[] }[] = []
  for (const candidate of catalog.dates) {
    const response = await (
      await page.request.get(route(baseURL, `api/news?date=${candidate}`))
    ).json()
    if (
      response.articles.filter((article: { source: string }) =>
        article.source.toLowerCase().includes('arxiv'),
      ).length > 12
    ) {
      date = candidate
      articles = response.articles
      break
    }
  }
  const papers = articles.filter((article) => article.source.toLowerCase().includes('arxiv'))
  expect(papers.length).toBeGreaterThan(12)
  if (info.project.name === 'mobile') await page.getByRole('button', { name: '打开导航' }).click()
  await page.getByRole('link', { name: 'arXiv 导读', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'arXiv 最新导读', level: 1 })).toBeVisible()
  const latestArxiv = await (await page.request.get(route(baseURL, 'api/news?source=arxiv'))).json()
  await expect(page.getByLabel('采集日期', { exact: true })).toHaveValue(latestArxiv.date)
  await page.getByLabel('采集日期', { exact: true }).selectOption(date)
  await expect(page.getByTestId('paper-row')).toHaveCount(12)
  await expect(page.getByTestId('paper-row').first()).toContainText(papers[0].title)
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.getByTestId('paper-row').first()).toContainText(papers[12].title)
  await page.reload()
  await expect(page.getByRole('button', { name: '2', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  const category = papers.find((article: { categories?: string[] }) => article.categories?.length)
    ?.categories[0]
  expect(category).toBeTruthy()
  await page.getByLabel('论文领域', { exact: true }).selectOption(category)
  const matching = papers.filter((article: { categories?: string[] }) =>
    article.categories?.includes(category),
  )
  await expect(page.getByTestId('paper-row')).toHaveCount(Math.min(12, matching.length))
  await expect(page.getByTestId('paper-row').first()).toContainText(matching[0].title)
  expect(new URL(page.url()).searchParams.get('page')).toBeNull()
  const handoff = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/fastread') && response.request().method() === 'POST',
  )
  await page.getByTestId('paper-row').first().getByRole('button', { name: '跳转 FastRead' }).click()
  expect((await handoff).status()).toBe(409)
  const nextDate = catalog.dates[1]
  await page.getByLabel('采集日期', { exact: true }).selectOption(nextDate)
  expect(new URL(page.url()).searchParams.get('category')).toBeNull()
  const next = await (await page.request.get(route(baseURL, `api/news?date=${nextDate}`))).json()
  const nextPapers = next.articles.filter((article: { source: string }) =>
    article.source.toLowerCase().includes('arxiv'),
  )
  await expect(page.getByTestId('paper-row')).toHaveCount(Math.min(12, nextPapers.length))
  await page.reload()
  await expect(page.getByLabel('采集日期', { exact: true })).toHaveValue(nextDate)
  await visit(page, baseURL, `secnews/?date=${date}`)
  await page.getByRole('button', { name: '查看全部详情', exact: true }).click()
  await expect(page.getByTestId('news-row')).toHaveCount(articles.length - papers.length)
  await expect(page.getByRole('button', { name: 'arXiv', exact: true })).toHaveCount(0)
})
test('all old entries, real catalog, downloads, calendar, theme and responsive layout', async ({
  page,
  baseURL,
}, info) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await visit(page, baseURL, '')
  await expect(page.getByRole('heading', { name: '安全研究报告工作台' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '顶会报告', exact: true })).toBeVisible()
  const catalogResponse = await page.request.get(route(baseURL, 'api/catalog'))
  const catalog = await catalogResponse.json()
  const latestResponse = await page.request.get(route(baseURL, `api/news?date=${catalog.dates[0]}`))
  const { articles } = await latestResponse.json()
  const latest = page.getByRole('region', { name: '最新快讯', exact: true })
  for (const article of articles.slice(0, 5)) {
    await expect(
      latest.getByRole('link', { name: article.title_zh || article.title, exact: true }),
    ).toHaveAttribute('href', article.link)
  }
  await expect(latest.getByRole('link', { name: '查看全部资讯' })).toHaveAttribute(
    'href',
    `${new URL(baseURL!).pathname}secnews/?date=${catalog.dates[0]}`,
  )
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
  await expect(page.getByTestId('paper-row').first()).toBeVisible()
  await page.getByLabel('会议', { exact: true }).selectOption('usenix')
  await page.getByLabel('年份', { exact: true }).selectOption('2025')
  await expect(page.getByTestId('paper-row').first()).toContainText('USENIX Security')
  await expect(page.getByTestId('paper-row').first()).toContainText('2025')
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.getByRole('button', { name: '2', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  const download = page.getByTestId('report-row').locator('h3 a').first()
  const response = await page.request.get(
    ((await download.getAttribute('href')) || '') + '?download=1',
  )
  expect(response.status()).toBe(200)
  expect(response.headers()['content-disposition']).toContain('attachment')
  await visit(page, baseURL, 'secnews/')
  const latestSecurity = await (
    await page.request.get(route(baseURL, 'api/news?source=security'))
  ).json()
  await expect(
    page.getByRole('heading', { name: `${latestSecurity.date} · 每日资讯`, exact: true }),
  ).toBeVisible()
  await expect(page.getByTestId('news-row').first()).toBeVisible()
  await page.getByRole('button', { name: '上个月' }).click()
  await expect(page.getByTestId('calendar')).toBeVisible()
  await visit(page, baseURL, 'field-briefing/')
  await page.getByLabel('研究方向', { exact: true }).fill('LLM jailbreak')
  const generation = page.waitForResponse(
    (response) =>
      response.url() === route(baseURL, 'api/field-briefing') &&
      response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: '生成导读', exact: true }).click()
  expect((await generation).ok()).toBeTruthy()
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
  await page.mouse.click(1, 1)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('研究印象', { exact: true })).toHaveValue(
    `LLM prompt injection ${info.project.name}`,
  )
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
  await editor.getByRole('button', { name: '取消', exact: true }).click()
  await expect(editor).not.toBeVisible()
  await page.getByRole('button', { name: '添加作者', exact: true }).click()
  await editor.getByRole('button', { name: '关闭编辑', exact: true }).click()
  await expect(editor).not.toBeVisible()
  await page.getByRole('button', { name: '添加作者', exact: true }).click()
  await editor.getByLabel('姓名', { exact: true }).fill(`Alice ${info.project.name}`)
  await page.mouse.click(1, 1)
  await expect(editor).toBeVisible()
  await expect(editor.getByLabel('姓名', { exact: true })).toHaveValue(`Alice ${info.project.name}`)
  await editor.getByLabel('主页链接', { exact: true }).fill('http://127.0.0.1:9')
  await editor.getByLabel('ML/AI Security', { exact: true }).check()
  await editor.getByRole('button', { name: '保存作者' }).click()
  await expect(editor).not.toBeVisible()
  await expect(
    page.getByTestId('author-row').filter({ hasText: `Alice ${info.project.name}` }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByTestId('author-row').filter({ hasText: `Alice ${info.project.name}` }),
  ).toBeVisible()
  await visit(page, baseURL, 'inbox/')
  await expect(page.getByTestId('paper-row').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: '今日推送', exact: true })).toBeVisible()
  await expect(page.getByTestId('paper-row')).toHaveCount(1)
  await visit(page, baseURL, 'login')
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByLabel('邮箱', { exact: true })).toBeVisible()
  await visit(page, baseURL, 'authors')
  await expect(page.getByText('登录后管理个人内容', { exact: true })).toBeVisible()
})

test('author UI shows pending and saved homepage results and survives report tabs and folding', async ({
  page,
  baseURL,
}, info) => {
  await login(page, baseURL)
  await visit(page, baseURL, '')
  await page.getByRole('button', { name: '添加作者', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '新增作者' })
  await expect(editor.getByText(/目前不会按标签自动过滤/)).toBeVisible()
  const name = `Homepage ${info.project.name}`
  await editor.getByLabel('姓名', { exact: true }).fill(name)
  await editor.getByLabel('主页链接', { exact: true }).fill('https://example.com/author')
  await editor.getByLabel('Software Security', { exact: true }).check()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  // This case verifies UI handling and real local persistence. Homepage parsing
  // itself is outside this browser scenario's claim.
  await page.route('**/api/authors/preview', async (route) => {
    await gate
    await route.fulfill({
      json: {
        title: 'Research homepage',
        description: 'Selected research links',
        papers: [{ url: 'https://arxiv.org/abs/2401.00001', title: 'Saved paper' }],
      },
    })
  })
  await editor.getByRole('button', { name: '保存作者' }).click()
  const row = page.getByTestId('author-row').filter({ hasText: name })
  await expect(row.getByRole('progressbar')).toBeVisible()
  await expect(row.getByRole('status')).toContainText('正在抓取并解析')
  release()
  await expect(row.getByRole('status')).toContainText('主页解析完成，已保存 1 个论文链接')
  for (const tab of ['安全资讯周报', '全部下载', '顶会报告']) {
    await page.getByRole('tab', { name: new RegExp(tab) }).click()
    await expect(row).toBeVisible()
  }
  await page.locator('summary').filter({ hasText: '浏览报告与下载' }).click()
  await expect(page.getByRole('tabpanel')).not.toBeVisible()
  await expect(row).toBeVisible()
  await page.reload()
  await expect(row).toContainText('Selected research links')
  await row.locator('summary').click()
  await expect(row.getByRole('link', { name: 'Saved paper' })).toHaveAttribute(
    'href',
    'https://arxiv.org/abs/2401.00001',
  )
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
  await expect(page.getByRole('link', { name: '返回报告工作台' })).toHaveAttribute(
    'href',
    new URL(baseURL!).pathname,
  )
  const secondCategory = page.locator('section.category').nth(1)
  await expect(secondCategory.locator('details')).not.toHaveAttribute('open')
  await secondCategory.locator('summary').click()
  await expect(secondCategory.locator('details')).toHaveAttribute('open')
  await secondCategory.locator('summary').click()
  await page.goto(route(baseURL, report.html) + '#cat-2')
  await expect(secondCategory.locator('details')).toHaveAttribute('open')
  await page.getByRole('button', { name: '回到顶部', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
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

test('FastUI report tabs support keyboard selection, filtering and downloads', async ({
  page,
  baseURL,
}) => {
  await visit(page, baseURL, '')
  const tabs = page.getByRole('tab')
  await expect(tabs).toHaveCount(3)
  await tabs.nth(0).focus()
  await page.keyboard.press('ArrowRight')
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'weekly')
  await page.keyboard.press('End')
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true')
  const search = page.getByLabel('搜索报告', { exact: true })
  await search.fill('USENIX')
  const reports = page.getByRole('tabpanel').getByTestId('report-row')
  await expect(reports.first()).toContainText('USENIX')
  await expect(reports.first().getByRole('link', { name: /下载.*HTML/ })).toHaveAttribute(
    'href',
    /\?download=1$/,
  )
  await search.fill('no-matching-report-xyz')
  await expect(page.getByRole('tabpanel').getByText('暂无报告')).toBeVisible()
  await search.clear()
  await expect(reports.first()).toBeVisible()
})

test('workspace navigation collapses on desktop and opens as a FastUI dialog on mobile', async ({
  page,
  baseURL,
  isMobile,
}) => {
  await visit(page, baseURL, '')
  if (isMobile) {
    const trigger = page.getByRole('button', { name: '打开导航', exact: true })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: '工作空间导航' })
    await expect(dialog).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await dialog.getByRole('link', { name: '安全资讯', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(
      page.getByRole('heading', { name: '安全资讯', exact: true, level: 1 }),
    ).toBeVisible()
    await trigger.click()
    await page.getByRole('button', { name: '关闭导航' }).click()
    await expect(trigger).toBeFocused()
  } else {
    await page.getByRole('button', { name: '隐藏总览栏' }).click()
    await expect(page.getByRole('complementary', { name: '工作空间', exact: true })).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: '快捷导航' })).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('button', { name: '打开总览栏' })).toBeVisible()
    await page.getByRole('button', { name: '打开总览栏' }).click()
    await expect(page.getByRole('complementary', { name: '工作空间', exact: true })).toBeVisible()
  }
})

test('paper filters survive reload and global search updates an already-open paper page', async ({
  page,
  baseURL,
  isMobile,
}) => {
  await visit(page, baseURL, 'top-conf/')
  await page.getByLabel('会议', { exact: true }).selectOption('usenix')
  await page.getByLabel('年份', { exact: true }).selectOption('2025')
  await expect(page).toHaveURL(/conference=usenix.*year=2025/)
  await page.reload()
  await expect(page.getByLabel('会议', { exact: true })).toHaveValue('usenix')
  await expect(page.getByLabel('年份', { exact: true })).toHaveValue('2025')
  await page.getByLabel('搜索论文', { exact: true }).fill('privacy')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(page).toHaveURL(/q=privacy/)
  if (!isMobile) {
    await page.getByLabel('全站论文搜索', { exact: true }).fill('LLM')
    await page.getByRole('button', { name: '提交全站搜索' }).click()
    await expect(page.getByLabel('搜索论文', { exact: true })).toHaveValue('LLM')
    await expect(page).toHaveURL(/top-conf\/\?q=LLM$/)
  }
  await page.getByRole('button', { name: '清除筛选' }).click()
  await expect(page.getByLabel('搜索论文', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('会议', { exact: true })).toHaveValue('')
  await expect(page.getByTestId('paper-row').first()).toBeVisible()
})

test('news recommendations use stored scores and show unscored records honestly', async ({
  page,
  baseURL,
}) => {
  const catalog = await (await page.request.get(route(baseURL, 'api/catalog'))).json()
  let date = ''
  let articles: NewsArticle[] = []
  const storedScore = (article: NewsArticle) =>
    article.recommendation_score ?? article.importance ?? article.score
  const hasScore = (article: NewsArticle) => {
    const score = storedScore(article)
    return typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 10
  }
  for (const candidate of catalog.dates) {
    const response = await (
      await page.request.get(route(baseURL, `api/news?date=${candidate}`))
    ).json()
    const news: NewsArticle[] = response.articles.filter(
      (article: NewsArticle) => !article.source.toLowerCase().includes('arxiv'),
    )
    if (news.some((article) => !hasScore(article))) {
      date = candidate
      articles = news
      break
    }
  }
  expect(date).not.toBe('')
  await visit(page, baseURL, `secnews/?date=${date}`)
  const scored = articles.filter(hasScore)
  await expect(page.getByTestId('news-row')).toHaveCount(
    Math.min(10, scored.length || articles.length),
  )
  if (scored.length) {
    for (const row of await page.getByTestId('news-row').all()) {
      const link = await row.locator('h3 a').getAttribute('href')
      expect(scored.some((article) => article.link === link)).toBeTruthy()
    }
  }
  await page.getByRole('button', { name: '查看全部详情', exact: true }).click()
  await expect(page.getByTestId('news-row')).toHaveCount(articles.length)
  for (const row of await page.getByTestId('news-row').all()) {
    const link = await row.locator('h3 a').getAttribute('href')
    const article = articles.find((article) => article.link === link)!
    expect(article).toBeTruthy()
    if (hasScore(article)) {
      await expect(row).toContainText(`价值 ${storedScore(article)!.toFixed(1)}`)
    } else {
      await expect(row).toContainText('尚未评分')
      await expect(row).not.toContainText(/价值 \d/)
    }
  }
})
