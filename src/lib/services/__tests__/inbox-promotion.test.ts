// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const findFirstCategoryMock = vi.fn();
const createCategoryMock = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    categories: {
      findFirst: (...args: unknown[]) => findFirstCategoryMock(...args),
      create: (...args: unknown[]) => createCategoryMock(...args),
    },
  },
}));

import { buildContentDataForPromotion } from '@/lib/services/inbox';

const baseItem = {
  title: 'A useful bookmark',
  slug: 'a-useful-bookmark',
  url: 'https://example.com/article',
  summary: 'Short summary',
  description: null,
  note: null,
  content: null,
  image_url: null,
  source_name: 'Example',
  ai_score: 86,
  synced_at: new Date('2026-07-06T01:00:00Z'),
  created_at: new Date('2026-07-06T00:00:00Z'),
  category_suggestion: null,
  data_source: {
    default_content_type_id: 3,
    default_category_id: null,
  },
};

describe('buildContentDataForPromotion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('构造 Prisma checked create data，不写入 category_id 或 auto_promoted', async () => {
    const data = await buildContentDataForPromotion(baseItem, {
      auto_promoted: true,
      original_score: 91,
    });

    expect(data).toMatchObject({
      content_type_id: 3,
      title: 'A useful bookmark',
      slug: 'a-useful-bookmark',
      original_score: 91,
      status: 'ready',
    });
    expect(data).not.toHaveProperty('category_id');
    expect(data).not.toHaveProperty('auto_promoted');
    expect(data).not.toHaveProperty('categories');
  });

  it('有默认分类时使用 categories.connect，避免 Prisma checked input 拒绝 category_id', async () => {
    const data = await buildContentDataForPromotion({
      ...baseItem,
      data_source: {
        default_content_type_id: 3,
        default_category_id: 42,
      },
    });

    expect(data).toMatchObject({
      categories: { connect: { id: 42 } },
    });
    expect(data).not.toHaveProperty('category_id');
  });
});
