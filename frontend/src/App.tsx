// src/App.tsx
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { RegisterScreen } from './screens/RegisterScreen';
import { RunScreen } from './screens/RunScreen';
import { MasterScreen } from './screens/MasterScreen';
import { TailorBuilderScreen } from './screens/TailorBuilderScreen';
import { TailoredScreen } from './screens/TailoredScreen';
import { MatchScreen } from './screens/MatchScreen';

export function App() {
    return (
        <BrowserRouter>
            <header className="topbar">
                <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <h1>포트폴리오 생성기</h1>
                </Link>
                <span className="muted">링크와 파일에서 근거 있는 포트폴리오를</span>
            </header>
            <Routes>
                <Route path="/" element={<RegisterScreen />} />
                <Route path="/p/:id/run/:runId" element={<RunScreen />} />
                <Route path="/p/:id" element={<MasterScreen />} />
                <Route path="/p/:id/match" element={<MatchScreen />} />
                <Route path="/p/:id/tailor" element={<TailorBuilderScreen />} />
                <Route path="/p/:id/o/:outputId" element={<TailoredScreen />} />
            </Routes>
        </BrowserRouter>
    );
}
