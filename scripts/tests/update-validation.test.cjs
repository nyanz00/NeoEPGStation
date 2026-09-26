const assert = require('node:assert/strict');
const test = require('node:test');
const {
    isExpectedUpdateRepository,
    isSupportedStableUpdateTarget,
    isStartSystemUpdateOption,
    STABLE_UPDATE_TAG_PATTERN,
} = require('../../dist/model/update/UpdateValidation.js');
const {
    createUpdateCommandInvocation,
    createUpdatePackageEnvironment,
    stripUpdateLogControlSequences,
} = require('../../dist/model/update/UpdateCommand.js');
const { shouldInstallUpdateDependencies } = require('../../dist/model/update/UpdateDependency.js');
const UpdateManager = require('../../dist/model/update/UpdateManager.js').default;

test('update API accepts only fixed target and package manager enums', () => {
    assert.equal(
        isStartSystemUpdateOption({ target: 'stable', packageManager: 'auto', preserveLocalChanges: false }),
        true,
    );
    assert.equal(
        isStartSystemUpdateOption({ target: 'develop', packageManager: 'pnpm', preserveLocalChanges: true }),
        true,
    );
    for (const target of ['--upload-pack=evil', '../../etc/passwd', 'tag; rm -rf /', '-b', 'a'.repeat(101)]) {
        assert.equal(isStartSystemUpdateOption({ target, packageManager: 'npm', preserveLocalChanges: false }), false);
    }
    assert.equal(
        isStartSystemUpdateOption({ target: 'stable', packageManager: 'npm; calc', preserveLocalChanges: false }),
        false,
    );
    assert.equal(isStartSystemUpdateOption({ target: 'stable', packageManager: 'npm' }), false);
});

test('only the NeoEPGStation origin is accepted', () => {
    assert.equal(isExpectedUpdateRepository('https://github.com/nyanz00/NeoEPGStation.git'), true);
    assert.equal(isExpectedUpdateRepository('git@github.com:nyanz00/NeoEPGStation.git'), true);
    assert.equal(isExpectedUpdateRepository('https://example.com/nyanz00/NeoEPGStation.git'), false);
    assert.equal(isExpectedUpdateRepository('https://github.com/attacker/NeoEPGStation.git'), false);
});

test('stable update tags exclude prereleases and option-like input', () => {
    assert.equal(STABLE_UPDATE_TAG_PATTERN.test('v2.10.0'), true);
    for (const tag of ['v2.10.0-beta3', 'v2.10.0-rc1', '--upload-pack=evil', 'v2.10.0;calc']) {
        assert.equal(STABLE_UPDATE_TAG_PATTERN.test(tag), false);
    }
});

test('stable updater rejects releases from before the React migration', () => {
    assert.equal(isSupportedStableUpdateTarget('v2.10.0', false), false);
    assert.equal(isSupportedStableUpdateTarget('v2.9.1', false), false);
    assert.equal(isSupportedStableUpdateTarget('v1.0.0', true), true);
    assert.equal(isSupportedStableUpdateTarget('v1.0.0-beta.4', true), false);
});

test('Windows command shims are launched through cmd.exe', () => {
    assert.deepEqual(
        createUpdateCommandInvocation('C:\\node\\pnpm.cmd', ['install'], 'win32', 'C:\\Windows\\cmd.exe'),
        {
            command: 'C:\\Windows\\cmd.exe',
            args: ['/d', '/s', '/c', 'C:\\node\\pnpm.cmd', 'install'],
        },
    );
    assert.deepEqual(createUpdateCommandInvocation('git.exe', ['status'], 'win32', 'C:\\Windows\\cmd.exe'), {
        command: 'git.exe',
        args: ['status'],
    });
});

test('package commands run non-interactively without discarding the service environment', () => {
    assert.deepEqual(createUpdatePackageEnvironment({ PATH: 'C:\\node', CI: 'false' }), {
        PATH: 'C:\\node',
        CI: 'true',
        COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    });
});

test('first updater run skips install when dependency files are unchanged', () => {
    const current = { packageManager: 'pnpm', nodeVersion: 'v24.18.0', dependencyHash: 'current' };
    assert.equal(shouldInstallUpdateDependencies(false, current, {}), false);
    assert.equal(shouldInstallUpdateDependencies(true, current, {}), true);
});

test('saved dependency environment changes still require install', () => {
    const current = { packageManager: 'pnpm', nodeVersion: 'v24.18.0', dependencyHash: 'current' };
    assert.equal(shouldInstallUpdateDependencies(false, current, current), false);
    assert.equal(shouldInstallUpdateDependencies(false, current, { ...current, packageManager: 'npm' }), true);
    assert.equal(shouldInstallUpdateDependencies(false, current, { ...current, nodeVersion: 'v22.22.0' }), true);
    assert.equal(shouldInstallUpdateDependencies(false, current, { ...current, dependencyHash: 'previous' }), true);
});

