import { prisma } from '@/lib/db';
import {
  getWeekRange,
  isDateInWeeklyRange,
  generateWeeklyTitle,
  generateWeeklySlug,
  getWeekRangeByOffset,
} from '@/lib/utils/weekly-date';

// ============================================================================
// Types
// ============================================================================

export interface BackfillOptions {
  dryRun?: boolean;
  maxItemsPerIssue?: number;
}

export interface BackfillResult {
  processedIssues: number;
  linkedContents: number;
  skippedContents: number;
  details: Array<{
    issueId: number;
    issueNumber: number;
    linkedCount: number;
    linkedContents: Array<{ id: number; title: string }>;
  }>;
}

export interface FillOldOptions {
  dryRun?: boolean;
  maxItemsPerIssue?: number;
  /**
   * 安全护栏：只处理已结束的历史空周刊（end_date < 当前周周一）
   */
  historyOnly?: boolean;
}

export interface AutoCreateOptions {
  forceCreate?: boolean;
  weekOffset?: number;
}

export interface AutoCreateResult {
  action: 'created' | 'exists' | 'skipped';
  issue?: {
    id: number;
    issue_number: number;
    title: string;
    start_date: string;
    end_date: string;
  };
  message?: string;
}

export interface AutoLinkOptions {
  maxItems?: number;
  weekOffset?: number;
}

export interface AutoLinkResult {
  issueId: number;
  issueNumber: number;
  issueTitle: string;
  linkedCount: number;
  skippedCount: number;
  linkedContents: Array<{ id: number; title: string }>;
  skippedContents: Array<{ id: number; title: string; reason: string }>;
}

