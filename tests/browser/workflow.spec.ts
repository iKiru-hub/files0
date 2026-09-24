import { test, expect } from '@playwright/test';
import { writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
const directory = process.env.FILES0_TEST_DIRECTORY!;
const original = '@idea\nOne small thought.\n#to next\n@next\nIt leads somewhere.\n#border none\n@class::vehicle\n-- wheels\n@class::car\n#inherit vehicle';
test.beforeEach(async () => { await writeFile(join(directory, 'test.txt'), original); });

test('file picker, source, classes, borderless notes, inheritance and navigation', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Plain text. A little perspective.' })).toBeVisible();
  await page.getByRole('button', { name: /test.txt/ }).filter({ has: page.locator('.file-name') }).click();
  await expect(page.locator('.node')).toHaveCount(4);
  await expect(page.locator('[data-id="next"]')).toHaveClass(/none/);
  await expect(page.locator('[data-id="vehicle"] .attribute')).toHaveText('+wheels');
  await expect(page.locator('path.inherit')).toHaveAttribute('data-source', 'vehicle');
  await expect(page.locator('path.inherit')).toHaveAttribute('data-target', 'car');
  await page.getByRole('button', { name: 'Source' }).click();
  await expect(page.locator('#source-code')).toContainText('@class::vehicle');
  await page.getByRole('button', { name: 'Close source' }).click();
  await page.getByRole('button', { name: '← All files', exact: true }).click();
  await expect(page.locator('#home')).toBeVisible();
  await page.goBack(); await expect(page.locator('.node')).toHaveCount(4);
  expect(errors).toEqual([]);
});

test('atomic saves update in place; invalid saves preserve the graph and recover', async ({ page }) => {
  await page.goto('/?file=test.txt'); await expect(page.locator('.node')).toHaveCount(4);
  await page.waitForTimeout(1000);
  const added = original + '\n@new\nA new note.\n#to next';
  await writeFile(join(directory, '.atomic-save'), added); await rename(join(directory, '.atomic-save'), join(directory, 'test.txt'));
  await expect(page.locator('.node')).toHaveCount(5); await expect(page.locator('[data-id="idea"]')).toBeVisible();
  await writeFile(join(directory, 'test.txt'), added + '\n#to missing');
  await expect(page.locator('#diagnostics')).toContainText('Keeping your last valid graph');
  await expect(page.locator('.node')).toHaveCount(5);
  await page.locator('#diagnostics button').click(); await expect(page.locator('.source-line.error')).toContainText('#to missing');
  await page.getByRole('button', { name: 'Close source' }).click();
  await writeFile(join(directory, 'test.txt'), '@restored\nFixed.');
  await expect(page.locator('.node')).toHaveCount(1); await expect(page.locator('#diagnostics')).toBeHidden();
  await expect(page.locator('[data-id="restored"]')).toBeVisible();
});

test('new files appear; deleted files preserve context and recover on recreation', async ({ page }) => {
  await page.goto('/');
  await writeFile(join(directory, 'created.txt'), '@hello');
  await page.getByRole('button', { name: /created.txt/ }).filter({ has: page.locator('.file-name') }).click(); await expect(page.locator('.node')).toHaveCount(1);
  await unlink(join(directory, 'created.txt')); await expect(page.locator('#diagnostics')).toContainText('no longer');
  await expect(page.locator('.node')).toHaveCount(1);
  await writeFile(join(directory, 'created.txt'), '@hello\nBack again.');
  await expect(page.locator('#diagnostics')).toBeHidden(); await expect(page.locator('.node-body')).toHaveText('Back again.');
  await unlink(join(directory, 'created.txt'));
});

