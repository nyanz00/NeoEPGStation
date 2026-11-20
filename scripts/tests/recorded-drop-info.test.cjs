const assert = require('node:assert/strict');
const test = require('node:test');
const recordedDropInfoHelpers = import('../../client/src/components/recordedDropInfoHelpers.mjs');

test('drop info flags any positive drop, error, or scrambling count', async () => {
    const { hasRecordedDropError } = await recordedDropInfoHelpers;
    assert.equal(hasRecordedDropError({ dropCnt: 0, errorCnt: 0, scramblingCnt: 0 }), false);
    assert.equal(hasRecordedDropError({ dropCnt: 1, errorCnt: 0, scramblingCnt: 0 }), true);
    assert.equal(hasRecordedDropError({ dropCnt: 0, errorCnt: 1, scramblingCnt: 0 }), true);
    assert.equal(hasRecordedDropError({ dropCnt: 0, errorCnt: 0, scramblingCnt: 1 }), true);
});

test('drop info sums all video files and formats zero and unit boundaries', async () => {
    const { formatRecordedVideoFileSize, sumRecordedVideoFileSize } = await recordedDropInfoHelpers;
    assert.equal(sumRecordedVideoFileSize(undefined), 0);
    assert.equal(sumRecordedVideoFileSize([{ size: 1024 }, { size: 1024 * 1024 }]), 1024 + 1024 * 1024);
    assert.equal(formatRecordedVideoFileSize(0), '0.0B');
    assert.equal(formatRecordedVideoFileSize(1023), '1023.0B');
    assert.equal(formatRecordedVideoFileSize(1024), '1.0KB');
    assert.equal(formatRecordedVideoFileSize(1024 ** 2), '1.0MB');
});
