// frontend/src/useJobPolling.ts
// 1.5초마다 Job을 폴링해 events를 쌓아 보여준다. 5분 지나도 running이면 멈춘다.
// 화면을 떠나면 폴링 정리.

import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { Job } from './types';

const POLL_MS = 1500;
const MAX_MS = 5 * 60 * 1000;

export interface JobPollingState {
  job: Job | null;
  timedOut: boolean;
  error: string | null;
}

export function useJobPolling(jobId: string | undefined): JobPollingState {
  const [state, setState] = useState<JobPollingState>({ job: null, timedOut: false, error: null });
  const startRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    startRef.current = Date.now();

    const tick = async () => {
      if (!alive) return;
      try {
        const job = await api.getJob(jobId);
        if (!alive) return;
        if (job.status === 'running' && Date.now() - startRef.current > MAX_MS) {
          setState({ job, timedOut: true, error: null });
          return; // 폴링 중단
        }
        setState({ job, timedOut: false, error: null });
        if (job.status === 'running') {
          timer = setTimeout(tick, POLL_MS);
        }
      } catch (e) {
        if (!alive) return;
        setState((s) => ({ ...s, error: e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : '작업 상태를 불러오지 못했습니다.' }));
        timer = setTimeout(tick, POLL_MS);
      }
    };
    tick();

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [jobId]);

  return state;
}
