// frontend/src/ui.tsx
// 공용 UI 조각 + 토스트 컨텍스트.

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

export function TopBar({ children }: { children?: ReactNode }) {
  return (
    <div className="topbar">
      <h1>포트폴리오 생성기</h1>
      <span className="spacer" />
      {children}
    </div>
  );
}

interface ToastCtx {
  show: (message: string, kind?: 'info' | 'error') => void;
}
const ToastContext = createContext<ToastCtx>({ show: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; kind: 'info' | 'error' } | null>(null);
  const show = useCallback((message: string, kind: 'info' | 'error' = 'error') => {
    setToast({ message, kind });
    setTimeout(() => setToast(null), 3500);
  }, []);
  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && <div className={`toast ${toast.kind}`}>{toast.message}</div>}
    </ToastContext.Provider>
  );
}

// 에러 메시지 추출 (ApiError 또는 mock 에러)
export function errMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return '알 수 없는 오류가 발생했습니다.';
}