test('drag and keyboard placement, pan, zoom, fit and refresh recovery', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?file=test.txt'); await expect(page.locator('.node')).toHaveCount(4); await page.waitForTimeout(1100);
  const node = page.locator('[data-id="idea"]'); const before = await node.boundingBox();
  await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
  await page.mouse.down(); await page.mouse.move(before!.x + before!.width / 2 + 65, before!.y + before!.height / 2 + 30, { steps: 8 }); await page.mouse.up();
  const after = await node.boundingBox(); expect(after!.x - before!.x).toBeCloseTo(65, 0);
  await node.focus(); const pos = await node.getAttribute('style'); await page.keyboard.press('ArrowRight');
  expect(await node.getAttribute('style')).not.toBe(pos);
  await page.reload(); await expect(node).toBeVisible();
  expect(await node.getAttribute('style')).not.toContain('NaN');
  await page.getByRole('button', { name: 'Zoom in' }).click(); await expect(page.locator('#zoom-reset')).toHaveText('120%');
  await page.keyboard.press('f'); await expect(page.locator('#zoom-reset')).toHaveText('150%');
  const world = await page.locator('#world').getAttribute('style');
  await page.mouse.move(60, 230); await page.mouse.down(); await page.mouse.move(100, 260); await page.mouse.up();
  expect(await page.locator('#world').getAttribute('style')).not.toBe(world);
});

test('empty files, literal HTML, cycles and reserved object-property names', async ({ page }) => {
  await writeFile(join(directory, 'test.txt'), ''); await page.goto('/?file=test.txt');
  await expect(page.locator('#empty-graph')).toBeVisible();
  await writeFile(join(directory, 'test.txt'), '@constructor\n<img src=x onerror=alert(1)>\n#to __proto__\n@__proto__\n#to constructor\n#to __proto__');
  await expect(page.locator('.node')).toHaveCount(2); await expect(page.locator('#empty-graph')).toBeHidden();
  await expect(page.locator('.node img')).toHaveCount(0);
  await expect(page.locator('.node-body')).toHaveText('<img src=x onerror=alert(1)>');
  const paths = await page.locator('#edge-paths path').evaluateAll(paths => paths.map(p => p.getAttribute('d')));
  expect(paths).toHaveLength(3); expect(paths.every(p => p && !p.includes('NaN'))).toBeTruthy();
});

test('small screens and reduced motion remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 800 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?file=hello.graph'); await expect(page.locator('.node')).toHaveCount(4);
  await expect(page.locator('#fit')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(560);
  const first = page.locator('.node').first(); const before = await first.getAttribute('style');
  await page.waitForTimeout(150); expect(await first.getAttribute('style')).toBe(before);
  await page.getByRole('button', { name: 'Language and keyboard help' }).click();
  await expect(page.locator('#help')).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.locator('#help')).toBeHidden();
});

test('connection loss preserves the view and reconnect catches up with saved changes', async ({ page, request }) => {
  await page.goto('/?file=test.txt'); await expect(page.locator('.node')).toHaveCount(4);
  await request.post('/__test__/disconnect');
  await expect(page.locator('#connection')).toContainText('Reconnecting');
  await expect(page.locator('.node')).toHaveCount(4);
  await writeFile(join(directory, 'test.txt'), '@reconnected\nSaved while the browser was offline.');
  await expect(page.locator('#connection')).toContainText('Watching files');
  await expect(page.locator('[data-id="reconnected"]')).toBeVisible();
  await expect(page.locator('.node')).toHaveCount(1);
});


test('border defaults, reverse arrows, hollow triangles and clear batch insertion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await writeFile(join(directory, 'test.txt'), '@plain\nSome text\n#from @source\n#use @target\n@source\n#border\n@class::target\n-- value');
  await page.goto('/?file=test.txt');
  await expect(page.locator('.node')).toHaveCount(3);
  await expect(page.locator('[data-id="plain"]')).toHaveClass(/none/);
  await expect(page.locator('[data-id="source"]')).toHaveClass(/rounded/);
  await expect(page.locator('[data-id="target"]')).toHaveClass(/rectangle/);
  await expect(page.locator('path.from')).toHaveAttribute('data-source', 'source');
  await expect(page.locator('path.from')).toHaveAttribute('data-target', 'plain');
  await expect(page.locator('path.use')).toHaveAttribute('marker-end', 'url(#triangle)');
  await expect(page.locator('#triangle path')).toHaveAttribute('d', /Z$/);
  await writeFile(join(directory, 'test.txt'), '@plain\nSome text\n#from @source\n#use @target\n@source\n#border\n@class::target\n-- value' + Array.from({length: 12}, (_, i) => `\n@new${i}\nNew text`).join(''));
  await expect(page.locator('.node')).toHaveCount(15);
  const boxes = await page.locator('.node').evaluateAll(nodes => nodes.map(node => {
    const el = node as HTMLElement, transform = new DOMMatrix(el.style.transform);
    return {id: el.dataset.id!, x: transform.m41, y: transform.m42, width: el.offsetWidth, height: el.offsetHeight};
  }));
  for (const a of boxes.filter(b => b.id.startsWith('new'))) for (const b of boxes) {
    if (a.id === b.id) continue;
    expect(a.x + a.width + 48 <= b.x || b.x + b.width + 48 <= a.x || a.y + a.height + 48 <= b.y || b.y + b.height + 48 <= a.y).toBeTruthy();
  }
});


