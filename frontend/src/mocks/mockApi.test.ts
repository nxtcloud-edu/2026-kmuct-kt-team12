import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockApi } from './mockApi';

describe('mockApi', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // 이벤트가 1초당 하나씩 늘어나므로 시간을 진행시켜 done 으로 만든다
  async function runJobToDone(jobId: string) {
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      const job = await mockApi.getJob(jobId);
      if (job.status !== 'running') return job;
    }
    return mockApi.getJob(jobId);
  }

  it('collect Job은 시간이 지나며 events가 늘고 done되면 기록 8개', async () => {
    const sid = await mockApi.createSession();
    const jobId = await mockApi.startJob(sid, 'collect', { githubToken: 'xxxx' });

    const early = await mockApi.getJob(jobId);
    expect(early.status).toBe('running');
    const startEvents = early.events.length;

    await vi.advanceTimersByTimeAsync(1000);
    const later = await mockApi.getJob(jobId);
    expect(later.events.length).toBeGreaterThanOrEqual(startEvents);

    const doneJob = await runJobToDone(jobId);
    expect(doneJob.status).toBe('done');

    const recs = await mockApi.getRecords(sid);
    expect(recs).toHaveLength(8);
    const withTime = recs.filter((r) => r.timeStart);
    for (let i = 1; i < withTime.length; i++) {
      expect(withTime[i - 1].timeStart! >= withTime[i].timeStart!).toBe(true);
    }
  });

  it('keywords/questions Job으로 키워드 5개, 질문 6개', async () => {
    const sid = await mockApi.createSession();
    await runJobToDone(await mockApi.startJob(sid, 'collect'));
    await runJobToDone(await mockApi.startJob(sid, 'keywords'));

    const kw = await mockApi.getKeywords(sid);
    expect(kw.keywords).toHaveLength(5);
    expect(kw.experiences.length).toBeGreaterThan(0);

    await runJobToDone(await mockApi.startJob(sid, 'questions'));
    const qs = await mockApi.getQuestions(sid);
    expect(qs).toHaveLength(6);
    expect(qs.every((q) => q.status === 'pending')).toBe(true);
  });

  it('running 중 새 Job은 409', async () => {
    const sid = await mockApi.createSession();
    await mockApi.startJob(sid, 'collect');
    await expect(mockApi.startJob(sid, 'collect')).rejects.toMatchObject({ status: 409 });
  });

  it('answer 저장: yes+detail, skip 매핑', async () => {
    const sid = await mockApi.createSession();
    await runJobToDone(await mockApi.startJob(sid, 'collect'));
    await runJobToDone(await mockApi.startJob(sid, 'keywords'));
    await runJobToDone(await mockApi.startJob(sid, 'questions'));
    const qs = await mockApi.getQuestions(sid);

    const a = await mockApi.answerQuestion(sid, qs[0].id, 'yes', '  MySQL 사용  ');
    expect(a.status).toBe('yes');
    expect(a.detail).toBe('MySQL 사용');

    const b = await mockApi.answerQuestion(sid, qs[1].id, 'skip');
    expect(b.status).toBe('skipped');
  });

  it('generate: yes 답변이 answer 경험이 되고 site 생성', async () => {
    const sid = await mockApi.createSession();
    await runJobToDone(await mockApi.startJob(sid, 'collect'));
    await runJobToDone(await mockApi.startJob(sid, 'keywords'));
    await runJobToDone(await mockApi.startJob(sid, 'questions'));
    const qs = await mockApi.getQuestions(sid);
    await mockApi.answerQuestion(sid, qs[0].id, 'yes');

    await runJobToDone(await mockApi.startJob(sid, 'generate'));
    const site = await mockApi.getSite(sid);
    expect(site).not.toBeNull();
    expect(site!.s3Key).toBe(`sites/${sid}/index.html`);

    const kw = await mockApi.getKeywords(sid);
    expect(kw.experiences.some((e) => e.origin === 'answer' && e.questionId === qs[0].id)).toBe(true);
  });
});
