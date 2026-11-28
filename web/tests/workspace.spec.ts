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
  await visit(page, baseURL, 'summary/')
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
  await expect(page.getByRole('heading', { name: '研究工作台', exact: true })).toBeVisible()
  await visit(page, baseURL, 'login')
  await expect(page.getByRole('heading', { name: '账号信息', exact: true })).toBeVisible()
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
  await page
    .getByRole('navigation', { name: '主导航', exact: true })
    .getByRole('link', { name: '研究趋势', exact: true })
    .click()
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
  expect(latestArxiv.articles.length).toBeLessThanOrEqual(12)
  expect(latestArxiv.total).toBeGreaterThan(12)
  await expect(page.getByLabel('采集日期', { exact: true })).toHaveValue(latestArxiv.date)
  await page.getByLabel('采集日期', { exact: true }).fill(date)
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
  await page.route('http://127.0.0.1:3015/**', (request) => request.fulfill({ status: 204 }))
  await page.getByTestId('paper-row').first().getByRole('button', { name: '跳转 FastRead' }).click()
  const handed = await handoff
  expect(handed.status()).toBe(200)
  const destination = await handed.json()
  expect(destination.redirect).toContain('#fastnews=')
  expect(destination.redirect).not.toContain('sso=')
  expect(destination.paper.title).toBe(matching[0].title)
  const nextDate = catalog.dates[1]
  await page.getByLabel('采集日期', { exact: true }).fill(nextDate)
  expect(new URL(page.url()).searchParams.get('category')).toBeNull()
  const next = await (await page.request.get(route(baseURL, `api/news?date=${nextDate}`))).json()
  const nextPapers = next.articles.filter((article: { source: string }) =>
    article.source.toLowerCase().includes('arxiv'),
  )
  await expect(page.getByTestId('paper-row')).toHaveCount(Math.min(12, nextPapers.length))
  await page.reload()
  await expect(page.getByLabel('采集日期', { exact: true })).toHaveValue(nextDate)
  await visit(page, baseURL, `arxiv/?date=${date}&page=2`)
  await expect(page.getByRole('button', { name: '2', exact: true })).toBeVisible()
  await page.getByLabel('搜索 arXiv 论文', { exact: true }).fill(papers[12].title)
  await page.getByRole('button', { name: '搜索论文', exact: true }).click()
  await expect(page.getByTestId('paper-row').first()).toContainText(papers[12].title)
  expect(new URL(page.url()).searchParams.get('page')).toBeNull()
  await page.reload()
  await expect(page.getByLabel('搜索 arXiv 论文', { exact: true })).toHaveValue(papers[12].title)
  await page.getByLabel('搜索 arXiv 论文', { exact: true }).fill('no-match-unique-keyword')
  await page.getByRole('button', { name: '搜索论文', exact: true }).click()
  await expect(page.getByTestId('paper-row')).toHaveCount(0)
  await expect(page.getByText('当天暂无匹配的 arXiv 论文', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '清除论文搜索', exact: true }).click()
  await expect(page.getByTestId('paper-row')).toHaveCount(12)
  if (info.project.name !== 'mobile') {
    const controls = await page.locator('.arxiv-toolbar > *').evaluateAll((nodes) =>
      nodes.map((node) => {
        const r = node.getBoundingClientRect()
        return r.y + r.height / 2
      }),
    )
    expect(Math.max(...controls) - Math.min(...controls)).toBeLessThan(2)
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBeTruthy()
  await page.screenshot({
    path: `../output/ui-review/${info.project.name}-arxiv-toolbar.png`,
    animations: 'disabled',
  })
  await visit(page, baseURL, `updates/?date=${date}`)
  await page.getByRole('button', { name: '全部资讯', exact: true }).click()
  await expect(page.getByTestId('news-row')).toHaveCount(
    Math.min(20, articles.length - papers.length),
  )
  await expect(page.getByRole('button', { name: 'arXiv', exact: true })).toHaveCount(0)
})
test('all old entries, real catalog, report links, calendar, theme and responsive layout', async ({
  page,
  baseURL,
}, info) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await visit(page, baseURL, '')
  await expect(page.getByRole('heading', { name: '研究工作台' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '顶会报告', exact: true })).toBeVisible()
  const catalogResponse = await page.request.get(route(baseURL, 'api/catalog'))
  const catalog = await catalogResponse.json()
  const latestResponse = await page.request.get(
    route(baseURL, 'api/news?source=articles&preview=3'),
  )
  const { articles, date } = await latestResponse.json()
  const latest = page.getByRole('region', { name: '最新快讯', exact: true })
  for (const article of articles) {
    await expect(
      latest.getByRole('link', { name: new RegExp(article.title_zh || article.title) }),
    ).toHaveAttribute(
      'href',
      `${new URL(baseURL!).pathname}updates/?${new URLSearchParams({ date, article: article._id || article.link })}`,
    )
  }
  await expect(latest.getByRole('link', { name: '查看全部资讯' })).toHaveAttribute(
    'href',
    `${new URL(baseURL!).pathname}updates/?date=${date}`,
  )
  await page.getByRole('button', { name: '切换深色模式' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-fastui-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-fastui-theme', 'dark')
  await page.getByRole('button', { name: '切换浅色模式' }).click()
  for (const [path, title] of [
    ['top-conf/', '顶会论文'],
    ['brief/', '领域导读'],
    ['summary/', '总结汇报'],
    ['updates/', '研究资讯'],
    ['inbox/', '私信'],
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
  await expect(page.getByTestId('report-row').first().getByRole('link')).toHaveAttribute(
    'href',
    /\/top-conf\/usenix\/2025\/$/,
  )
  await expect(page.getByRole('link', { name: /下载.*PDF/ })).toHaveCount(0)
  await visit(page, baseURL, 'updates/')
  const latestSecurity = await (
    await page.request.get(route(baseURL, 'api/news?source=articles'))
  ).json()
  await expect(
    page.getByRole('heading', { name: `${latestSecurity.date} · 每日资讯`, exact: true }),
  ).toBeVisible()
  await expect(page.getByTestId('news-row').first()).toBeVisible()
  await page.getByRole('button', { name: '上个月' }).click()
  await expect(page.getByTestId('calendar')).toBeVisible()
  await visit(page, baseURL, 'brief/')
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
  await visit(page, baseURL, 'following/')
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
  await page.getByRole('button', { name: '账号菜单', exact: true }).click()
  await page.getByRole('menuitem', { name: '退出登录', exact: true }).click()
  await expect(page.getByLabel('邮箱', { exact: true })).toBeVisible()
  await visit(page, baseURL, 'following/')
  await expect(page.getByText('登录后管理个人内容', { exact: true })).toBeVisible()
})

test('author updates persist on the dedicated page and appear on the home overview', async ({
  page,
  baseURL,
}, info) => {
  await login(page, baseURL)
  await visit(page, baseURL, '')
  await page.getByRole('link', { name: '管理关注', exact: true }).click()
  await page.getByRole('button', { name: '添加作者', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '新增作者' })
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
  await visit(page, baseURL, '')
  await expect(page.getByRole('region', { name: '关注作者', exact: true })).toContainText(name)
  await page.getByRole('link', { name: '管理关注', exact: true }).click()
  await expect(row).toBeVisible()
  await page.reload()
  await expect(row).toContainText('Selected research links')
  await row.locator('summary').click()
  await expect(row.getByRole('link', { name: 'Saved paper' })).toHaveAttribute(
    'href',
    'https://arxiv.org/abs/2401.00001',
  )
})

test('reports read inside the workspace without legacy HTML or scripts', async ({
  page,
  baseURL,
}, info) => {
  const { reports } = await (await page.request.get(route(baseURL, 'api/reports'))).json()
  const report = reports.find((r: { path: string }) => r.path.endsWith('USENIX_2025_Report.json'))
  expect(report.url).toBe('/top-conf/usenix/2025/')
  await visit(page, baseURL, report.url)
  await expect(page).toHaveURL(/\/top-conf\/usenix\/2025\/$/)
  await expect(page.getByTestId('workspace-header')).toBeVisible()
  const doc = page.getByTestId('report-document')
  await expect(doc.locator('article').first()).toBeVisible()
  await expect(doc.locator('iframe,script,style')).toHaveCount(0)
  await expect(page.getByRole('link', { name: '返回报告库' })).toBeVisible()
  await page.route('**/api/fastread', async (r) =>
    r.fulfill({ status: 409, json: { error: '阅读授权需要连接 Research' } }),
  )
  await doc.getByRole('button', { name: '跳转 FastRead', exact: true }).first().click()
  await expect(doc.getByRole('alert')).toHaveText('阅读授权需要连接 Research')
  await page.screenshot({ path: `test-results/${info.project.name}-report.png` })
  await page.reload()
  await expect(doc.locator('article').first()).toBeVisible()
  expect((await page.request.get(route(baseURL, 'reports/handoff.js'))).status()).toBe(404)
  expect(
    (
      await page.request.get(
        route(baseURL, 'report/?path=top-conf/data/report/USENIX_2025_Report.json'),
      )
    ).status(),
  ).toBe(404)
  expect(
    (
      await page.request.get(route(baseURL, 'top-conf/data/report/USENIX_2025_Report.html'))
    ).status(),
  ).toBe(404)
})

test('subpath application accepts independent-domain root and login entries', async ({
  page,
  baseURL,
}, info) => {
  test.skip(info.project.name !== 'subpath', 'Only the prefixed build needs entry canonicalization')
  const origin = new URL(baseURL!).origin
  await page.goto(origin + '/?date=2026-09-04#reports')
  await expect(page).toHaveURL(origin + '/news/?date=2026-09-04#reports')
  await expect(page.getByRole('heading', { name: '研究工作台', exact: true })).toBeVisible()
  await page.goto(origin + '/login?from=entry')
  await expect(page).toHaveURL(origin + '/news/login?from=entry')
  await expect(page.getByLabel('邮箱', { exact: true })).toBeVisible()
})

test('home overview shows four update cards and routes to dedicated research pages', async ({
  page,
  baseURL,
}) => {
  await visit(page, baseURL, '')
  await expect(page.locator('.home-card')).toHaveCount(4)
  await expect(page.getByRole('tab')).toHaveCount(0)
  await expect(page.getByLabel('搜索报告', { exact: true })).toHaveCount(0)
  await expect(page.getByText('已总结论文', { exact: true })).toHaveCount(0)
  await expect(page.getByTestId('author-row')).toHaveCount(0)
  const card = page.getByRole('region', { name: '顶会报告', exact: true })
  await expect(card.getByRole('link', { name: /USENIX/ })).toHaveAttribute(
    'href',
    /\/top-conf\/usenix\/2025\/$/,
  )
  await card.getByRole('link', { name: '资讯周报', exact: true }).click()
  await expect(page.getByTestId('report-document')).toBeVisible()
  await visit(page, baseURL, '')
  await card.getByRole('link', { name: '浏览论文', exact: true }).click()
  await expect(page.getByRole('heading', { name: '顶会论文', level: 1 })).toBeVisible()
  await visit(page, baseURL, '')
  const news = page.getByRole('region', { name: '最新快讯', exact: true })
  await news.locator('.home-update').first().click()
  await expect(page.getByTestId('news-reader')).toBeVisible()
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
    await dialog.getByRole('link', { name: '研究资讯', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(
      page.getByRole('heading', { name: '研究资讯', exact: true, level: 1 }),
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
  await visit(page, baseURL, `updates/?date=${date}`)
  const scored = articles.filter(hasScore)
  await expect(page.getByTestId('news-row')).toHaveCount(
    Math.min(10, scored.length || articles.length),
  )
  if (scored.length) {
    for (const row of await page.getByTestId('news-row').all()) {
      const link = await row.getByRole('link', { name: '原文', exact: true }).getAttribute('href')
      expect(scored.some((article) => new URL(article.link).href === link)).toBeTruthy()
    }
  }
  await page.getByRole('button', { name: '全部资讯', exact: true }).click()
  await expect(page.getByTestId('news-row')).toHaveCount(Math.min(20, articles.length))
  for (const row of await page.getByTestId('news-row').all()) {
    const link = await row.getByRole('link', { name: '原文', exact: true }).getAttribute('href')
    const article = articles.find((article) => new URL(article.link).href === link)!
    expect(article).toBeTruthy()
    if (hasScore(article)) {
      await expect(row).toContainText(`价值 ${storedScore(article)!.toFixed(1)}`)
    } else {
      await expect(row).not.toContainText('价值 ')
      await expect(row).not.toContainText(/价值 \d/)
    }
  }
})

test('news channels keep source attribution and survive reloads', async ({ page, baseURL }) => {
  await visit(page, baseURL, 'updates/')
  const picker = page.getByRole('group', { name: '资讯频道', exact: true })
  for (const [channel, label] of [
    ['security', '安全资讯'],
    ['ai', 'AI 资讯'],
  ]) {
    const response = page.waitForResponse((item) => {
      const url = new URL(item.url())
      return url.pathname.endsWith('/api/news') && url.searchParams.get('source') === channel
    })
    await picker.getByRole('button', { name: label, exact: true }).click()
    const result = await (await response).json()
    expect(
      result.articles.every((article: NewsArticle) => article.channel === channel),
    ).toBeTruthy()
    await expect(picker.getByRole('button', { name: label, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(page).toHaveURL(new RegExp(`channel=${channel}`))
    if (result.articles.length) {
      await page.getByRole('button', { name: '全部资讯', exact: true }).click()
      await expect(page.getByTestId('news-row')).toHaveCount(Math.min(20, result.articles.length))
      expect((await page.getByTestId('news-row').first().innerText()).length).toBeGreaterThan(0)
    } else {
      await expect(page.getByText('当天暂无资讯', { exact: true })).toBeVisible()
    }
  }
  await page.reload()
  await expect(picker.getByRole('button', { name: 'AI 资讯', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBeTruthy()
})

test('reading filters, pagination and focused article survive navigation', async ({
  page,
  baseURL,
}, info) => {
  await visit(page, baseURL, 'updates/?view=all')
  const rows = page.getByTestId('news-row')
  await expect(rows).toHaveCount(20)
  const first = await rows.first().locator('h3').innerText()
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page).toHaveURL(/page=2/)
  await expect(rows.first().locator('h3')).not.toHaveText(first)
  await page.reload()
  await expect(page.getByRole('button', { name: '2', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  if (info.project.name === 'mobile')
    await page.getByRole('button', { name: '展开资讯筛选' }).click()
  await page.getByRole('combobox', { name: '资讯来源', exact: true }).click()
  await page
    .getByRole('listbox', { name: '资讯来源', exact: true })
    .getByRole('option', { name: 'OpenAI News', exact: true })
    .click()
  await expect(page).not.toHaveURL(/page=2/)
  await expect(rows.first()).toContainText('OpenAI News')
  const title = await rows.first().locator('h3').innerText()
  await page.getByLabel('搜索资讯', { exact: true }).fill(title)
  await page.getByRole('button', { name: '搜索资讯结果', exact: true }).click()
  await expect(rows).toHaveCount(1)
  await rows.first().getByRole('link', { name: '阅读导读', exact: true }).click()
  const reader = page.getByTestId('news-reader')
  await expect(reader.getByRole('heading', { level: 1 })).toHaveText(title)
  await expect(reader.getByRole('link', { name: '前往原文' })).toHaveAttribute('target', '_blank')
  await page.getByRole('button', { name: '舒适字号' }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: '舒适字号' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expect(reader.getByRole('heading', { level: 1 })).toHaveText(title)
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBeTruthy()
  await page.screenshot({ path: `test-results/${info.project.name}-reader.png` })
  await page.getByRole('button', { name: '返回资讯列表' }).click()
  await expect(rows).toHaveCount(1)
  await expect(page.getByLabel('资讯来源', { exact: true })).toHaveValue('openai')
  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  await expect(rows).toHaveCount(20)
  await visit(page, baseURL, 'updates/')
  await expect(page.getByTestId('news-row').first()).toBeVisible()
  await expect(page.getByRole('button', { name: '展开资讯筛选' })).toBeVisible({
    visible: info.project.name === 'mobile',
  })
  await page.screenshot({ path: `test-results/${info.project.name}-news.png` })
  await page.getByRole('button', { name: '切换深色模式' }).click()
  await page.screenshot({
    path: `test-results/${info.project.name}-news-dark.png`,
    animations: 'disabled',
  })
})

test('source directory preserves provenance and distinguishes configured feeds from candidates', async ({
  page,
  baseURL,
}, info) => {
  await visit(page, baseURL, 'sources/')
  await expect(page.getByRole('heading', { name: '信源目录', exact: true, level: 1 })).toBeVisible()
  const result = await (await page.request.get(route(baseURL, 'api/sources'))).json()
  await expect(page.getByTestId('source-card')).toHaveCount(result.sources.length)
  await page.getByLabel('搜索信源', { exact: true }).fill('Krebs')
  await page.getByRole('button', { name: '查找信源' }).click()
  const card = page.getByTestId('source-card')
  await expect(card).toHaveCount(1)
  await expect(card).toContainText('已配置采集')
  await expect(card.locator('summary')).toHaveCount(0)
  await expect(page.getByText('如何看待这些来源')).toHaveCount(0)
  await expect(page.getByRole('link', { name: '浏览归档资讯' })).toHaveCount(0)
  await page.reload()
  await expect(page.getByLabel('搜索信源', { exact: true })).toHaveValue('Krebs')
  await page.getByRole('button', { name: '清除目录筛选' }).click()
  await page
    .getByRole('group', { name: '信源领域' })
    .getByRole('button', { name: /CVE 与漏洞/ })
    .click()
  const cve = result.sources.filter((source: { category: string }) => source.category === 'cve')
  await expect(page.getByTestId('source-card')).toHaveCount(cve.length)
  await expect(
    page.getByTestId('source-card').getByText('已配置采集', { exact: true }),
  ).toHaveCount(0)
  await page.getByLabel('信源状态', { exact: true }).selectOption('active')
  await expect(page.getByText('没有匹配的信源', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '清除目录筛选' }).click()
  await page.getByLabel('信源状态', { exact: true }).selectOption('active')
  await expect(page.getByTestId('source-card')).toHaveCount(
    result.sources.filter(
      (s: { configured: boolean; disabled: boolean }) => s.configured && !s.disabled,
    ).length,
  )
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBeTruthy()
  await page.screenshot({ path: `test-results/${info.project.name}-sources.png` })
  if (info.project.name === 'mobile') {
    await page.setViewportSize({ width: 320, height: 740 })
    await visit(page, baseURL, 'updates/')
    await expect(page.getByTestId('news-row').first()).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    ).toBeTruthy()
    const headerControls = page.getByTestId('workspace-header').locator('button:visible, a:visible')
    for (const control of await headerControls.all()) {
      const box = await control.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(320)
    }
    await page.screenshot({ path: 'test-results/mobile-news-320.png' })
  }
})

test('paper cards place reading actions above the abstract and align briefing fields', async ({
  page,
  baseURL,
}, info) => {
  await visit(page, baseURL, 'top-conf/?conference=usenix')
  const card = page.getByTestId('paper-row').first()
  await expect(card).toBeVisible()
  await expect(card).toHaveCSS('border-top-style', 'solid')
  const original = card.getByRole('link', { name: '阅读原文' })
  const fastread = card.getByRole('button', { name: '跳转 FastRead' })
  await expect(original).toHaveAttribute('target', '_blank')
  const summary = card.getByRole('region', { name: '摘要' })
  await expect(summary).toBeVisible()
  expect((await original.boundingBox())!.y).toBeLessThan((await summary.boundingBox())!.y)
  expect((await fastread.boundingBox())!.y).toBeLessThan(
    (await card.locator('h3').boundingBox())!.y,
  )
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBeTruthy()
  await page.screenshot({
    path: `../output/ui-review/${info.project.name}-paper-cards.png`,
    animations: 'disabled',
  })
  await page.getByRole('button', { name: '切换深色模式' }).click()
  await page.screenshot({
    path: `../output/ui-review/${info.project.name}-paper-cards-dark.png`,
    animations: 'disabled',
  })
  await visit(page, baseURL, 'brief/')
  const direction = await page.getByLabel('研究方向', { exact: true }).boundingBox()
  const source = await page.getByLabel('语料来源', { exact: true }).boundingBox()
  expect(Math.abs(direction!.x - source!.x)).toBeLessThan(1)
  await visit(page, baseURL, 'arxiv/')
  await expect(page.getByLabel('采集日期', { exact: true })).toHaveAttribute('type', 'text')
})

test('topic filters, author and institution pages, following and back-to-top work together', async ({
  page,
  baseURL,
  isMobile,
}) => {
  await login(page, baseURL)
  await visit(page, baseURL, 'top-conf/?topic=coding-agents&domain=security&track=main')
  await expect(page.getByRole('combobox', { name: '细分方向', exact: true })).toHaveValue(
    'coding-agents',
  )
  const card = page.getByTestId('paper-row').first()
  const author = card.getByRole('link', { name: 'Alice Example', exact: true })
  await expect(author).toBeVisible()
  if (!isMobile) {
    await author.hover()
    const popover = page.getByRole('group', { name: 'Alice Example简介' })
    await expect(popover).toContainText('Example University')
    await popover.getByRole('button', { name: '关注', exact: true }).click()
    await expect(popover.getByRole('button', { name: '取消关注', exact: true })).toBeVisible()
  }
  await author.click()
  await expect(page.getByRole('heading', { name: 'Alice Example', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: '收录论文 · 16', exact: true })).toBeVisible()
  await page.locator('aside').getByRole('link', { name: 'Example University', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Example University', level: 1 })).toBeVisible()
  await page.route('**/api/authors/preview', (r) =>
    r.fulfill({
      json: {
        title: 'Example University',
        description: '研究软件工程与智能体的示例机构。',
        source: 'https://example.org',
        fetchedAt: '2026-11-27T00:00:00Z',
        profiles: [],
        papers: [],
      },
    }),
  )
  await page.getByLabel('公开资料链接').fill('https://example.org')
  await page.getByRole('button', { name: '读取简介', exact: true }).click()
  await expect(page.getByText('研究软件工程与智能体的示例机构。', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^(关注并)?保存资料$/ }).click()
  await expect(page.getByRole('button', { name: '取消关注', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('研究软件工程与智能体的示例机构。', { exact: true })).toBeVisible()
  await page.getByTestId('paper-row').last().scrollIntoViewIfNeeded()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(480)
  await page.getByRole('button', { name: '回到顶部', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(5)
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBeTruthy()
})

test('collection calendar supports month navigation, keyboard selection and dismissal', async ({
  page,
  baseURL,
}) => {
  await login(page, baseURL)
  await visit(page, baseURL, 'arxiv/')
  const input = page.getByLabel('采集日期', { exact: true })
  await expect(input).not.toHaveValue('')
  const value = await input.inputValue()
  const [year, month, day] = value.split('-').map(Number)
  const previous = new Date(year, month - 1, day - 1, 12)
  const previousKey = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}-${String(previous.getDate()).padStart(2, '0')}`
  await page.getByRole('button', { name: '打开采集日历' }).click()
  const calendar = page.getByRole('dialog', { name: '选择采集日期' })
  await expect(calendar).toBeVisible()
  const cell = calendar.getByRole('button', { name: value, exact: true })
  await expect(cell).toBeFocused()
  await cell.press('ArrowLeft')
  await expect(calendar.getByRole('button', { name: previousKey, exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(calendar).not.toBeVisible()
  await expect(input).toHaveValue(previousKey)
  await page.getByRole('button', { name: '打开采集日历' }).click()
  await calendar.getByRole('button', { name: '上个月', exact: true }).click()
  await calendar.getByRole('button', { name: '下个月', exact: true }).click()
  await expect(calendar.getByRole('button', { name: previousKey, exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(calendar).not.toBeVisible()
  await expect(page.getByRole('button', { name: '打开采集日历' })).toBeFocused()
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBeTruthy()
})

test('expired session redirects once and restores the requested page after login', async ({
  page,
  baseURL,
  context,
}) => {
  await login(page, baseURL)
  await visit(page, baseURL, 'top-conf/?conference=usenix')
  await expect(page.getByTestId('paper-row').first()).toBeVisible()
  await context.clearCookies()
  await page.getByRole('button', { name: '个人印象', exact: true }).click()
  const impression = page.getByRole('dialog', { name: '个人印象' })
  await impression.getByLabel('研究印象', { exact: true }).fill('Session expiry test')
  await impression.getByRole('button', { name: '保存印象', exact: true }).click()
  await expect(page.getByRole('heading', { name: '登录 FastNews', exact: true })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('next')).toContain('/top-conf/')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByLabel('邮箱', { exact: true }).fill('browser-test@example.com')
  await page.getByLabel('密码', { exact: true }).fill('wrong-password')
  await page.getByRole('form', { name: '本地账号' }).locator('button[type=submit]').click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByLabel('密码', { exact: true }).fill('browser-test-password-123')
  await page.getByRole('form', { name: '本地账号' }).locator('button[type=submit]').click()
  await expect(page).toHaveURL(/top-conf/)
  await expect(page.getByTestId('paper-row').first()).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('publisher authors and affiliations have dedicated profile routes', async ({
  page,
  baseURL,
}) => {
  await login(page, baseURL)
  await visit(page, baseURL, 'top-conf/?conference=ccs&year=2026')
  const card = page.getByTestId('paper-row').filter({
    has: page.getByRole('heading', {
      name: 'Exploring the Exposure of IPv6 End-Host Networks',
      exact: true,
    }),
  })
  const person = card
    .locator('.paper-person')
    .filter({ has: page.getByRole('link', { name: 'Hugo Hue', exact: true }) })
  const name = person.getByRole('link', { name: 'Hugo Hue', exact: true })
  const unit = person.getByRole('link', { name: 'Georgia Institute of Technology', exact: true })
  await expect(name).toHaveCSS('text-decoration-line', 'underline')
  await expect(unit).toHaveCSS('text-decoration-line', 'underline')
  await expect(name).toHaveAttribute('href', /\/authors\/Hugo%20Hue\/$/)
  await expect(unit).toHaveAttribute(
    'href',
    /\/institutions\/Georgia%20Institute%20of%20Technology\/$/,
  )
  await expect(card.locator('.paper-person')).toHaveCount(5)
  await expect(
    card.getByRole('link', { name: 'University of California, Irvine', exact: true }),
  ).toBeVisible()
  const dns = page.getByTestId('paper-row').filter({ hasText: 'DNS Task Queue Scheduling' })
  await expect(dns.locator('.paper-person')).toHaveCount(8)
  await expect(dns.getByRole('link', { name: 'Shiming Liu', exact: true })).toBeVisible()
  await expect(
    dns.getByRole('link', { name: 'Tsinghua University, BNRist', exact: true }),
  ).toBeVisible()
  await name.click()
  await expect(page.getByRole('heading', { name: '收录论文 · 1', exact: true })).toBeVisible()
  await visit(page, baseURL, 'institutions/Ruhr%20University%20Bochum/')
  await expect(page).toHaveURL(/\/institutions\//)
  await expect(page.getByRole('heading', { name: '机构资料', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '收录论文 · 1', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'ROR 机构检索' })).toBeVisible()
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBeTruthy()
})

test('report search filters content and directory, with stable deep links', async ({
  page,
  baseURL,
  isMobile,
}) => {
  await visit(page, baseURL, 'top-conf/usenix/2025/')
  await expect(page).toHaveURL(/\/top-conf\/usenix\/2025\/$/)
  const doc = page.getByTestId('report-document')
  await expect(doc.locator('.paper-card')).toHaveCount(16)
  await expect(doc.locator('.paper-card').first()).toHaveCSS('border-top-width', '0px')
  const search = page.getByRole('textbox', { name: '搜索报告内容', exact: true })
  await search.fill('Example 13:')
  await expect(doc.locator('.paper-card')).toHaveCount(1)
  if (isMobile) await page.getByRole('button', { name: '目录', exact: true }).click()
  const toc = page.getByRole('navigation', { name: '报告目录' })
  await expect(toc.getByRole('link')).toHaveCount(1)
  await toc.getByRole('link').click()
  await expect(page).toHaveURL(/#report-13$/)
  await page.reload()
  await expect(doc.locator('.paper-card')).toHaveCount(1)
  await expect(search).toHaveValue('Example 13:')
  await search.fill('no-such-report-content')
  await expect(doc.getByRole('heading', { name: '没有匹配的内容' })).toBeVisible()
  await page.getByRole('button', { name: '清除报告搜索' }).click()
  await expect(doc.locator('.paper-card')).toHaveCount(16)
  await search.fill('Example University')
  await expect(doc.locator('.paper-card')).toHaveCount(16)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
