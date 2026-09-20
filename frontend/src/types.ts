// frontend/src/types.ts
// backend 타입을 type-only 로 재수출. frontend는 이 파일을 통해서만 타입을 참조한다.
export type {
  SourceKind,
  RecordItem,
  Experience,
  Keyword,
  Question,
  JobKind,
  Job,
  Connections,
  SiteInfo,
  PortfolioContent,
} from '../../backend/src/types';