function toUtcDateOnly(date: Date | string): Date {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addUtcDays(date: Date | string, days: number): Date {
  const d = toUtcDateOnly(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function resolveContinuousStartDate(
  targetStartDate: Date,
  targetEndDate: Date,
  lastIssue?: { end_date?: Date | null } | null
): Date {
  if (!lastIssue?.end_date) return targetStartDate;

  const nextStartDate = addUtcDays(lastIssue.end_date, 1);
  return nextStartDate <= targetEndDate ? nextStartDate : targetStartDate;
}

// ============================================================================
// Backfill Service
// ============================================================================

/**
 * 回填历史空周刊的内容
 * 根据内容的 created_at 时间匹配对应周期的周刊
 */
export async function backfillWeeklyContents(
  options: BackfillOptions = {}
): Promise<BackfillResult> {
  const { dryRun = false, maxItemsPerIssue = 15 } = options;

  // 1. 查询所有空周刊（没有关联内容的周刊）
  const emptyIssues = await prisma.$queryRaw<
    Array<{
      id: number;
      issue_number: number;
      title: string;
      start_date: Date;
      end_date: Date;
    }>
  >`
    SELECT wi.id, wi.issue_number, wi.title, wi.start_date, wi.end_date
    FROM weekly_issues wi
    LEFT JOIN weekly_content_items wci ON wi.id = wci.weekly_issue_id
    GROUP BY wi.id
    HAVING COUNT(wci.id) = 0
    ORDER BY wi.issue_number ASC
  `;

  if (emptyIssues.length === 0) {
    return {
      processedIssues: 0,
      linkedContents: 0,
      skippedContents: 0,
      details: [],
    };
  }

  // 2. 查询所有未关联周刊的内容
  const unlinkedContents = await prisma.contents.findMany({
    where: {
      content_type_id: 3,
      status: { in: ['ready', 'published'] },
      weekly_content_items: { none: {} },
    },
    select: {
      id: true,
      title: true,
      created_at: true,
    },
    orderBy: { created_at: 'asc' },
  });

  // 3. 按周刊时间范围分配内容
  const result: BackfillResult = {
    processedIssues: 0,
    linkedContents: 0,
    skippedContents: 0,
    details: [],
  };

  const usedContentIds = new Set<bigint>();

  for (const issue of emptyIssues) {
    const matchedContents = unlinkedContents
      .filter((content) => {
        if (usedContentIds.has(content.id)) return false;
        if (!content.created_at) return false;
        return isDateInWeeklyRange(
          content.created_at,
          issue.start_date,
          issue.end_date
        );
      })
      .slice(0, maxItemsPerIssue);

    if (matchedContents.length === 0) {
      continue;
    }

    // 标记已使用的内容
    matchedContents.forEach((c) => usedContentIds.add(c.id));

    const detail = {
      issueId: issue.id,
      issueNumber: issue.issue_number,
      linkedCount: matchedContents.length,
      linkedContents: matchedContents.map((c) => ({
        id: Number(c.id),
        title: c.title,
      })),
    };

    result.details.push(detail);
    result.processedIssues++;
    result.linkedContents += matchedContents.length;

    // 4. 如果不是 dry-run，执行实际关联
    if (!dryRun) {
      await prisma.$transaction(async (tx) => {
        // 创建关联记录
        await tx.weekly_content_items.createMany({
          data: matchedContents.map((content, index) => ({
            weekly_issue_id: issue.id,
            content_id: content.id,
            sort_order: index,
          })),
        });

        // 更新周刊统计
        const stats = await tx.contents.aggregate({
          where: { id: { in: matchedContents.map((c) => c.id) } },
          _sum: { word_count: true, reading_time: true },
        });

        await tx.weekly_issues.update({
          where: { id: issue.id },
          data: {
            total_items: matchedContents.length,
            total_word_count: stats._sum.word_count || 0,
            reading_time: stats._sum.reading_time || 0,
          },
        });
      });
    }
  }

  // 计算跳过的内容数
  result.skippedContents = unlinkedContents.length - result.linkedContents;

  return result;
}

// ============================================================================
// Fast Fill-Old Service
// ============================================================================

/**
 * 快速填满历史空周刊（不按 created_at 匹配周范围）
 *
 * 规则：
 * - 只处理空周刊（没有任何关联内容）
 * - 默认只处理已结束的历史周刊（end_date < 当前周周一），避免消耗新内容
 * - 只关联未被任何周刊关联的内容，按 created_at 升序依次填充
 * - 内容过滤：content_type_id=3 且 status in ('draft','ready','published')
 */
export async function fillOldWeeklyContents(
  options: FillOldOptions = {}
): Promise<BackfillResult> {
  const { dryRun = false, maxItemsPerIssue = 15, historyOnly = true } = options;

  const currentWeekStart = getWeekRangeByOffset(0).startDate;

  const emptyIssues = await prisma.$queryRaw<
    Array<{
      id: number;
      issue_number: number;
      title: string;
      start_date: Date;
      end_date: Date;
    }>
  >`
    SELECT wi.id, wi.issue_number, wi.title, wi.start_date, wi.end_date
    FROM weekly_issues wi
    LEFT JOIN weekly_content_items wci ON wi.id = wci.weekly_issue_id
    WHERE (${historyOnly} = FALSE OR wi.end_date < ${currentWeekStart})
    GROUP BY wi.id
    HAVING COUNT(wci.id) = 0
    ORDER BY wi.issue_number ASC
  `;

  if (emptyIssues.length === 0) {
    return {
      processedIssues: 0,
      linkedContents: 0,
      skippedContents: 0,
      details: [],
    };
  }

  const unlinkedContents = await prisma.contents.findMany({
    where: {
      content_type_id: 3,
      status: { in: ['draft', 'ready', 'published'] },
      created_at: historyOnly ? { lt: currentWeekStart } : undefined,
      weekly_content_items: { none: {} },
    },
    select: {
      id: true,
      title: true,
      created_at: true,
    },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
  });

  const result: BackfillResult = {
    processedIssues: 0,
    linkedContents: 0,
    skippedContents: 0,
    details: [],
  };

  // 使用指针按顺序分配，避免多次 filter
  let cursor = 0;
  for (const issue of emptyIssues) {
    const matched = unlinkedContents.slice(cursor, cursor + maxItemsPerIssue);
    if (matched.length === 0) break;

    cursor += matched.length;

    const detail = {
      issueId: issue.id,
      issueNumber: issue.issue_number,
      linkedCount: matched.length,
      linkedContents: matched.map((c) => ({ id: Number(c.id), title: c.title })),
    };

    result.details.push(detail);
    result.processedIssues += 1;
    result.linkedContents += matched.length;

    if (!dryRun) {
      await prisma.$transaction(async (tx) => {
        await tx.weekly_content_items.createMany({
          data: matched.map((content, index) => ({
            weekly_issue_id: issue.id,
            content_id: content.id,
            sort_order: index,
          })),
        });

        const stats = await tx.contents.aggregate({
          where: { id: { in: matched.map((c) => c.id) } },
          _sum: { word_count: true, reading_time: true },
        });

        await tx.weekly_issues.update({
          where: { id: issue.id },
          data: {
            total_items: matched.length,
            total_word_count: stats._sum.word_count || 0,
            reading_time: stats._sum.reading_time || 0,
          },
        });
      });
    }
  }

  result.skippedContents = Math.max(0, unlinkedContents.length - result.linkedContents);
  return result;
}

// ============================================================================
// Auto Create Service
// ============================================================================

/**
 * 自动创建本周周刊
 */
export async function autoCreateWeeklyIssue(
  options: AutoCreateOptions = {}
): Promise<AutoCreateResult> {
  const { forceCreate = false, weekOffset = 0 } = options;

  // 1. 获取目标周的时间范围
  const weekRange = getWeekRangeByOffset(weekOffset);

  // 2. 检查目标周是否已被某一期覆盖。周刊允许跨周，不能只做精确日期匹配。
  const existingIssue = await prisma.weekly_issues.findFirst({
    where: {
      start_date: { lte: weekRange.endDate },
      end_date: { gte: weekRange.startDate },
    },
    orderBy: { issue_number: 'desc' },
  });

  if (existingIssue && !forceCreate) {
    return {
      action: 'exists',
      issue: {
        id: existingIssue.id,
        issue_number: existingIssue.issue_number,
        title: existingIssue.title,
        start_date: formatUtcDate(toUtcDateOnly(existingIssue.start_date)),
        end_date: formatUtcDate(toUtcDateOnly(existingIssue.end_date)),
      },
      message: '该周周刊已存在',
    };
  }

  // 3. 获取最大期号，并让下一期从上一期结束后一天接上；
  // 如果中间断更，则本期跨周覆盖空档直到目标周末。
  const lastIssue = await prisma.weekly_issues.findFirst({
    orderBy: { issue_number: 'desc' },
    select: { issue_number: true, end_date: true },
  });

  const nextIssueNumber = (lastIssue?.issue_number || 0) + 1;
  const startDate = resolveContinuousStartDate(weekRange.startDate, weekRange.endDate, lastIssue);

  // 4. 创建新周刊
  const newIssue = await prisma.weekly_issues.create({
    data: {
      issue_number: nextIssueNumber,
      title: generateWeeklyTitle(nextIssueNumber),
      slug: generateWeeklySlug(nextIssueNumber),
      start_date: startDate,
      end_date: weekRange.endDate,
      status: 'draft',
      total_items: 0,
      total_word_count: 0,
      reading_time: 0,
    },
  });

  return {
    action: 'created',
    issue: {
      id: newIssue.id,
      issue_number: newIssue.issue_number,
      title: newIssue.title,
      start_date: formatUtcDate(toUtcDateOnly(newIssue.start_date)),
      end_date: weekRange.endDateStr,
    },
  };
}

// ============================================================================
// Auto Link Service
// ============================================================================

/**
 * 自动关联本周内容到周刊
 */
export async function autoLinkWeeklyContents(
  options: AutoLinkOptions = {}
): Promise<AutoLinkResult> {
  const { maxItems = 15, weekOffset = 0 } = options;

  // 1. 获取目标周的时间范围
  const weekRange = getWeekRangeByOffset(weekOffset);

  // 2. 查找或创建该周的周刊
  let issue = await prisma.weekly_issues.findFirst({
    where: {
      start_date: { lte: weekRange.endDate },
      end_date: { gte: weekRange.startDate },
    },
    orderBy: { issue_number: 'desc' },
  });

  if (!issue) {
    const createResult = await autoCreateWeeklyIssue({ weekOffset });
    if (createResult.action !== 'created' || !createResult.issue) {
      throw new Error('无法创建周刊');
    }
    issue = await prisma.weekly_issues.findUnique({
      where: { id: createResult.issue.id },
    });
    if (!issue) {
      throw new Error('创建周刊后无法找到');
    }
  }

  // 3. 查询该周时间范围内未关联的内容
  const pendingContents = await prisma.contents.findMany({
    where: {
      content_type_id: 3,
      status: { in: ['ready', 'published'] },
      created_at: {
        gte: weekRange.startDate,
        lte: weekRange.endDate,
      },
      weekly_content_items: { none: {} },
    },
    select: {
      id: true,
      title: true,
      created_at: true,
    },
    orderBy: { created_at: 'asc' },
  });

  // 4. 检查已关联到其他周刊的内容
  const alreadyLinked = await prisma.contents.findMany({
    where: {
      content_type_id: 3,
      status: { in: ['ready', 'published'] },
      created_at: {
        gte: weekRange.startDate,
        lte: weekRange.endDate,
      },
      weekly_content_items: {
        some: {
          weekly_issue_id: { not: issue.id },
        },
      },
    },
    select: {
      id: true,
      title: true,
    },
  });

  const result: AutoLinkResult = {
    issueId: issue.id,
    issueNumber: issue.issue_number,
    issueTitle: issue.title,
    linkedCount: 0,
    skippedCount: alreadyLinked.length,
    linkedContents: [],
    skippedContents: alreadyLinked.map((c) => ({
      id: Number(c.id),
      title: c.title,
      reason: '已关联到其他周刊',
    })),
  };

  // 5. 获取当前周刊已有的内容数量
  const existingCount = await prisma.weekly_content_items.count({
    where: { weekly_issue_id: issue.id },
  });

  const remainingSlots = Math.max(0, maxItems - existingCount);
  const contentsToLink = pendingContents.slice(0, remainingSlots);

  if (contentsToLink.length === 0) {
    return result;
  }

  // 6. 执行关联
  await prisma.$transaction(async (tx) => {
    // 获取当前最大排序号
    const maxSortOrder = await tx.weekly_content_items.aggregate({
      where: { weekly_issue_id: issue!.id },
      _max: { sort_order: true },
    });

    const startSortOrder = (maxSortOrder._max.sort_order || 0) + 1;

    // 创建关联记录
    await tx.weekly_content_items.createMany({
      data: contentsToLink.map((content, index) => ({
        weekly_issue_id: issue!.id,
        content_id: content.id,
        sort_order: startSortOrder + index,
      })),
    });

    // 更新周刊统计
    const allLinkedIds = [
      ...(
        await tx.weekly_content_items.findMany({
          where: { weekly_issue_id: issue!.id },
          select: { content_id: true },
        })
      ).map((i) => i.content_id),
    ];

    const stats = await tx.contents.aggregate({
      where: { id: { in: allLinkedIds } },
      _sum: { word_count: true, reading_time: true },
      _count: true,
    });

    await tx.weekly_issues.update({
      where: { id: issue!.id },
      data: {
        total_items: stats._count,
        total_word_count: stats._sum.word_count || 0,
        reading_time: stats._sum.reading_time || 0,
      },
    });
  });

  result.linkedCount = contentsToLink.length;
  result.linkedContents = contentsToLink.map((c) => ({
    id: Number(c.id),
    title: c.title,
  }));

  // 记录超出限制的内容
  if (pendingContents.length > remainingSlots) {
    const skippedDueToLimit = pendingContents.slice(remainingSlots);
    result.skippedCount += skippedDueToLimit.length;
    result.skippedContents.push(
      ...skippedDueToLimit.map((c) => ({
        id: Number(c.id),
        title: c.title,
        reason: '超出每期最大数量限制',
      }))
    );
  }

  return result;
}

// ============================================================================
// Content Weekly Link Service
// ============================================================================

/**
 * 获取内容的周刊关联信息
 */
export async function getContentWeeklyInfo(contentId: number | bigint) {
  const content = await prisma.contents.findUnique({
    where: { id: BigInt(contentId) },
    select: {
      id: true,
      created_at: true,
      weekly_content_items: {
        include: {
          weekly_issue: {
            select: {
              id: true,
              issue_number: true,
              title: true,
              status: true,
              start_date: true,
              end_date: true,
            },
          },
        },
      },
    },
  });

  if (!content) {
    return null;
  }

  // 已关联的周刊
  const linkedIssue = content.weekly_content_items[0]?.weekly_issue || null;

  // 推荐的周刊（根据内容创建时间）
  let recommendedIssue = null;
  if (content.created_at) {
    const weekRange = getWeekRange(content.created_at);
    const matchingIssue = await prisma.weekly_issues.findFirst({
      where: {
        start_date: weekRange.startDate,
        end_date: weekRange.endDate,
      },
      select: {
        id: true,
        issue_number: true,
        title: true,
        status: true,
      },
    });

    if (matchingIssue) {
      recommendedIssue = {
        ...matchingIssue,
        reason: '内容创建时间在该周刊时间范围内',
      };
    }
  }

  return {
    linkedIssue: linkedIssue
      ? {
          id: linkedIssue.id,
          issue_number: linkedIssue.issue_number,
          title: linkedIssue.title,
          status: linkedIssue.status,
        }
      : null,
    recommendedIssue,
  };
}

/**
 * 关联内容到周刊
 */
export async function linkContentToWeekly(
  contentId: number | bigint,
  weeklyIssueId: number
) {
  const content = await prisma.contents.findUnique({
    where: { id: BigInt(contentId) },
    select: { id: true, title: true },
  });

  if (!content) {
    throw new Error('内容不存在');
  }

  const issue = await prisma.weekly_issues.findUnique({
    where: { id: weeklyIssueId },
    select: { id: true, issue_number: true, title: true },
  });

  if (!issue) {
    throw new Error('周刊不存在');
  }

  // 检查是否已关联
  const existing = await prisma.weekly_content_items.findFirst({
    where: {
      content_id: BigInt(contentId),
    },
  });

  if (existing) {
    // 如果已关联到同一周刊，直接返回
    if (existing.weekly_issue_id === weeklyIssueId) {
      return { action: 'already_linked', issue };
    }
    // 如果关联到其他周刊，先删除旧关联
    await prisma.weekly_content_items.delete({
      where: { id: existing.id },
    });
  }

  // 获取最大排序号
  const maxSortOrder = await prisma.weekly_content_items.aggregate({
    where: { weekly_issue_id: weeklyIssueId },
    _max: { sort_order: true },
  });

  // 创建新关联
  await prisma.weekly_content_items.create({
    data: {
      weekly_issue_id: weeklyIssueId,
      content_id: BigInt(contentId),
      sort_order: (maxSortOrder._max.sort_order || 0) + 1,
    },
  });

  // 更新周刊统计
  await updateWeeklyStats(weeklyIssueId);

  return { action: 'linked', issue };
}

/**
 * 取消内容与周刊的关联
 */
export async function unlinkContentFromWeekly(contentId: number | bigint) {
  const existing = await prisma.weekly_content_items.findFirst({
    where: { content_id: BigInt(contentId) },
    include: {
      weekly_issue: {
        select: { id: true, issue_number: true, title: true },
      },
    },
  });

  if (!existing) {
    return { action: 'not_linked', issue: null };
  }

  const issueId = existing.weekly_issue_id;

  await prisma.weekly_content_items.delete({
    where: { id: existing.id },
  });

  // 更新周刊统计
  await updateWeeklyStats(issueId);

  return { action: 'unlinked', issue: existing.weekly_issue };
}

/**
 * 获取周刊的待关联内容
 */
export async function getPendingContentsForWeekly(weeklyIssueId: number) {
  const issue = await prisma.weekly_issues.findUnique({
    where: { id: weeklyIssueId },
    select: { start_date: true, end_date: true },
  });

  if (!issue) {
    throw new Error('周刊不存在');
  }

  const pendingContents = await prisma.contents.findMany({
    where: {
      content_type_id: 3,
      status: { in: ['ready', 'published'] },
      created_at: {
        gte: issue.start_date,
        lte: issue.end_date,
      },
      weekly_content_items: { none: {} },
    },
    select: {
      id: true,
      title: true,
      status: true,
      created_at: true,
    },
    orderBy: { created_at: 'asc' },
  });

  return {
    pendingCount: pendingContents.length,
    contents: pendingContents.map((c) => ({
      id: Number(c.id),
      title: c.title,
      status: c.status,
      created_at: c.created_at?.toISOString(),
    })),
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 更新周刊统计信息
 */
async function updateWeeklyStats(weeklyIssueId: number) {
  const linkedContents = await prisma.weekly_content_items.findMany({
    where: { weekly_issue_id: weeklyIssueId },
    select: { content_id: true },
  });

  if (linkedContents.length === 0) {
    await prisma.weekly_issues.update({
      where: { id: weeklyIssueId },
      data: {
        total_items: 0,
        total_word_count: 0,
        reading_time: 0,
      },
    });
    return;
  }

  const stats = await prisma.contents.aggregate({
    where: { id: { in: linkedContents.map((c) => c.content_id) } },
    _sum: { word_count: true, reading_time: true },
  });

  await prisma.weekly_issues.update({
    where: { id: weeklyIssueId },
    data: {
      total_items: linkedContents.length,
      total_word_count: stats._sum.word_count || 0,
      reading_time: stats._sum.reading_time || 0,
    },
  });
}

// ============================================================================
// Batch Link Service
// ============================================================================

export interface BatchLinkResult {
  linkedCount: number;
  skippedCount: number;
  linkedContents: Array<{ id: number; title: string }>;
  skippedContents: Array<{ id: number; title: string; reason: string }>;
}

/**
 * 批量关联内容到周刊
 */
export async function batchLinkContentsToWeekly(
  weeklyIssueId: number,
  contentIds: number[]
): Promise<BatchLinkResult> {
  const issue = await prisma.weekly_issues.findUnique({
    where: { id: weeklyIssueId },
    select: { id: true, issue_number: true, title: true },
  });

  if (!issue) {
    throw new Error('周刊不存在');
  }

  const result: BatchLinkResult = {
    linkedCount: 0,
    skippedCount: 0,
    linkedContents: [],
    skippedContents: [],
  };

  // 获取所有内容
  const contents = await prisma.contents.findMany({
    where: { id: { in: contentIds.map((id) => BigInt(id)) } },
    select: {
      id: true,
      title: true,
      weekly_content_items: {
        select: { weekly_issue_id: true },
      },
    },
  });

  const contentsToLink: Array<{ id: bigint; title: string }> = [];

  for (const content of contents) {
    const existingLink = content.weekly_content_items[0];

    if (existingLink) {
      if (existingLink.weekly_issue_id === weeklyIssueId) {
        result.skippedCount++;
        result.skippedContents.push({
          id: Number(content.id),
          title: content.title,
          reason: '已关联到该周刊',
        });
      } else {
        result.skippedCount++;
        result.skippedContents.push({
          id: Number(content.id),
          title: content.title,
          reason: '已关联到其他周刊',
        });
      }
    } else {
      contentsToLink.push({ id: content.id, title: content.title });
    }
  }

  // 检查不存在的内容
  const foundIds = new Set(contents.map((c) => Number(c.id)));
  for (const id of contentIds) {
    if (!foundIds.has(id)) {
      result.skippedCount++;
      result.skippedContents.push({
        id,
        title: `内容 #${id}`,
        reason: '内容不存在',
      });
    }
  }

  if (contentsToLink.length === 0) {
    return result;
  }

  // 执行批量关联
  await prisma.$transaction(async (tx) => {
    // 获取当前最大排序号
    const maxSortOrder = await tx.weekly_content_items.aggregate({
      where: { weekly_issue_id: weeklyIssueId },
      _max: { sort_order: true },
    });

    const startSortOrder = (maxSortOrder._max.sort_order || 0) + 1;

    // 创建关联记录
    await tx.weekly_content_items.createMany({
      data: contentsToLink.map((content, index) => ({
        weekly_issue_id: weeklyIssueId,
        content_id: content.id,
        sort_order: startSortOrder + index,
      })),
    });
  });

  // 更新周刊统计
  await updateWeeklyStats(weeklyIssueId);

  result.linkedCount = contentsToLink.length;
  result.linkedContents = contentsToLink.map((c) => ({
    id: Number(c.id),
    title: c.title,
  }));

  return result;
}
