// Shared by generated reports and historical report URLs. Product authentication
// and cross-product authorization remain on the Go API.
;(() => {
  const script = document.currentScript
  const scriptPath = script instanceof HTMLScriptElement ? new URL(script.src).pathname : ''
  const suffix = scriptPath.endsWith('/reports/handoff.js')
    ? '/reports/handoff.js'
    : '/assets/fastread.js'
  const base = scriptPath.endsWith(suffix) ? scriptPath.slice(0, -suffix.length) : ''
  const text = (value, limit) =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit)

  // HTML reports do not run React. Opt their controls into the same official
  // foundation classes without maintaining a separate report component theme.
  document.querySelectorAll('button[data-fastread]').forEach((button) => {
    button.classList.add('fastui-button', 'fastui-button--sm')
  })

  document.addEventListener('click', async (event) => {
    if (!(event.target instanceof Element)) return
    const button = event.target.closest('button[data-fastread]')
    if (!(button instanceof HTMLButtonElement) || button.disabled) return
    const root = button.closest('[data-fastread-title]') || button
    const data = root.dataset
    const paper = {
      title: text(data.fastreadTitle, 300),
      authors: text(data.fastreadAuthors, 400),
      abstract: text(data.fastreadAbstract, 800),
      url: text(data.fastreadUrl, 2048),
      venue: text(data.fastreadVenue, 80),
      year: text(data.fastreadYear, 8),
      id: text(data.fastreadId, 180),
      doi: text(data.fastreadDoi, 200),
    }
    if (!paper.title) return
    event.preventDefault()
    const label = button.textContent
    const popup = window.open('', '_blank')
    if (popup) popup.opener = null
    button.disabled = true
    button.textContent = '正在跳转…'
    let status = button.parentElement.querySelector('.report-handoff-status')
    if (status) status.remove()
    try {
      const response = await fetch(`${base}/api/fastread`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paper),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'FastRead 跳转失败，请重试')
      const redirect = new URL(result.redirect)
      if (
        !['https:', 'http:'].includes(redirect.protocol) ||
        redirect.username ||
        redirect.password
      )
        throw new Error('FastRead 返回的地址无效')
      if (popup) popup.location.replace(redirect.href)
      else window.location.assign(redirect.href)
    } catch (error) {
      if (popup) popup.close()
      status = document.createElement('p')
      status.className = 'report-handoff-status fastui-alert fastui-tone-danger'
      status.setAttribute('role', 'alert')
      status.textContent = error instanceof Error ? error.message : 'FastRead 跳转失败，请重试'
      button.insertAdjacentElement('afterend', status)
    } finally {
      button.disabled = false
      button.textContent = label
    }
  })
})()
