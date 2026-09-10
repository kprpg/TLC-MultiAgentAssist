import { chromium } from 'playwright';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

const outDir = path.resolve('docs/user-guide/media');
await mkdir(outDir, { recursive: true });

const baseUrl = 'http://127.0.0.1:8090';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const page = await context.newPage();

const shot = (name) => page.screenshot({ path: path.join(outDir, name), fullPage: false });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const openMenu = async (label) => {
    await page.evaluate((label) => {
        const btn = document.querySelector(`button[aria-label="${label}"]`);
        if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, label);
};

const clickText = async (selector, text) => {
    await page.evaluate(({ selector, text }) => {
        const els = Array.from(document.querySelectorAll(selector));
        const target = els.find((el) => (el.textContent || '').includes(text));
        if (target) target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, { selector, text });
};

const clickTab = async (name) => {
    await page.evaluate((name) => {
        const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
        const target = tabs.find((el) => (el.textContent || '').trim() === name);
        if (target) target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, name);
};

await page.goto(baseUrl, { waitUntil: 'networkidle' });
await wait(500);
await shot('01-landing.png');

// pick Contoso via center hero
await clickText('.landing-state button', 'Contoso Energy');
await wait(1500);
await shot('02-account-opportunities.png');

// open opportunity sort menu
await openMenu('Sort opportunities');
await wait(400);
await shot('03-opportunity-sort-menu.png');
await page.keyboard.press('Escape');
await wait(200);

// pick an opportunity via center landing to expand milestones
await clickText('.landing-state button', 'Grid operations modernization');
await wait(2000);
await shot('04-milestones-and-evidence.png');

// milestone actions
await openMenu('Edit Customer outcome validation');
await wait(400);
await shot('05-milestone-actions-menu.png');

// click Milestone Status menuitem to open inline editor
await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
    const target = items.find((el) => (el.textContent || '').trim() === 'Milestone Status');
    if (target) target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await wait(600);
await shot('06-milestone-inline-editor.png');

// cancel edit
await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.record-editor button'));
    const cancel = btns.find((b) => (b.textContent || '').trim() === 'Cancel');
    if (cancel) cancel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await wait(200);

// switch to Multi-Agent Guidance
await clickTab('Multi-Agent Guidance');
await wait(1200);
await shot('07-guidance-account-pulse.png');

// run Account Pulse prompt
await clickText('button', 'What should the account team focus on this week?');
await wait(2500);
await shot('08-agent-response-account-pulse.png');

// MCEM Coach
await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
    const target = tabs.find((t) => (t.textContent || '').trim() === 'MCEM Coach');
    if (target) target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await wait(1000);
await shot('09-agent-mcem-coach.png');

// Pursuit
await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
    const target = tabs.find((t) => (t.textContent || '').trim() === 'Pursuit');
    if (target) target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await wait(1000);
await shot('10-agent-pursuit.png');

// Risk & Play
await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
    const target = tabs.find((t) => (t.textContent || '').trim() === 'Risk & Play');
    if (target) target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await wait(1000);
await shot('11-agent-risk-play.png');

// MCEM Stage Management
await clickTab('MCEM Stage Management');
await wait(2500);
await shot('12-mcem-stage-board.png');

// MSX evidence
await clickTab('MSX');
await wait(1500);
await shot('13-msx-evidence-view.png');

console.log('All screenshots captured.');
await browser.close();