test('zen hides chrome but preserves the graph, updates and keyboard escape', async ({ page }) => {
  await page.goto('/?file=test.txt'); await expect(page.locator('.node')).toHaveCount(4);
  await page.getByRole('button', { name: 'Zen', exact: true }).click();
  await expect(page.locator('body')).toHaveClass('zen');
  for (const selector of ['.topbar', '.workspace-heading', '.graph-footer', '#source-panel']) await expect(page.locator(selector)).toBeHidden();
  await expect(page.locator('.node').first()).toBeVisible();
  await writeFile(join(directory, 'test.txt'), original + '\n@zen-note\nAn uninterrupted thought.');
  await expect(page.locator('[data-id="zen-note"]')).toBeAttached();
  await page.keyboard.press('Escape'); await expect(page.locator('.topbar')).toBeVisible();
  await page.keyboard.press('z'); await expect(page.locator('.topbar')).toBeHidden();
  await page.keyboard.press('z'); await expect(page.locator('.topbar')).toBeVisible();
});

test('theme, font size and zoom persist; larger text reflows the graph and zen hides controls', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/?file=test.txt'); await expect(page.locator('.node')).toHaveCount(4);
  const body = page.locator('[data-id="idea"] .node-body');
  await expect(body).toHaveCSS('color', 'rgb(32, 40, 32)');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#triangle path')).toHaveCSS('fill', 'rgb(25, 30, 26)');
  const height = await page.locator('[data-id="idea"]').evaluate(el => (el as HTMLElement).offsetHeight);
  await page.getByLabel('Note font size').selectOption('16');
  await expect(body).toHaveCSS('font-size', '16px');
  expect(await page.locator('[data-id="idea"]').evaluate(el => (el as HTMLElement).offsetHeight)).toBeGreaterThan(height);
  await page.getByRole('button', { name: 'Reset zoom to 100%' }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.locator('#zoom-reset')).toHaveText('120%');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByLabel('Note font size')).toHaveValue('16');
  await expect(body).toHaveCSS('font-size', '16px');
  await expect(page.locator('#zoom-reset')).toHaveText('120%');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.setViewportSize({ width: 390, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole('button', { name: 'Zen', exact: true }).click();
  await expect(page.getByLabel('Note font size')).toBeHidden();
  await expect(page.locator('#theme-button')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Note font size')).toBeVisible();
});

test('homepage links a file from another folder, saves it, and compiles changes in place', async ({ page }) => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const folder = await mkdtemp(join(tmpdir(), 'files0-linked-browser-'));
  const file = join(folder, 'external-notes.md');
  try {
    await writeFile(file, '@linked\nAn external thought.');
    await page.goto('/'); await page.getByRole('button', { name: 'Add a file from disk' }).click();
    await page.getByLabel('Or enter its full path').fill(file);
    await page.getByRole('button', { name: 'Add to library', exact: true }).click();
    await expect(page.locator('[data-id="linked"]')).toBeVisible();
    await expect(page.locator('#breadcrumb')).toHaveText('external-notes.md');
    await writeFile(file, '@linked\nChanged where it lives.');
    await expect(page.locator('.node-body')).toHaveText('Changed where it lives.');
    await page.goto('/'); await page.reload();
    await page.getByRole('button', { name: /external-notes.md/ }).filter({ hasText: file }).click();
    await expect(page.locator('[data-id="linked"]')).toBeVisible();
    await page.getByLabel('Note font size').focus();
    await page.keyboard.press('Shift+Z'); await expect(page.locator('body')).toHaveClass('zen');
    await page.keyboard.press('z'); await expect(page.locator('.topbar')).toBeVisible();
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('Time and T switch chronology, retain other arrows, and support live edits in zen', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await writeFile(join(directory, 'test.txt'), '@a\n#to b\n#to c\n#use d\n@b\n#to d\n@c\n@d');
  await page.goto('/?file=test.txt'); await expect(page.locator('.node')).toHaveCount(4);
  await expect(page.locator('[data-id="d"]')).toBeVisible();
  await page.getByRole('button', { name: 'Time', exact: true }).click();
  await expect(page.locator('#time-button')).toHaveAttribute('aria-pressed', 'true');
  const coords = () => page.locator('.node').evaluateAll(nodes => Object.fromEntries(nodes.map(el => {
    const node = el as HTMLElement, m = new DOMMatrix(node.style.transform);
    return [node.dataset.id!, {x:m.m41, y:m.m42 + node.offsetHeight / 2}];
  })));
  let p = await coords(); expect(p.b.x).toBe(p.c.x); expect(p.b.x).toBeGreaterThan(p.a.x); expect(p.d.x).toBeGreaterThan(p.b.x);
  expect(p.b.y).toBe(p.d.y); await expect(page.locator('path.use')).toHaveCount(1);
  await page.keyboard.press('z'); await page.keyboard.press('t');
  await expect(page.locator('#viewport')).toHaveAttribute('data-mode', 'spatial');
  await page.keyboard.press('Shift+T'); await expect(page.locator('#viewport')).toHaveAttribute('data-mode', 'temporal');
  await writeFile(join(directory, 'test.txt'), '@a\n#to b\n@b\n#to c\n@c\n@x\n#to y\n@y');
  await expect(page.locator('.node')).toHaveCount(5);
  p = await coords(); expect(p.x.x).toBe(p.c.x); expect(p.y.x).toBeGreaterThan(p.x.x);
  await page.keyboard.press('Escape'); await expect(page.locator('#time-button')).toHaveText('Time on');
});


test('new notes follow smoothly at fixed zoom; temporal and window changes preserve text size', async ({ page }) => {
  await writeFile(join(directory, 'test.txt'), '@a\nFirst.');
  await page.goto('/?file=test.txt');
  await expect(page.locator('.node')).toHaveCount(1);
  await expect(page.locator('#zoom-reset')).toHaveText('100%');
  const width = (await page.locator('[data-id="a"]').boundingBox())!.width;
  await writeFile(join(directory, 'test.txt'), '@a\nFirst.\n#to b\n@b\nLatest.');
  await expect(page.locator('.node')).toHaveCount(2);
  const focusError = () => page.evaluate(() => {
    const v = document.querySelector('#viewport')!.getBoundingClientRect();
    const n = document.querySelector('[data-id="b"]')!.getBoundingClientRect();
    return Math.abs(n.x+n.width/2-v.x-v.width*2/3)+Math.abs(n.y+n.height/2-v.y-v.height/2);
  });
  await expect.poll(focusError).toBeLessThan(1);
  await page.keyboard.press('t');
  await expect.poll(focusError).toBeLessThan(1);
  await page.setViewportSize({ width: 700, height: 700 });
  await expect.poll(focusError).toBeLessThan(1);
  await expect(page.locator('#zoom-reset')).toHaveText('100%');
  expect((await page.locator('[data-id="a"]').boundingBox())!.width).toBeCloseTo(width, 1);
  await expect(page.locator('#edge-paths path')).toHaveAttribute('data-routing', 'obstacle-aware');
});

test('colored borders render thicker and reset when the directive is removed', async ({ page }) => {
  await writeFile(join(directory,'test.txt'), '@colored\n#color 222C3A\nA colored note.');
  await page.goto('/?file=test.txt');
  const note = page.locator('[data-id="colored"]');
  await expect(note).toHaveCSS('border-top-color','rgb(34, 44, 58)');
  await expect(note).toHaveCSS('border-top-width','2px');
  await page.getByRole('button',{name:'Switch to dark mode'}).click();
  await expect(note).toHaveCSS('border-top-color','rgb(34, 44, 58)');
  await writeFile(join(directory,'test.txt'), '@colored\nA plain note.');
  await expect(note).toHaveClass(/none/);
  await expect(note).not.toHaveClass(/colored/);
  await expect(note).toHaveCSS('border-top-color','rgba(0, 0, 0, 0)');
});

test('Vim keys pan the camera in zen, preserve note positions and respect form controls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?file=test.txt'); await expect(page.locator('[data-id="idea"]')).toBeVisible();
  const camera = () => page.locator('#world').evaluate(el => {
    const m = new DOMMatrix(getComputedStyle(el).transform); return { x: m.m41, y: m.m42, scale: m.a };
  });
  const before = await camera();
  const positions = await page.locator('#nodes').innerHTML();
  await page.keyboard.press('h'); expect((await camera()).x).toBeCloseTo(before.x+40);
  await page.keyboard.press('j'); expect((await camera()).y).toBeCloseTo(before.y-40);
  await page.keyboard.press('k'); expect((await camera()).y).toBeCloseTo(before.y);
  await page.keyboard.press('l'); expect((await camera()).x).toBeCloseTo(before.x);
  await page.keyboard.press('z'); await page.keyboard.press('Shift+L');
  expect((await camera()).x).toBeCloseTo(before.x-120);
  await page.keyboard.down('j'); await page.keyboard.down('j'); await page.keyboard.up('j');
  expect((await camera()).y).toBeCloseTo(before.y-80);
  expect((await camera()).scale).toBe(before.scale);
  expect(await page.locator('#nodes').innerHTML()).toBe(positions);
  await page.keyboard.press('Escape');
  await page.getByLabel('Note font size').focus(); const held = await camera();
  await page.keyboard.press('h'); expect(await camera()).toEqual(held);
  await page.getByRole('button', { name: 'Language and keyboard help' }).click();
  await page.keyboard.press('j'); expect(await camera()).toEqual(held);
});

