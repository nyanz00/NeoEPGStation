const assert = require('node:assert/strict');
const test = require('node:test');
const {
    isExpectedUpdateRepository,
    isStartSystemUpdateOption,
    STABLE_UPDATE_TAG_PATTERN,
} = require('../../dist/model/update/UpdateValidation.js');

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
