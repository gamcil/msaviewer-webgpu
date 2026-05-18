export function createRafTask(run) {
    let frame = 0;
    let running = false;
    let queued = false;
    let generation = 0;

    async function flush() {
        if (running) {
            queued = true;
            return;
        }

        const runGeneration = generation;
        running = true;
        try {
            await run({
                isCurrent: () => runGeneration === generation,
            });
        } finally {
            running = false;
        }

        if (queued) {
            queued = false;
            schedule();
        }
    }

    function schedule() {
        generation += 1;
        if (frame) return;
        frame = window.requestAnimationFrame(() => {
            frame = 0;
            void flush();
        });
    }

    function cancel() {
        if (frame) {
            window.cancelAnimationFrame(frame);
            frame = 0;
        }
        generation += 1;
        running = false;
        queued = false;
    }

    return { schedule, cancel };
}
