import { expect, test, type Page } from '@playwright/test';
import { chooseViewType } from './helpers/recordTableToolbar';
async function fixture(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-31T20:00:00Z'));
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__societyerE2E));
  const data = await page.evaluate(async () => (window as any).__societyerE2E.setupInteractionAudit());
  await page.goto('/app/tasks');
  await chooseViewType(page, 'List view');
  await expect(page.locator('.task-row', { hasText: 'Interaction task A' })).toBeVisible();
  return data;
}
async function inspect(page: Page, societyId: string) {
  return page.evaluate(id => (window as any).__societyerE2E.inspectInteractionAudit(id), societyId);
}
const taskRow = (page: Page, title = 'Interaction task A') => page.locator('.task-row', { hasText: title });
async function edit(page: Page, title = 'Interaction task A') {
  await taskRow(page, title).locator('.task-row__title-text').click();
  const drawer = page.getByRole('dialog', { name: 'Edit task', exact: true });
  await expect(drawer.getByLabel('Title', { exact: true })).toBeVisible();
  return drawer;
}
test('task save clears fields, preserves both owners, and commits buffered checklist edits only on Save', async ({ page }) => {
  const f = await fixture(page);
  const drawer = await edit(page);
  await expect(drawer.getByRole('button', { name: /^Remove responsible user/ })).toHaveCount(2);
  await drawer.getByLabel('Assignee as written (optional)', { exact: true }).fill('');
  await drawer.getByLabel('Due', { exact: true }).click();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(drawer).toBeVisible();
  await drawer.getByRole('textbox', { name: 'Add a checklist step', exact: true }).fill('Buffered, without pressing Enter');
  // A persisted record has not changed merely because a checkbox or field did.
  expect((await inspect(page, f.societyId)).tasks.find((row: any) => row._id === f.taskIds[0]).dueDate).toBe('2026-10-31');
  await drawer.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect.poll(async () => (await inspect(page, f.societyId)).tasks.find((row: any) => row._id === f.taskIds[0]).checklist.length).toBe(2);
  await page.reload();
  await expect(taskRow(page)).toBeVisible();
  const saved = (await inspect(page, f.societyId)).tasks.find((row: any) => row._id === f.taskIds[0]);
  expect(saved.dueDate).toBeUndefined(); expect(saved.assignee).toBeUndefined();
  expect(saved.responsibleUserIds).toEqual(f.userIds);
  expect(saved.checklist[1].title).toBe('Buffered, without pressing Enter');
});

test('dirty close, failed save, reload and explicit draft recovery retain task work', async ({ page }) => {
  const f = await fixture(page);
  let drawer = await edit(page);
  await drawer.getByLabel('Title', { exact: true }).fill('Recovered interaction task');
  await drawer.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(drawer.getByLabel('Title', { exact: true })).toHaveValue('Recovered interaction task');
  await page.evaluate(() => (window as any).__societyerE2E.failNextInteractionWrite('tasks:update'));
  await drawer.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Could not save task', { exact: true })).toBeVisible();
  expect((await inspect(page, f.societyId)).tasks.find((row: any) => row._id === f.taskIds[0]).title).toBe('Interaction task A');
  await page.reload();
  drawer = await edit(page);
  await drawer.getByRole('button', { name: 'Restore task draft', exact: true }).click();
  await expect(drawer.getByLabel('Title', { exact: true })).toHaveValue('Recovered interaction task');
  await drawer.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(taskRow(page, 'Recovered interaction task')).toBeVisible();
});

test('bell links and non-links are keyboard-operable and the full page shares read-state behavior', async ({ page }) => {
  const f = await fixture(page);
  const read = async (title: string) => Boolean((await inspect(page, f.societyId)).notifications.find((row: any) => row.title === title)?.readAt);
  await page.getByRole('button', { name: /^Notifications(?: \(\d+ unread\))?$/ }).click();
  const panel = page.locator('.notif-panel');
  await panel.getByRole('link', { name: /Interaction linked bell/ }).press('Enter');
  await expect(panel).toBeHidden();
  await expect.poll(() => read('Interaction linked bell')).toBe(true);
  await page.getByRole('button', { name: /^Notifications(?: \(\d+ unread\))?$/ }).click();
  await panel.getByRole('button', { name: /Interaction no-link bell/ }).press('Space');
  await expect(panel).toBeHidden();
  await expect.poll(() => read('Interaction no-link bell')).toBe(true);
  await page.goto('/app/notifications');
  await page.getByRole('link', { name: 'Interaction page link', exact: true }).click();
  await expect.poll(() => read('Interaction page link')).toBe(true);
});