test('inline math renders locally and malformed math leaves usable notes', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await writeFile(join(directory,'test.txt'), String.raw`@math
Energy \(E=mc^2\), fraction \(\frac{1}{2}\), root \(\sqrt{x}\), Greek \(\alpha_i\).
<img src=x onerror=alert(1)>
@broken
Keep \(\frac{1}{\) visible and unmatched \(x.
@class::Vector
-- norm \(\sum_i x_i^2\)`);
  await page.goto('/?file=test.txt');
  await expect(page.locator('.katex')).toHaveCount(5);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.math-invalid')).toContainText(String.raw`\(\frac{1}{\)`);
  await expect(page.locator('[data-id="broken"] .node-body')).toContainText(String.raw`unmatched \(x.`);
  await expect(page.locator('.node img')).toHaveCount(0);
  await expect(page.locator('#world')).toHaveCSS('will-change', 'auto');
  const body = page.locator('[data-id="math"] .node-body');
  await expect(body).toHaveCSS('font-weight','500');
  await expect(body).toHaveCSS('color','rgb(32, 40, 32)');
  await expect(body).toHaveCSS('width','84px');
  await page.getByRole('button',{name:'Zoom in'}).click();
  await page.getByRole('button',{name:'Zoom in'}).click();
  await expect(page.locator('.katex')).toHaveCount(5);
  await page.keyboard.press('f');
  await page.screenshot({ path: 'test-results/math-zoom.png' });
  await writeFile(join(directory,'test.txt'), String.raw`@math
Updated \(x^3\).`);
  await expect(page.locator('.katex')).toHaveCount(1);
  await expect(page.locator('[data-id="math"] .node-body')).toContainText('Updated');
  expect(errors).toEqual([]);
});