test('ANSI color sequences are removed from update logs', () => {
    assert.equal(stripUpdateLogControlSequences('\u001b[32m[INFO]\u001b[39m backup'), '[INFO] backup');
});

test('repackaged stable release follows its matching develop source commit', async () => {
    const older = '1'.repeat(40);
    const source = '2'.repeat(40);
    const newer = '3'.repeat(40);
    const stable = '4'.repeat(40);
    const tree = 'a'.repeat(40);
    const updater = Object.create(UpdateManager.prototype);
    updater.getCommitRelation = async () => 'diverged';
    updater.gitRequiredText = async args =>
        args[0] === 'rev-parse' ? tree : `${source}\t${tree}\n${older}\t${'b'.repeat(40)}`;
    updater.isAncestor = async (ancestor, descendant) =>
        (ancestor === older && descendant === source) || (ancestor === source && descendant === newer);

    assert.equal(await updater.getTargetRelation('stable', older, stable), 'ahead');
    assert.equal(await updater.getTargetRelation('stable', source, stable), 'ahead');
    assert.equal(await updater.getTargetRelation('stable', newer, stable), 'behind');
    assert.equal(await updater.getTargetRelation('develop', older, stable), 'diverged');
});

test('stable release can update to a newer develop commit on the same content line', async () => {
    const source = '1'.repeat(40);
    const newerDevelop = '2'.repeat(40);
    const stable = '3'.repeat(40);
    const tree = 'a'.repeat(40);
    const updater = Object.create(UpdateManager.prototype);
    updater.getCommitRelation = async () => 'diverged';
    updater.gitRequiredText = async args => (args[0] === 'rev-parse' ? tree : `${source}\t${tree}`);
    updater.isAncestor = async (ancestor, descendant) =>
        (ancestor === stable && descendant === 'refs/remotes/neoe-update/nyanz-master') ||
        (ancestor === source && descendant === newerDevelop);

    assert.equal(await updater.getTargetRelation('develop', stable, source), 'ahead');
    assert.equal(await updater.getTargetRelation('develop', stable, newerDevelop), 'ahead');
    updater.isAncestor = async (ancestor, descendant) =>
        ancestor === stable && descendant === 'refs/remotes/neoe-update/nyanz-master';
    assert.equal(await updater.getTargetRelation('develop', stable, newerDevelop), 'diverged');
    updater.isAncestor = async () => false;
    assert.equal(await updater.getTargetRelation('develop', stable, newerDevelop), 'diverged');
});

test('repackaged stable release rejects unknown and ambiguous histories', async () => {
    const current = '1'.repeat(40);
    const source = '2'.repeat(40);
    const otherSource = '3'.repeat(40);
    const stable = '4'.repeat(40);
    const tree = 'a'.repeat(40);
    const updater = Object.create(UpdateManager.prototype);
    updater.getCommitRelation = async () => 'diverged';
    updater.gitRequiredText = async args => (args[0] === 'rev-parse' ? tree : `${source}\t${'b'.repeat(40)}`);
    updater.isAncestor = async () => false;

    assert.equal(await updater.getTargetRelation('stable', current, stable), 'diverged');
    updater.gitRequiredText = async args => (args[0] === 'rev-parse' ? tree : `${source}\t${tree}`);
    assert.equal(await updater.getTargetRelation('stable', current, stable), 'diverged');
    updater.gitRequiredText = async args =>
        args[0] === 'rev-parse' ? tree : `${source}\t${tree}\n${otherSource}\t${tree}`;
    updater.isAncestor = async (ancestor, descendant) =>
        (ancestor === current && descendant === source) || (ancestor === otherSource && descendant === current);
    assert.equal(await updater.getTargetRelation('stable', current, stable), 'diverged');
    updater.gitRequiredText = async () => {
        throw new Error('develop history unavailable');
    };
    assert.equal(await updater.getTargetRelation('stable', current, stable), 'unknown');
});

test('repackaged stable rollback still checks database compatibility', async () => {
    const updater = Object.create(UpdateManager.prototype);
    updater.isAncestor = async () => true;
    updater.getDatabaseRollbackBlockReason = async () => 'DB schema is incompatible';
    assert.deepEqual(await updater.getTargetApplicability('stable', 'behind', 'current', 'stable'), {
        canApply: false,
        blockedReason: 'DB schema is incompatible',
    });
});