test('reordered Favorites drive the four phone tabs and persist across reload', async ({ page }) => {
  await fixture(page);
  const routes = ['/app', '/app/tasks', '/app/meetings', '/app/documents', '/app/deadlines'];
  await page.evaluate(routes => {
    localStorage.setItem('societyer.sidebar.pinnedRoutes', JSON.stringify(routes));
    localStorage.setItem('societyer.sidebar.pinnedFavoritesOrder', JSON.stringify([routes[4], ...routes.slice(0, 4)].map(id => ({ kind: 'route', id }))));
  }, routes);
  await page.reload();
  await expect(taskRow(page)).toBeVisible();
  const tabs = page.locator('.bottom-nav a');
  if (await tabs.count()) {
    await expect.poll(() => tabs.evaluateAll(nodes => nodes.map(node => node.getAttribute('href')))).toEqual(['/app/deadlines', '/app', '/app/tasks', '/app/meetings']);
  } else {
    const favorites = page.locator('.sidebar__favorites .sidebar__item[data-pinned] .sidebar__label');
    await expect(favorites).toHaveText(['Deadlines', 'Dashboard', 'Tasks', 'Meetings', 'Documents']);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('date-only Today and year-range controls work in popovers and phone sheets', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-31T20:00:00Z'));
  await page.goto('/tests/fixtures/interaction-controls/');
  await page.getByLabel('Bounded date', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.getByTestId('bounded-value')).toHaveText('2026-10-31');
  await page.getByLabel('Year navigation', { exact: true }).click();
  await page.getByRole('button', { name: 'Choose year', exact: true }).click();
  const years = page.getByRole('grid', { name: 'Year', exact: true }).getByRole('button');
  await expect(years.first()).toHaveText('2020');
  await page.getByRole('button', { name: 'Next year range', exact: true }).click();
  await expect(years.first()).toHaveText('2033');
  await page.getByRole('button', { name: 'Previous year range', exact: true }).click();
  await expect(years.first()).toHaveText('2020');
});

test('a vetoed phone swipe restores the guarded sheet instead of leaving it off-screen', async ({ page, context }, info) => {
  test.skip(!['phone', 'narrow-phone'].includes(info.project.name), 'Touch-only dismissal contract');
  await page.goto('/tests/fixtures/interaction-controls/');
  await page.getByRole('button', { name: 'Open guarded form', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Guarded form', exact: true });
  await dialog.getByLabel('Draft text').fill('Keep this text');
  const box = await dialog.boundingBox(); expect(box).not.toBeNull();
  const session = await context.newCDPSession(page);
  const x = box!.x + box!.width / 2; const y = box!.y + 12;
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (const dy of [25, 65, 120, 160]) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: Math.min(y + dy, page.viewportSize()!.height - 5) }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(dialog).toBeInViewport();
  await expect(dialog.getByLabel('Draft text')).toHaveValue('Keep this text');
  await session.detach();
});


test('task URL filters follow same-view navigation, history and chip removal', async ({ page }) => {
  const f = await fixture(page);
  const go = (to: string | number) => page.evaluate(to => (window as any).__societyerE2E.navigate(to), to);
  await page.waitForFunction(() => typeof window.__societyerE2E?.navigate === 'function');
  const a = `/app/tasks?goalId=${encodeURIComponent(f.goalIds[0])}`;
  const b = `/app/tasks?goalId=${encodeURIComponent(f.goalIds[1])}`;
  await go(a);
  await expect(taskRow(page)).toBeVisible();
  await expect(taskRow(page, 'Interaction task B')).toHaveCount(0);
  await go(b);
  await expect(taskRow(page, 'Interaction task B')).toBeVisible();
  await expect(taskRow(page)).toHaveCount(0);
  await go(-1);
  await expect(page).toHaveURL(new RegExp(`goalId=${encodeURIComponent(f.goalIds[0])}$`));
  await expect(taskRow(page)).toBeVisible();
  await expect(taskRow(page, 'Interaction task B')).toHaveCount(0);
  await go(1);
  await expect(taskRow(page, 'Interaction task B')).toBeVisible();
  await go('/app/tasks');
  await expect(taskRow(page)).toBeVisible();
  await expect(taskRow(page, 'Interaction task B')).toBeVisible();
  await go(a);
  await page.getByRole('button', { name: /^Remove filter:.*Goal/i }).click();
  await expect(page).toHaveURL(/\/app\/tasks$/);
  await expect(taskRow(page)).toBeVisible();
  await expect(taskRow(page, 'Interaction task B')).toBeVisible();
});