test('homepage width persists and title spacing leaves reference IDs intact', async ({ page }) => {
  await page.emulateMedia({ reducedMotion:'reduce' });
  await writeFile(join(directory,'test.txt'), '@first_note\n#to second_note\n@class::second_note\n-- value');
  await page.goto('/');
  await page.getByLabel('Note width',{exact:true}).fill('180');
  await page.getByLabel('Note width',{exact:true}).press('Tab');
  await page.getByRole('button',{name:/test.txt/}).filter({ has: page.locator('.file-name') }).click();
  await expect(page.locator('[data-id="first_note"]')).toHaveCSS('width','180px');
  await expect(page.locator('[data-id="first_note"] .node-title')).toHaveText('first note');
  await expect(page.locator('[data-id="second_note"] .node-title')).toHaveText('second note');
  await expect(page.locator('path.to')).toHaveAttribute('data-target','second_note');
  await page.reload();
  await expect(page.locator('[data-id="first_note"]')).toHaveCSS('width','180px');
  await page.getByRole('button',{name:'← All files',exact:true}).click();
  await expect(page.getByLabel('Note width',{exact:true})).toHaveValue('180');
  await page.getByRole('button',{name:'Reset',exact:true}).click();
  await page.getByRole('button',{name:/test.txt/}).filter({ has: page.locator('.file-name') }).click();
  await expect(page.locator('[data-id="first_note"]')).toHaveCSS('width','100px');
});

