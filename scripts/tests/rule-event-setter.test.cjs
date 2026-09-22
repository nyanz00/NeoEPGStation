const assert = require('node:assert/strict');
const test = require('node:test');
require('reflect-metadata');
const EventSetter = require('../../dist/model/event/EventSetter').default;

function mockMethods() {
    return new Proxy({}, { get: () => () => {} });
}

test('rule reservation update failures are logged and handled for every rule event', async () => {
    const errors = [];
    const callbacks = {};
    const ruleEvent = new Proxy(
        {},
        {
            get: (_target, name) => callback => {
                callbacks[name] = callback;
            },
        },
    );
    const logger = {
        getLogger: () => ({
            system: {
                error: message => errors.push(message),
            },
        }),
    };
    const reservationManage = {
        updateRule: async () => {
            throw new Error('test reservation update failure');
        },
    };
    const recordedManage = {
        removeRuleId: async () => {},
    };
    const setter = new EventSetter(
        logger,
        mockMethods(),
        mockMethods(),
        ruleEvent,
        mockMethods(),
        mockMethods(),
        mockMethods(),
        mockMethods(),
        mockMethods(),
        reservationManage,
        mockMethods(),
        recordedManage,
        mockMethods(),
        mockMethods(),
        mockMethods(),
        mockMethods(),
        mockMethods(),
        mockMethods(),
        { getConfig: () => ({}) },
        mockMethods(),
    );

    setter.set();
    const handlers = ['setAdded', 'setUpdated', 'setEnabled', 'setDisabled', 'setDeleted'];
    for (const [index, name] of handlers.entries()) callbacks[name](index + 1);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(
        errors.filter(message => String(message).startsWith('failed to update reservations for rule. ruleId:')).length,
        handlers.length,
    );
    assert.equal(
        errors.filter(message => message instanceof Error && message.message === 'test reservation update failure')
            .length,
        handlers.length,
    );
});
