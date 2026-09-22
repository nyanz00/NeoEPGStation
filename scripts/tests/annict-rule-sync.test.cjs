const assert = require('node:assert/strict');
const test = require('node:test');
require('reflect-metadata');
const AnnictApiModel = require('../../dist/model/api/annict/AnnictApiModel').default;

function createModel(findRuleId) {
    const logger = {
        getLogger: () => ({
            system: {
                warn: () => {},
            },
        }),
    };
    return new AnnictApiModel({}, {}, { findRuleId }, {}, {}, {}, {}, {}, () => ({}), {}, logger);
}

test('legacy link import failures are reported when no rule link can be resolved', async () => {
    const model = createModel(async () => null);
    model.ensureLegacyRuleLinksImported = async () => 'legacy import failure';

    assert.equal(await model.syncEnabledRule(1), 'legacy import failure');
    assert.equal(await model.syncDisabledRule(1), 'legacy import failure');
});

test('an existing DB rule link is synchronized even when legacy import fails', async () => {
    const link = { annictId: 10, viewerProfileId: 20 };
    const model = createModel(async () => link);
    const updates = [];
    model.ensureLegacyRuleLinksImported = async () => 'legacy import failure';
    model.getViewerStatuses = async () => ({ statuses: [] });
    model.setViewerStatus = async (...args) => updates.push(args);
    model.hasAnotherEnabledLinkedRule = async () => false;

    assert.equal(await model.syncEnabledRule(1), undefined);
    assert.equal(await model.syncDisabledRule(1), undefined);
    assert.deepEqual(updates, [
        [10, 'watching', 20],
        [10, 'stop_watching', 20],
    ]);
});