test('live temporal siblings grow above then below their centered parent', async ({ page }) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  const source = (count:number) => '@parent\n'+Array.from({length:count},(_,i)=>`@child${i}\n#from parent`).join('\n');
  await writeFile(join(directory,'test.txt'), source(1));
  await page.goto('/?file=test.txt'); await expect(page.locator('[data-id="child0"]')).toBeVisible();
  await page.keyboard.press('t');
  for (let count=2;count<=4;count++) {
    await writeFile(join(directory,'test.txt'),source(count));
    await expect(page.locator('.node')).toHaveCount(count+1);
    const centers=await page.locator('.node').evaluateAll(nodes=>Object.fromEntries(nodes.map(el=>{
      const n=el as HTMLElement;return [n.dataset.id!,new DOMMatrix(n.style.transform).m42+n.offsetHeight/2];
    })));
    const ys=Array.from({length:count},(_,i)=>centers['child'+i]);
    expect(centers.parent).toBeCloseTo((Math.min(...ys)+Math.max(...ys))/2);
    expect(ys.at(-1)).toBe(count%2===0?Math.min(...ys):Math.max(...ys));
  }
});

test('note emphasis supports math, literal HTML, escaped stars and live edits', async ({ page }) => {
  await writeFile(join(directory,'test.txt'), String.raw`@formatted
An *italic phrase* and **bold phrase**; **bold with *italic inside* and \(x^2\)**.
Literal \*stars\*, unmatched *end, <b>plain HTML</b>.
Math \(a*b\) stays math.
@class::Class
-- **bold attribute**`);
  await page.goto('/?file=test.txt');
  const body=page.locator('[data-id="formatted"] .node-body');
  await expect(body.locator('em').first()).toHaveText('italic phrase');
  await expect(body.locator('em').first()).toHaveCSS('font-style','italic');
  await expect(body.locator('strong').first()).toHaveText('bold phrase');
  await expect(body.locator('strong').first()).toHaveCSS('font-weight','700');
  await expect(body.locator('strong em')).toHaveText('italic inside');
  await expect(body.locator('strong .katex')).toHaveCount(1);
  await expect(body.locator('.katex')).toHaveCount(2);
  await expect(body).toContainText('Literal *stars*, unmatched *end, <b>plain HTML</b>.');
  await expect(body.locator('b')).toHaveCount(0);
  await expect(page.locator('.attribute strong')).toHaveText('bold attribute');
  await writeFile(join(directory,'test.txt'), '@formatted\nNow plain text.');
  await expect(body).toHaveText('Now plain text.');
  await expect(body.locator('em,strong')).toHaveCount(0);
});

