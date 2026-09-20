// backend/fixtures/notion.ts
// 노션 search / blocks 응답 샘플.

export const notionSearch = {
  results: [
    {
      id: 'page-1',
      url: 'https://www.notion.so/page-1',
      created_time: '2024-02-01T00:00:00.000Z',
      last_edited_time: '2024-02-10T00:00:00.000Z',
      properties: {
        title: { type: 'title', title: [{ plain_text: '데이터 분석 프로젝트 회고' }] },
      },
    },
  ],
};

export const notionBlocksRoot = {
  results: [
    {
      id: 'b1',
      type: 'paragraph',
      has_children: false,
      paragraph: { rich_text: [{ plain_text: '판다스로 로그 데이터를 전처리했다.' }] },
    },
    {
      id: 'b2',
      type: 'heading_2',
      has_children: true,
      heading_2: { rich_text: [{ plain_text: '결과' }] },
    },
  ],
};

export const notionBlocksChild = {
  results: [
    {
      id: 'b3',
      type: 'bulleted_list_item',
      has_children: false,
      bulleted_list_item: { rich_text: [{ plain_text: '시각화 대시보드를 만들어 공유했다.' }] },
    },
  ],
};
