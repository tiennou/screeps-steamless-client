import * as steamworks from 'steamworks.js';

/** Screeps World on Steam */
const SCREEPS_APP_ID = 464350;

try {
    const client = steamworks.init(SCREEPS_APP_ID);
    const name = client.localplayer.getName();
    process.send?.({ type: 'ready', name });
} catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.send?.({ type: 'error', message });
    process.exit(1);
}
