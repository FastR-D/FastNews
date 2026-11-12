import { test, expect } from '@playwright/test'
test('private reports unlock after login and catalog reloads without stale authorization errors', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('邮箱', { exact: true }).fill('browser-test@example.com')
  await page.getByLabel('密码', { exact: true }).fill('browser-test-password-123')
  await page.getByRole('form', { name: '本地账号' }).locator('button[type=submit]').click()
  await expect(page.getByRole('heading', { name: '当前账号', exact: true })).toBeVisible()
  await page.getByTestId('brand').click()
  await expect(page.getByRole('heading', { name: '安全研究报告工作台', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '顶会报告', exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  const response = await page.request.get('/api/papers?pageSize=1')
  expect(response.status()).toBe(200)
  await page.goto('/login')
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByLabel('邮箱', { exact: true })).toBeVisible()
  expect((await page.request.get('/api/catalog')).status()).toBe(401)
})