test('homepage removes an entry persistently and can add the untouched file again', async ({ page, request }) => {
  await page.goto('/');
  const remove=page.getByRole('button',{name:'Remove test.txt from list',exact:true});
  await expect(remove).toBeVisible();
  expect((await request.delete('/api/library',{data:{name:'test.txt'}})).status()).toBe(403);
  await remove.click(); await expect(remove).toHaveCount(0);
  await expect(page.locator('#library-status')).toContainText('File kept on disk');
  await page.reload(); await expect(remove).toHaveCount(0);
  const { readFile } = await import('node:fs/promises');
  expect(await readFile(join(directory,'test.txt'),'utf8')).toBe(original);
  const added=await request.post('/api/library',{headers:{'X-Files0-Request':'1'},data:{path:join(directory,'test.txt')}});
  expect(added.ok()).toBeTruthy(); await expect(remove).toBeVisible();
  await page.getByRole('button',{name:/test.txt/}).filter({has:page.locator('.file-name')}).click();
  await expect(page.locator('[data-id="idea"]')).toBeVisible();
});

test('Ctrl home, Vim file selection and backward/forward file history work across refresh', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.file-card')).not.toHaveCount(0);
  const cards = page.locator('.file-card');
  await cards.first().focus();
  const first = await cards.first().getAttribute('data-file');
  const second = await cards.nth(1).getAttribute('data-file');
  await page.keyboard.press('j'); await expect(cards.nth(1)).toBeFocused();
  await page.keyboard.press('k'); await expect(cards.first()).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page).toHaveURL(new RegExp('file='+encodeURIComponent(first!)));
  await page.keyboard.press('Control+h'); await expect(page.locator('#home')).toBeVisible();
  await expect(cards.first()).toBeFocused(); await page.keyboard.press('j'); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp('file='+encodeURIComponent(second!)));
  await page.keyboard.press('Control+p'); await expect(page).toHaveURL(new RegExp('file='+encodeURIComponent(first!)));
  await page.keyboard.press('Control+p'); await expect(page).toHaveURL(new RegExp('file='+encodeURIComponent(first!)));
  await page.reload();
  await page.keyboard.press('Control+n'); await expect(page).toHaveURL(new RegExp('file='+encodeURIComponent(second!)));
  await page.keyboard.press('Control+n'); await expect(page).toHaveURL(new RegExp('file='+encodeURIComponent(second!)));
  await page.keyboard.press('z'); await page.keyboard.press('Control+h');
  await expect(page.locator('#home')).toBeVisible(); await expect(page.locator('body')).not.toHaveClass(/zen/);
  await page.keyboard.press('Control+p'); await expect(page).toHaveURL(new RegExp('file='+encodeURIComponent(second!)));
  await page.keyboard.press('Control+h'); await page.getByLabel('Note width',{exact:true}).focus();
  await page.keyboard.press('Control+p'); await expect(page.locator('#home')).toBeVisible();
});

test('polished layouts stay still on same-size edits and keep fork diagrams compact', async ({ page }) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  const source='@idea\nA small thought.\n#to explore\n#to build\n#to reflect\n@explore\nFind a direction.\n#to learn\n@build\nMake it tangible.\n#to learn\n@reflect\nTake a step back.\n#use learn\n@learn\nKeep what works.\n@aside\nAnother thought.';
  await writeFile(join(directory,'test.txt'),source);
  await page.goto('/?file=test.txt'); await expect(page.locator('[data-id="aside"]')).toBeVisible();
  await page.keyboard.press('f');
  const positions=await page.locator('.node').evaluateAll(nodes=>nodes.map(n=>(n as HTMLElement).style.transform));
  await writeFile(join(directory,'test.txt'),source.replace('small','fresh'));
  await expect(page.locator('[data-id="idea"] .node-body')).toHaveText('A fresh thought.');
  expect(await page.locator('.node').evaluateAll(nodes=>nodes.map(n=>(n as HTMLElement).style.transform))).toEqual(positions);
  await page.screenshot({path:'test-results/polished-spatial.png'});
  await page.keyboard.press('t'); await page.keyboard.press('f');
  await page.screenshot({path:'test-results/polished-temporal.png'});
  await expect(page.locator('#edge-paths path[data-routing="fallback"]')).toHaveCount(0);
});
