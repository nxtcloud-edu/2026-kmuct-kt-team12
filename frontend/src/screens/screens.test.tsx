// src/screens/screens.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MasterScreen } from './MasterScreen';
import { TailoredScreen } from './TailoredScreen';

function renderAt(path: string, element: React.ReactNode, routePath: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path={routePath} element={element} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('화면 3 마스터 타임라인 (T1)', () => {
    it('fixtures 활동이 시간순으로 렌더된다', async () => {
        renderAt('/p/pf-demo', <MasterScreen />, '/p/:id');
        // 세 활동 제목이 보인다
        await waitFor(() => expect(screen.getByText('개발 스터디 운영')).toBeInTheDocument());
        expect(screen.getByText('실시간 크롤러 프로젝트')).toBeInTheDocument();
        expect(screen.getByText('결제 모듈 개발')).toBeInTheDocument();
        // 버튼
        expect(screen.getByText('다시 불러오기')).toBeInTheDocument();
        expect(screen.getByText('직무 맞춤 만들기')).toBeInTheDocument();
    });

    it('추정 기간에 "추정" 꼬리표가 붙는다', async () => {
        renderAt('/p/pf-demo', <MasterScreen />, '/p/:id');
        await waitFor(() => expect(screen.getAllByText('추정').length).toBeGreaterThan(0));
    });

    it('문장을 클릭하면 원문 근거 패널이 열린다 (T3 근거추적)', async () => {
        renderAt('/p/pf-demo', <MasterScreen />, '/p/:id');
        // 제목(활동) 클릭 → 펼침
        const title = await screen.findByText('실시간 크롤러 프로젝트');
        fireEvent.click(title);
        // 요약 문장 클릭 → 근거 패널
        const summary = await screen.findByText('REST API를 설계하고 크롤링 병목을 해결한 프로젝트');
        fireEvent.click(summary);
        await waitFor(() => expect(screen.getByLabelText('근거 패널')).toBeInTheDocument());
        // 원문 구절이 보인다
        expect(screen.getByText(/REST API를 설계하고 대용량 크롤링의 병목을 해결했다/)).toBeInTheDocument();
    });
});

describe('화면 5 맞춤 포트폴리오 (T1)', () => {
    it('자기소개·역량·공백 리포트가 렌더된다', async () => {
        renderAt('/p/pf-demo/o/out-backend', <TailoredScreen />, '/p/:id/o/:outputId');
        await waitFor(() =>
            expect(screen.getByText('백엔드 개발자 맞춤 포트폴리오')).toBeInTheDocument(),
        );
        // 역량 태그
        expect(screen.getByText('REST API 설계')).toBeInTheDocument();
        // 공백 리포트: CI/CD 근거 없음
        expect(screen.getByText(/CI\/CD: 근거 없음/)).toBeInTheDocument();
        // PDF 버튼
        expect(screen.getByText('PDF로 내보내기')).toBeInTheDocument();
    });
});

describe('화면 3 직접 수정 + 칸 잠금 (T9)', () => {
    it('요약을 수정·저장하면 값이 바뀌고 잠김 배지가 뜬다', async () => {
        renderAt('/p/pf-demo', <MasterScreen />, '/p/:id');
        // 활동 펼치기
        const title = await screen.findByText('실시간 크롤러 프로젝트');
        fireEvent.click(title);
        // 요약 "수정" 버튼 (첫 번째)
        const editBtns = await screen.findAllByText('수정');
        fireEvent.click(editBtns[0]);
        // textarea 에 새 값 입력
        const ta = await screen.findByDisplayValue('REST API를 설계하고 크롤링 병목을 해결한 프로젝트');
        fireEvent.change(ta, { target: { value: '내가 직접 고친 요약' } });
        fireEvent.click(screen.getByText('저장(칸 잠금)'));
        // 저장 후 새 값과 잠김 배지
        await waitFor(() => expect(screen.getByText('내가 직접 고친 요약')).toBeInTheDocument());
        await waitFor(() => expect(screen.getAllByText(/잠김/).length).toBeGreaterThan(0));
    });
});
