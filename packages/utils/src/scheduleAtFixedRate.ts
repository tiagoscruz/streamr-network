import { setAbortableTimeout } from './abortableTimers'

/*
 * @param {number} interval - execute task when UTC timestamp is divisible by the given interval
 *                            e.g. scheduleAtFixedRate(() => {},  24 * 60 * 60 * 1000) triggers the
 *                            task once a day at 00:00 UTC
 *                            (but no tasks will be executed concurrently: if a previous task is
 *                            still ongoing when the next task should, the new task is silently skipped)
 */
export const scheduleAtFixedRate = (
    task: (now: number) => Promise<void>,
    interval: number,
    abortSignal: AbortSignal
): void  => {
    repeatScheduleTask((doneCb) => {
        const now = Date.now()
        const next = now - (now % interval) + interval
        setAbortableTimeout(async () => {
            await task(next)
            doneCb()
        }, (next - now), abortSignal)
    }, abortSignal)
}

/** @internal */
export const repeatScheduleTask = (
    scheduleNextTask: (doneCb: () => void) => void,
    abortSignal?: AbortSignal
): void => {
    const scheduleNext = () => {
        if (!abortSignal?.aborted) {
            scheduleNextTask(scheduleNext)
        }
    }
    scheduleNext()
}
