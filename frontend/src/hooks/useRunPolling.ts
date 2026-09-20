// src/hooks/useRunPolling.ts
import { useEffect, useRef, useState } from 'react';
import type { Run } from '@shared/types';
import { api } from '../api';

/** runId 를 1.5초 간격으로 폴링하고, status 가 done/failed 면 멈춘다. */
export function useRunPolling(runId: string | null, intervalMs = 1500) {
    const [run, setRun] = useState<Run | null>(null);
    const timer = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        if (!runId) return;
        let cancelled = false;

        async function poll() {
            try {
                const r = await api.getRun(runId!);
                if (cancelled) return;
                setRun(r);
                if (r.status === 'done' || r.status === 'failed') {
                    if (timer.current) clearInterval(timer.current);
                    timer.current = null;
                }
            } catch {
                // 네트워크 일시 오류는 다음 틱에서 재시도
            }
        }

        poll();
        timer.current = setInterval(poll, intervalMs);
        return () => {
            cancelled = true;
            if (timer.current) clearInterval(timer.current);
        };
    }, [runId, intervalMs]);

    return run;
}
