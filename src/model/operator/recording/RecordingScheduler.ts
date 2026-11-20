import WallClockScheduler from '../../../util/WallClockScheduler.js';

/** Shared start, end and event-relay clock for all recording sessions in this process. */
export const recordingScheduler = new WallClockScheduler(3000, error =>
    console.error('recording schedule failed', error),
);
