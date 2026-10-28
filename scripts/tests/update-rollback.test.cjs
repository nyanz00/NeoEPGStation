const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const UpdateManager = require('../../dist/model/update/UpdateManager.js').default;
const { captureUpdateArtifacts } = require('../../dist/model/update/UpdateArtifacts.js');

async function createTemporaryRoot(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neo-update-rollback-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return root;
}

async function createOutputs(root) {
    const outputs = {
        'dist/index.js': 'old server output',
        'client/dist/index.html': 'old client output',
    };
    for (const [relativePath, contents] of Object.entries(outputs)) {
        const filePath = path.join(root, relativePath);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, contents);
    }
    return outputs;
}

function createJob() {
    return {
        id: 'rollback-test',
        target: 'develop',
        packageManager: 'npm',
        status: 'running',
        stage: 'checking',
        startedAt: Date.now(),
        finishedAt: null,
        installRan: false,
        restartRequired: false,
        rollback: 'none',
        logs: [],
        error: null,
        command: null,
        exitCode: null,
        timedOut: false,
        stashCommit: null,
    };
}

function createManager(rootDir, job, { packageManifest, onBuild } = {}) {
    const oldCommit = 'a'.repeat(40);
    const targetCommit = 'b'.repeat(40);
    const gitCalls = [];
    let head = oldCommit;
    let developCheckoutCount = 0;
    let buildCount = 0;
    let installCount = 0;
    const manager = Object.create(UpdateManager.prototype);
    Object.assign(manager, {
        rootDir,
        updateDir: path.join(rootDir, 'data', 'update'),
        statePath: path.join(rootDir, 'data', 'update', 'state.json'),
        state: { packageManager: 'npm', nodeVersion: process.version, dependencyHash: 'unchanged', job },
        running: true,
        assertRepository: async () => {},
        getInfo: async () => ({
            targets: { develop: { label: 'develop', commit: targetCommit, tag: null } },
        }),
        getTargetRelation: async () => 'ahead',
        getTargetApplicability: async () => ({ canApply: true, blockedReason: null }),
        assertWindowsServiceWinserUnchanged: async () => {},
        hashDependencyFiles: async () => 'unchanged',
        restoreStashedChanges: async () => {},
        append: () => {},
        setStage(updateJob, stage) {
            updateJob.stage = stage;
        },
        finish(updateJob, status, stage) {
            updateJob.status = status;
            updateJob.stage = stage;
            updateJob.finishedAt = Date.now();
        },
        captureFailure(updateJob, error) {
            updateJob.error = error.message;
        },
        writeState: () => {},
        createBackup: async () => path.join(rootDir, 'backup'),
        install: async () => {
            installCount++;
        },
        build: async () => {
            buildCount++;
            if (onBuild !== undefined) await onBuild();
        },
        git: async args => {
            gitCalls.push(args);
            if (args[0] === 'status') return { stdout: '', stderr: '' };
            if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: head, stderr: '' };
            if (args[0] === 'rev-parse' && args[1] === 'refs/remotes/neoe-update/develop') {
                return { stdout: targetCommit, stderr: '' };
            }
            if (args[0] === 'branch' && args[1] === '--show-current') return { stdout: 'develop', stderr: '' };
            if (args[0] === 'branch' && args[1] === '--list') return { stdout: 'refs/heads/develop', stderr: '' };
            if (args[0] === 'show' && args[1] === `${targetCommit}:package.json`) {
                return {
                    stdout: JSON.stringify(packageManifest ?? { engines: { node: process.version } }),
                    stderr: '',
                };
            }
            if (args[0] === 'diff' && args[1] === '--name-only') return { stdout: '', stderr: '' };
            if (args[0] === 'checkout' && args[1] === 'develop') {
                developCheckoutCount++;
                if (developCheckoutCount > 1) head = oldCommit;
                return { stdout: '', stderr: '' };
            }
            if (args[0] === 'merge' && args[1] === '--ff-only') {
                head = targetCommit;
                return { stdout: '', stderr: '' };
            }
            throw new Error(`Unexpected git command: ${args.join(' ')}`);
        },
    });
    return {
        manager,
        job,
        oldCommit,
        targetCommit,
        gitCalls,
        get buildCount() {
            return buildCount;
        },
        get installCount() {
            return installCount;
        },
    };
}

test('restores saved server and client output after a failed update build without rebuilding during rollback', async t => {
    const root = await createTemporaryRoot(t);
    const outputs = await createOutputs(root);
    const job = createJob();
    const harness = createManager(root, job, {
        onBuild: async () => {
            await fs.writeFile(path.join(root, 'dist/index.js'), 'broken server output');
            await fs.rm(path.join(root, 'client/dist/index.html'), { force: true });
            throw new Error('build failed after corrupting outputs');
        },
    });
    harness.manager.createBackup = async () => {
        const backup = path.join(root, 'backup');
        await fs.mkdir(backup, { recursive: true });
        await captureUpdateArtifacts(root, path.join(backup, 'artifacts'));
        return backup;
    };

    await harness.manager.run(job, 'npm', false);

    assert.equal(harness.buildCount, 1, 'rollback must restore artifacts without another build');
    assert.equal(harness.installCount, 0);
    assert.equal(await fs.readFile(path.join(root, 'dist/index.js'), 'utf8'), outputs['dist/index.js']);
    assert.equal(
        await fs.readFile(path.join(root, 'client/dist/index.html'), 'utf8'),
        outputs['client/dist/index.html'],
    );
    assert.equal(job.rollback, 'success');
    assert.equal(job.status, 'rolled-back');
    assert.equal(job.stage, 'failed');
    assert.equal(harness.manager.running, false);
    assert.ok(harness.gitCalls.some(args => args[0] === 'rev-parse' && args[1] === 'refs/remotes/neoe-update/develop'));
    assert.ok(harness.gitCalls.some(args => args[0] === 'merge' && args[1] === '--ff-only'));
    assert.equal(harness.gitCalls.filter(args => args[0] === 'checkout' && args[1] === 'develop').length, 2);
});

test('rejects an incompatible target engine before checkout, stash, backup, install, or build', async t => {
    const root = await createTemporaryRoot(t);
    const job = createJob();
    const harness = createManager(root, job, { packageManifest: { engines: { node: '>=99.0.0' } } });
    let backupCount = 0;
    harness.manager.createBackup = async () => {
        backupCount++;
        return path.join(root, 'backup');
    };

    await harness.manager.run(job, 'npm', false);

    assert.equal(job.status, 'failed');
    assert.match(job.error, /Node\.js|Node/);
    assert.equal(backupCount, 0);
    assert.equal(harness.installCount, 0);
    assert.equal(harness.buildCount, 0);
    assert.equal(harness.manager.running, false);
    assert.equal(
        harness.gitCalls.some(args => args[0] === 'checkout' || args[0] === 'stash'),
        false,
    );
});
