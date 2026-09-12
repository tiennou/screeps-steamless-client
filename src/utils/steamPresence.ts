import { fork, type ChildProcess } from 'child_process';
import chalk from 'chalk';
import type { ServerResponse } from 'http';
import { fileURLToPath } from 'url';
import { Route } from './server.js';
import { logWarning } from './errors.js';

type Closeable = {
    once(event: 'close', listener: () => void): unknown;
};

/** How long to keep Steam presence after the last game socket closes. */
export const STEAM_IDLE_MS = 30_000;

const workerUrl = new URL('./steamPresenceWorker.js', import.meta.url);

type WorkerMessage = { type: 'ready'; name: string } | { type: 'error'; message: string };

function isGameSocketEndpoint(endpoint: string) {
    return endpoint === Route.SOCKET || endpoint.startsWith(`${Route.SOCKET}/`);
}

/**
 * Manages a steamworks.js child process to track playtime to Steam.
 *
 * It'll start the child process when any socket connection is live, and
 * stop it when those connections have been idle.
 */
export class SteamPresence {
    private readonly connections = new Set<object>();
    private child: ChildProcess | null = null;
    private idleTimer: ReturnType<typeof setTimeout> | null = null;
    private stopping = false;

    trackEndpoint(endpoint: string, conn: Closeable, res?: ServerResponse) {
        if (!isGameSocketEndpoint(endpoint)) return;
        this.track(conn);
        const done = () => this.untrack(conn);
        conn.once('close', done);
        if (res) {
            res.once('close', done);
            res.once('finish', done);
        }
    }

    stop() {
        this.connections.clear();
        this.clearIdle();
        this.killChild();
    }

    private track(conn: object) {
        if (this.connections.has(conn)) return;
        this.connections.add(conn);
        this.clearIdle();
        this.ensureChild();
    }

    private untrack(conn: object) {
        if (!this.connections.delete(conn)) return;
        if (this.connections.size === 0) {
            this.scheduleIdle();
        }
    }

    private ensureChild() {
        if (this.child) return;

        this.stopping = false;
        const child = fork(fileURLToPath(workerUrl), [], {
            stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        });
        this.child = child;

        child.on('message', (msg: WorkerMessage) => {
            if (msg.type === 'ready') {
                console.log('🎮', chalk.dim('Steam'), chalk.white(`Playing as ${msg.name}`));
            } else if (msg.type === 'error') {
                logWarning('Steam presence failed to start.', msg.message);
            }
        });

        child.on('error', (err) => {
            logWarning('Steam presence worker error.', err.message);
            if (this.child === child) {
                this.child = null;
            }
        });

        child.on('exit', (code, signal) => {
            if (this.child === child) {
                this.child = null;
            }
            if (!this.stopping && code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGKILL') {
                logWarning('Steam presence worker exited.', code != null ? `code ${code}` : `signal ${signal}`);
            }
        });
    }

    private scheduleIdle() {
        this.clearIdle();
        this.idleTimer = setTimeout(() => {
            this.idleTimer = null;
            if (this.connections.size === 0) {
                this.killChild();
            }
        }, STEAM_IDLE_MS);
        this.idleTimer.unref();
    }

    private clearIdle() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

    private killChild() {
        const child = this.child;
        if (!child) return;
        this.stopping = true;
        console.log('🎮', chalk.dim('Steam'), chalk.gray('presence stopped'));
        child.kill();
        this.child = null;
    }
}
