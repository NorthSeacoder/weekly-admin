import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  backfillWeeklyContents,
  fillOldWeeklyContents,
  autoCreateWeeklyIssue,
  autoLinkWeeklyContents,
  getContentWeeklyInfo,
  linkContentToWeekly,
  unlinkContentFromWeekly,
  getPendingContentsForWeekly,
  batchLinkContentsToWeekly,
} from './weekly-automation';
import { prisma } from '@/lib/db';

// Mock Prisma
vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    contents: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      aggregate: vi.fn(),
    },
    weekly_issues: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    weekly_content_items: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
  },
}));

describe('weekly-automation service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
  });

  describe('backfillWeeklyContents', () => {
    it('should return empty result when no empty issues exist', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

      const result = await backfillWeeklyContents();

      expect(result.processedIssues).toBe(0);
      expect(result.linkedContents).toBe(0);
      expect(result.details).toHaveLength(0);
    });

    it('should match contents to issues by date range', async () => {
      const mockEmptyIssues = [
        {
          id: 1,
          issue_number: 47,
          title: '第 47 期',
          start_date: new Date('2025-01-06'),
          end_date: new Date('2025-01-12'),
        },
      ];

      const mockContents = [
        { id: BigInt(101), title: '内容1', created_at: new Date('2025-01-07') },
        { id: BigInt(102), title: '内容2', created_at: new Date('2025-01-08') },
      ];

      vi.mocked(prisma.$queryRaw).mockResolvedValue(mockEmptyIssues);
      vi.mocked(prisma.contents.findMany).mockResolvedValue(mockContents as any);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(prisma));
      vi.mocked(prisma.weekly_content_items.createMany).mockResolvedValue({ count: 2 });
      vi.mocked(prisma.contents.aggregate).mockResolvedValue({
        _sum: { word_count: 1000, reading_time: 5 },
      } as any);
      vi.mocked(prisma.weekly_issues.update).mockResolvedValue({} as any);

      const result = await backfillWeeklyContents({ dryRun: false });

      expect(result.processedIssues).toBe(1);
      expect(result.linkedContents).toBe(2);
      expect(result.details[0].linkedCount).toBe(2);
    });

    it('should respect maxItemsPerIssue limit', async () => {
      const mockEmptyIssues = [
        {
          id: 1,
          issue_number: 47,
          title: '第 47 期',
          start_date: new Date('2025-01-06'),
          end_date: new Date('2025-01-12'),
        },
      ];

      const mockContents = Array.from({ length: 20 }, (_, i) => ({
        id: BigInt(100 + i),
        title: `内容${i + 1}`,
        created_at: new Date('2025-01-07'),
      }));

      vi.mocked(prisma.$queryRaw).mockResolvedValue(mockEmptyIssues);
      vi.mocked(prisma.contents.findMany).mockResolvedValue(mockContents as any);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(prisma));
      vi.mocked(prisma.weekly_content_items.createMany).mockResolvedValue({ count: 10 });
      vi.mocked(prisma.contents.aggregate).mockResolvedValue({
        _sum: { word_count: 5000, reading_time: 25 },
      } as any);
      vi.mocked(prisma.weekly_issues.update).mockResolvedValue({} as any);

      const result = await backfillWeeklyContents({ maxItemsPerIssue: 10 });

      expect(result.details[0].linkedCount).toBe(10);
    });

    it('should not modify database in dry-run mode', async () => {
      const mockEmptyIssues = [
        {
          id: 1,
          issue_number: 47,
          title: '第 47 期',
          start_date: new Date('2025-01-06'),
          end_date: new Date('2025-01-12'),
        },
      ];

      const mockContents = [
        { id: BigInt(101), title: '内容1', created_at: new Date('2025-01-07') },
      ];

      vi.mocked(prisma.$queryRaw).mockResolvedValue(mockEmptyIssues);
      vi.mocked(prisma.contents.findMany).mockResolvedValue(mockContents as any);

      const result = await backfillWeeklyContents({ dryRun: true });

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(result.linkedContents).toBe(1);
    });
  });

  describe('fillOldWeeklyContents', () => {
    it('should return empty result when no empty issues exist', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

      const result = await fillOldWeeklyContents();

      expect(result.processedIssues).toBe(0);
      expect(result.linkedContents).toBe(0);
      expect(result.details).toHaveLength(0);
    });

    it('should fill empty issues sequentially without date matching', async () => {
      const mockEmptyIssues = [
        {
          id: 1,
          issue_number: 47,
          title: '第 47 期',
          start_date: new Date('2025-01-06'),
          end_date: new Date('2025-01-12'),
        },
        {
          id: 2,
          issue_number: 48,
          title: '第 48 期',
          start_date: new Date('2025-01-13'),
          end_date: new Date('2025-01-19'),
        },
      ];

      const mockContents = [
        { id: BigInt(101), title: '内容1', created_at: new Date('2025-01-01') },
        { id: BigInt(102), title: '内容2', created_at: new Date('2025-01-02') },
        { id: BigInt(103), title: '内容3', created_at: new Date('2025-01-03') },
      ];

      vi.mocked(prisma.$queryRaw).mockResolvedValue(mockEmptyIssues);
      vi.mocked(prisma.contents.findMany).mockResolvedValue(mockContents as any);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(prisma));
      vi.mocked(prisma.weekly_content_items.createMany).mockResolvedValue({ count: 2 } as any);
      vi.mocked(prisma.contents.aggregate).mockResolvedValue({
        _sum: { word_count: 1000, reading_time: 5 },
      } as any);
      vi.mocked(prisma.weekly_issues.update).mockResolvedValue({} as any);

      const result = await fillOldWeeklyContents({ dryRun: false, maxItemsPerIssue: 2 });

      expect(result.processedIssues).toBe(2);
      expect(result.linkedContents).toBe(3);
      expect(result.details[0].issueNumber).toBe(47);
      expect(result.details[0].linkedCount).toBe(2);
      expect(result.details[1].issueNumber).toBe(48);
      expect(result.details[1].linkedCount).toBe(1);
    });
  });

  describe('autoCreateWeeklyIssue', () => {
    it('should return existing issue when already exists', async () => {
      const mockExistingIssue = {
        id: 78,
        issue_number: 78,
        title: '第 78 期',
        start_date: new Date('2026-01-27'),
        end_date: new Date('2026-02-02'),
      };

      vi.mocked(prisma.weekly_issues.findFirst).mockResolvedValue(mockExistingIssue as any);

      const result = await autoCreateWeeklyIssue();

      expect(result.action).toBe('exists');
      expect(result.issue?.issue_number).toBe(78);
    });

    it('should create new issue when not exists', async () => {
      vi.mocked(prisma.weekly_issues.findFirst)
        .mockResolvedValueOnce(null) // 检查是否存在
        .mockResolvedValueOnce({ issue_number: 77 } as any); // 获取最大期号

      const mockNewIssue = {
        id: 78,
        issue_number: 78,
        title: '第 78 期',
        slug: 'weekly-78',
        start_date: new Date('2026-01-27'),
        end_date: new Date('2026-02-02'),
        status: 'draft',
      };

      vi.mocked(prisma.weekly_issues.create).mockResolvedValue(mockNewIssue as any);

      const result = await autoCreateWeeklyIssue();

      expect(result.action).toBe('created');
      expect(result.issue?.issue_number).toBe(78);
    });

    it('should create a cross-week issue from the previous issue end when there is a gap', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-06T12:00:00.000Z'));

      vi.mocked(prisma.weekly_issues.findFirst)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          issue_number: 91,
          end_date: new Date('2026-03-28T00:00:00.000Z'),
        } as unknown as Awaited<ReturnType<typeof prisma.weekly_issues.findFirst>>);

      vi.mocked(prisma.weekly_issues.create).mockResolvedValue({
        id: 92,
        issue_number: 92,
        title: '我不知道的周刊第 92 期',
        slug: 'issue-92',
        start_date: new Date('2026-03-29T00:00:00.000Z'),
        end_date: new Date('2026-07-11T00:00:00.000Z'),
        status: 'draft',
      } as Awaited<ReturnType<typeof prisma.weekly_issues.create>>);

      const result = await autoCreateWeeklyIssue();

      expect(result).toMatchObject({
        action: 'created',
        issue: {
          issue_number: 92,
          start_date: '2026-03-29',
          end_date: '2026-07-11',
        },
      });
      expect(prisma.weekly_issues.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          start_date: new Date('2026-03-29T00:00:00.000Z'),
          end_date: new Date('2026-07-11T00:00:00.000Z'),
        }),
      }));
    });
  });

  describe('autoLinkWeeklyContents', () => {
    it('should link pending contents to weekly issue', async () => {
      const mockIssue = {
        id: 78,
        issue_number: 78,
        title: '第 78 期',
        start_date: new Date('2026-01-27'),
        end_date: new Date('2026-02-02'),
      };

      const mockPendingContents = [
        { id: BigInt(201), title: '新内容1', created_at: new Date('2026-01-28') },
        { id: BigInt(202), title: '新内容2', created_at: new Date('2026-01-29') },
      ];

      vi.mocked(prisma.weekly_issues.findFirst).mockResolvedValue(mockIssue as any);
      vi.mocked(prisma.contents.findMany)
        .mockResolvedValueOnce(mockPendingContents as any) // 待关联内容
        .mockResolvedValueOnce([]); // 已关联到其他周刊的内容
      vi.mocked(prisma.weekly_content_items.count).mockResolvedValue(5);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(prisma));
      vi.mocked(prisma.weekly_content_items.aggregate).mockResolvedValue({
        _max: { sort_order: 5 },
      } as any);
      vi.mocked(prisma.weekly_content_items.createMany).mockResolvedValue({ count: 2 });
      vi.mocked(prisma.weekly_content_items.findMany).mockResolvedValue([
        { content_id: BigInt(201) },
        { content_id: BigInt(202) },
      ] as any);
      vi.mocked(prisma.contents.aggregate).mockResolvedValue({
        _sum: { word_count: 2000, reading_time: 10 },
        _count: 7,
      } as any);
      vi.mocked(prisma.weekly_issues.update).mockResolvedValue({} as any);

      const result = await autoLinkWeeklyContents();

      expect(result.linkedCount).toBe(2);
      expect(result.linkedContents).toHaveLength(2);
      expect(result.issueTitle).toBe('第 78 期');
    });
  });

  describe('getContentWeeklyInfo', () => {
    it('should return linked issue info', async () => {
      const mockContent = {
        id: BigInt(101),
        created_at: new Date('2026-01-28'),
        weekly_content_items: [
          {
            weekly_issue: {
              id: 78,
              issue_number: 78,
              title: '第 78 期',
              status: 'draft',
              start_date: new Date('2026-01-27'),
              end_date: new Date('2026-02-02'),
            },
          },
        ],
      };

      vi.mocked(prisma.contents.findUnique).mockResolvedValue(mockContent as any);

      const result = await getContentWeeklyInfo(101);

      expect(result?.linkedIssue).not.toBeNull();
      expect(result?.linkedIssue?.issue_number).toBe(78);
    });

    it('should return null for non-existent content', async () => {
      vi.mocked(prisma.contents.findUnique).mockResolvedValue(null);

      const result = await getContentWeeklyInfo(999);

      expect(result).toBeNull();
    });
  });

  describe('linkContentToWeekly', () => {
    it('should create link between content and weekly', async () => {
      vi.mocked(prisma.contents.findUnique).mockResolvedValue({
        id: BigInt(101),
        title: '测试内容',
      } as any);
      vi.mocked(prisma.weekly_issues.findUnique).mockResolvedValue({
        id: 78,
        issue_number: 78,
        title: '第 78 期',
      } as any);
      vi.mocked(prisma.weekly_content_items.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.weekly_content_items.aggregate).mockResolvedValue({
        _max: { sort_order: 5 },
      } as any);
      vi.mocked(prisma.weekly_content_items.create).mockResolvedValue({} as any);
      vi.mocked(prisma.weekly_content_items.findMany).mockResolvedValue([]);
      vi.mocked(prisma.weekly_issues.update).mockResolvedValue({} as any);

      const result = await linkContentToWeekly(101, 78);

      expect(result.action).toBe('linked');
    });

    it('should throw error for non-existent content', async () => {
      vi.mocked(prisma.contents.findUnique).mockResolvedValue(null);

      await expect(linkContentToWeekly(999, 78)).rejects.toThrow('内容不存在');
    });
  });

  describe('unlinkContentFromWeekly', () => {
    it('should remove link between content and weekly', async () => {
      vi.mocked(prisma.weekly_content_items.findFirst).mockResolvedValue({
        id: 1,
        weekly_issue_id: 78,
        weekly_issue: {
          id: 78,
          issue_number: 78,
          title: '第 78 期',
        },
      } as any);
      vi.mocked(prisma.weekly_content_items.delete).mockResolvedValue({} as any);
      vi.mocked(prisma.weekly_content_items.findMany).mockResolvedValue([]);
      vi.mocked(prisma.weekly_issues.update).mockResolvedValue({} as any);

      const result = await unlinkContentFromWeekly(101);

      expect(result.action).toBe('unlinked');
    });

    it('should return not_linked for unlinked content', async () => {
      vi.mocked(prisma.weekly_content_items.findFirst).mockResolvedValue(null);

      const result = await unlinkContentFromWeekly(101);

      expect(result.action).toBe('not_linked');
    });
  });

  describe('getPendingContentsForWeekly', () => {
    it('should return pending contents for weekly', async () => {
      vi.mocked(prisma.weekly_issues.findUnique).mockResolvedValue({
        start_date: new Date('2026-01-27'),
        end_date: new Date('2026-02-02'),
      } as any);
      vi.mocked(prisma.contents.findMany).mockResolvedValue([
        { id: BigInt(201), title: '待关联1', status: 'ready', created_at: new Date('2026-01-28') },
        { id: BigInt(202), title: '待关联2', status: 'ready', created_at: new Date('2026-01-29') },
      ] as any);

      const result = await getPendingContentsForWeekly(78);

      expect(result.pendingCount).toBe(2);
      expect(result.contents).toHaveLength(2);
    });

    it('should throw error for non-existent weekly', async () => {
      vi.mocked(prisma.weekly_issues.findUnique).mockResolvedValue(null);

      await expect(getPendingContentsForWeekly(999)).rejects.toThrow('周刊不存在');
    });
  });

  describe('batchLinkContentsToWeekly', () => {
    it('should batch link multiple contents', async () => {
      vi.mocked(prisma.weekly_issues.findUnique).mockResolvedValue({
        id: 78,
        issue_number: 78,
        title: '第 78 期',
      } as any);
      vi.mocked(prisma.contents.findMany).mockResolvedValue([
        { id: BigInt(201), title: '内容1', weekly_content_items: [] },
        { id: BigInt(202), title: '内容2', weekly_content_items: [] },
      ] as any);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(prisma));
      vi.mocked(prisma.weekly_content_items.aggregate).mockResolvedValue({
        _max: { sort_order: 5 },
      } as any);
      vi.mocked(prisma.weekly_content_items.createMany).mockResolvedValue({ count: 2 });
      vi.mocked(prisma.weekly_content_items.findMany).mockResolvedValue([]);
      vi.mocked(prisma.weekly_issues.update).mockResolvedValue({} as any);

      const result = await batchLinkContentsToWeekly(78, [201, 202]);

      expect(result.linkedCount).toBe(2);
    });

    it('should skip already linked contents', async () => {
      vi.mocked(prisma.weekly_issues.findUnique).mockResolvedValue({
        id: 78,
        issue_number: 78,
        title: '第 78 期',
      } as any);
      vi.mocked(prisma.contents.findMany).mockResolvedValue([
        {
          id: BigInt(201),
          title: '内容1',
          weekly_content_items: [{ weekly_issue_id: 77 }],
        },
      ] as any);

      const result = await batchLinkContentsToWeekly(78, [201]);

      expect(result.linkedCount).toBe(0);
      expect(result.skippedCount).toBe(1);
      expect(result.skippedContents[0].reason).toBe('已关联到其他周刊');
    });
  });
});
