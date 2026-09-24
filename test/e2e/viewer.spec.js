import { expect, test } from '@playwright/test';

const tree = {
  truncated: false,
  tree: [
    { path: 'README.md', type: 'blob', size: 1200 },
    { path: 'src', type: 'tree' },
    { path: 'src/index.ts', type: 'blob', size: 5400 },
    { path: 'src/lib/util.ts', type: 'blob', size: 900 },
    { path: 'docs/guide.md', type: 'blob', size: 3000 },
    { path: 'node_modules/skip.js', type: 'blob', size: 10 },
  ],
};

function mockGithub(page, { status = 200 } = {}) {
  return page.route('https://api.github.com/**', (route) => {
    const url = route.request().url();
    if (status !== 200) return route.fulfill({ status, body: '{}' });
    if (url.includes('/git/trees/')) return route.fulfill({ json: tree });
    return route.fulfill({
      json: { full_name: 'acme/rocket', html_url: 'https://github.com/acme/rocket', default_branch: 'main', stargazers_count: 42 },
    });
  });
}

test('landing shows the demo galaxy behind the card', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your code is a galaxy.' })).toBeVisible();
  await expect(page.locator('#stage canvas')).toBeVisible();
  await page.waitForFunction(() => window.sylaxgen?.galaxy?.galaxy?.files.length > 1000);
  expect(errors).toEqual([]);
});

test('demo: search, language filter and timelapse', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Fly around the demo' }).click();
  await expect(page.locator('#title')).toHaveText('facebook/react');
  await expect(page.locator('#stats')).toContainText('stars');

  await page.locator('#search').fill('ReactFiberHooks');
  await expect(page.locator('#search-count')).toContainText('match');

  await page.locator('#search').fill('');
  await page.locator('#legend button').first().click();
  await expect(page.locator('#legend button.on')).toHaveCount(1);
  await expect(page.locator('#search-count')).toContainText('matches');

  await expect(page.locator('#timeline')).toBeVisible();
  await page.locator('#scrub').fill('100');
  await expect(page.locator('#date')).toContainText('201');
});

test('loads a GitHub repository and updates the URL', async ({ page }) => {
  await mockGithub(page);
  await page.goto('/');
  await page.locator('#repo-input').fill('https://github.com/acme/rocket');
  await page.getByRole('button', { name: 'Explore' }).click();
  await expect(page.locator('#title')).toHaveText('acme/rocket');
  await expect(page.locator('#stats')).toContainText('4 stars');
  await expect(page.locator('#stats')).toContainText('★ 42 on GitHub');
  await expect(page).toHaveURL(/\?repo=acme\/rocket$/);
  await expect(page.locator('#timeline')).toBeHidden();
});

test('deep link ?repo= opens the galaxy directly', async ({ page }) => {
  await mockGithub(page);
  await page.goto('/?repo=acme/rocket');
  await expect(page.locator('#title')).toHaveText('acme/rocket');
});

test('API errors come back to the landing page', async ({ page }) => {
  await mockGithub(page, { status: 404 });
  await page.goto('/');
  await page.locator('#repo-input').fill('acme/missing');
  await page.getByRole('button', { name: 'Explore' }).click();
  await expect(page.locator('#landing-error')).toContainText('not found');
  await expect(page.locator('#landing')).toBeVisible();
});

test('clicking a star shows its details', async ({ page }) => {
  await mockGithub(page);
  await page.goto('/?repo=acme/rocket');
  await expect(page.locator('#title')).toHaveText('acme/rocket');
  // Stop the camera and click on the projected position of src/index.ts.
  const point = await page.evaluate(() => {
    const g = window.sylaxgen.galaxy;
    g.controls.autoRotate = false;
    g.flight = null;
    g.controls.update();
    const i = g.galaxy.files.findIndex((f) => f.path === 'src/index.ts');
    const p = g.positionOf(i);
    return g.project([p.x, p.y, p.z]);
  });
  await page.mouse.move(point[0], point[1]);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('#info')).toContainText('src/index.ts');
  await expect(page.locator('#info a')).toHaveAttribute('href', 'https://github.com/acme/rocket/blob/main/src/index.ts');
});
