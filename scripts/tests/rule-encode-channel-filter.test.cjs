const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '../..');
const clientRoot = path.join(repoRoot, 'client');
const browserCandidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const browserExecutable = browserCandidates.find(candidate => fs.existsSync(candidate));

test(
    'rule encode channel selector filters width variants and keeps typing across parent refreshes',
    {
        skip: browserExecutable
            ? false
            : 'No Chromium browser found; set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to run this test.',
    },
    async () => {
        const { chromium } = require(require.resolve('playwright-core', { paths: [repoRoot] }));
        const viteModulePath = path.join(clientRoot, 'node_modules/vite/dist/node/index.js');
        const { createServer } = await import(require('node:url').pathToFileURL(viteModulePath).href);
        const fixtureDir = path.resolve(fs.mkdtempSync(path.join(clientRoot, '.tmp-rule-encode-channel-filter-')));
        assert.equal(path.dirname(fixtureDir), path.resolve(clientRoot));
        assert.ok(path.basename(fixtureDir).startsWith('.tmp-rule-encode-channel-filter-'));
        let server;
        let browser;

        try {
            fs.writeFileSync(
                path.join(fixtureDir, 'index.html'),
                '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./fixture.tsx"></script></body></html>',
            );
            fs.writeFileSync(
                path.join(fixtureDir, 'fixture.tsx'),
                `
            import React, { useState } from 'react';
            import { createRoot } from 'react-dom/client';
            import { flushSync } from 'react-dom';
            import { RuleEncodeChannelSelector } from '../src/components/RuleEncodeChannelSelector';

            const originalChannels = [
                { id: 101, serviceId: 1, networkId: 1, name: 'BS11', halfWidthName: 'BS11', hasLogoData: false, channelType: 'BS', channel: '11' },
                { id: 102, serviceId: 2, networkId: 1, name: 'ＢＳ１１', halfWidthName: 'BS11', hasLogoData: false, channelType: 'BS', channel: '11' },
                { id: 103, serviceId: 3, networkId: 1, name: '東京MX', halfWidthName: '東京MX', hasLogoData: false, channelType: 'GR', channel: '16' },
                { id: 104, serviceId: 4, networkId: 1, name: 'TVK', halfWidthName: 'TVK', hasLogoData: false, channelType: 'GR', channel: '18' },
            ];

            function Fixture() {
                const [channelIds, setChannelIds] = useState([]);
                const [channels, setChannels] = useState(originalChannels);

                window.__testSelectedIds = channelIds;
                window.setSelectedForTest = ids => flushSync(() => setChannelIds([...ids]));
                window.refreshFreshReferences = () => flushSync(() => {
                    setChannels(originalChannels.map(channel => ({ ...channel })));
                    setChannelIds(ids => [...ids]);
                });

                return <RuleEncodeChannelSelector channels={channels} channelIds={channelIds} onChange={setChannelIds} />;
            }

            createRoot(document.getElementById('root')).render(<Fixture />);
        `,
            );

            server = await createServer({
                configFile: false,
                root: clientRoot,
                cacheDir: path.join(fixtureDir, '.vite-cache'),
                optimizeDeps: { entries: [path.join(fixtureDir, 'fixture.tsx')] },
                logLevel: 'error',
                server: { host: '127.0.0.1', port: 0, fs: { allow: [repoRoot] } },
            });
            await server.listen();
            const address = server.httpServer.address();
            assert.ok(address && typeof address === 'object');
            const fixtureUrl = `http://127.0.0.1:${address.port}/${path.relative(clientRoot, path.join(fixtureDir, 'index.html')).replaceAll(path.sep, '/')}`;

            browser = await chromium.launch({ executablePath: browserExecutable, headless: true });
            const page = await browser.newPage();
            const pageErrors = [];
            page.on('pageerror', error => pageErrors.push(error));
            await page.goto(fixtureUrl);
            const input = page.getByRole('combobox', { name: '対象局（未指定なら全局）' });
            await input.waitFor();

            // The query and candidate are deliberately opposite widths in each direction.
            await input.fill('ＢＳ１１');
            await page.getByRole('option', { name: 'BS11', exact: true }).waitFor();
            await input.fill('BS11');
            await page.getByRole('option', { name: 'ＢＳ１１', exact: true }).waitFor();
            await input.fill('');
            await assertAllChannelsVisible(page);

            // A parent refresh replaces both arrays while the selector is empty and while it has a selection.
            await input.fill('東京');
            await page.getByRole('option', { name: '東京MX', exact: true }).waitFor();
            await page.evaluate(() => window.refreshFreshReferences());
            assert.equal(await input.inputValue(), '東京');
            await page.getByRole('option', { name: '東京MX', exact: true }).waitFor();

            await page.evaluate(() => window.setSelectedForTest([101]));
            await input.fill('東京');
            await page.getByRole('option', { name: '東京MX', exact: true }).waitFor();
            await page.evaluate(() => window.refreshFreshReferences());
            assert.equal(await input.inputValue(), '東京');
            await page.getByRole('option', { name: '東京MX', exact: true }).waitFor();

            // Exercise the real selection, chip removal, and clear controls.
            await page.getByRole('option', { name: '東京MX', exact: true }).click();
            assert.deepEqual(await selectedIds(page), [101, 103]);
            assert.equal(await input.inputValue(), '');
            await input.fill('TVK');
            await page.getByRole('option', { name: 'TVK', exact: true }).waitFor();
            await page.locator('.MuiChip-root').filter({ hasText: '東京MX' }).locator('.MuiChip-deleteIcon').click();
            assert.deepEqual(await selectedIds(page), [101]);
            assert.equal(await input.inputValue(), 'TVK');

            await input.fill('東京');
            await page.getByRole('option', { name: '東京MX', exact: true }).click();
            assert.deepEqual(await selectedIds(page), [101, 103]);
            await page.getByRole('button', { name: /clear/i }).click();
            assert.deepEqual(await selectedIds(page), []);
            assert.equal(await input.inputValue(), '');

            // Send a native composition sequence, then refresh parent props while composition is active.
            await input.focus();
            await page.evaluate(() => {
                const element = document.querySelector('input[role="combobox"]');
                const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
                setValue.call(element, 'ＢＳ');
                element.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: 'ＢＳ' }));
                element.dispatchEvent(
                    new InputEvent('input', {
                        bubbles: true,
                        data: 'ＢＳ',
                        inputType: 'insertCompositionText',
                        isComposing: true,
                    }),
                );
            });
            await page.evaluate(() => window.refreshFreshReferences());
            assert.equal(await input.inputValue(), 'ＢＳ');
            await page.evaluate(() =>
                document
                    .querySelector('input[role="combobox"]')
                    .dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'ＢＳ' })),
            );
            await input.fill('');
            await assertAllChannelsVisible(page);
            assert.deepEqual(pageErrors, []);
        } finally {
            try {
                if (browser) await browser.close();
            } finally {
                try {
                    if (server) await server.close();
                } finally {
                    const cleanupPath = path.resolve(fixtureDir);
                    if (
                        path.dirname(cleanupPath) === path.resolve(clientRoot) &&
                        path.basename(cleanupPath).startsWith('.tmp-rule-encode-channel-filter-')
                    ) {
                        fs.rmSync(cleanupPath, { recursive: true, force: true });
                    }
                }
            }
        }

        async function selectedIds(page) {
            return page.evaluate(() => window.__testSelectedIds);
        }

        async function assertAllChannelsVisible(page) {
            for (const name of ['BS11', 'ＢＳ１１', '東京MX', 'TVK']) {
                await page.getByRole('option', { name, exact: true }).waitFor();
            }
        }
    },
);
