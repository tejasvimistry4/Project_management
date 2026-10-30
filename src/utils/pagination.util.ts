export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface PaginationOffsetResult {
  page: number;
  limit: number;
  skip: number;
}

export function getPaginationOffset(
  page?: number,
  limit?: number,
  defaultLimit = 20,
  maxLimit = 100,
): PaginationOffsetResult {
  const safePage = Math.max(1, Number(page) || 1);
  const requestedLimit = Number(limit) || defaultLimit;
  const safeLimit = Math.min(Math.max(1, requestedLimit), maxLimit);
  const skip = (safePage - 1) * safeLimit;

  return {
    page: safePage,
    limit: safeLimit,
    skip,
  };
}

export function calculateTotalPages(total: number, limit: number): number {
  if (limit <= 0) return 1;
  return Math.ceil(total / limit) || 1;
}

export function createPaginationMeta(
  total: number,
  page: number,
  limit: number,
  includeNavigationFlags = true,
): PaginationMeta {
  const totalPages = Math.ceil(total / limit);
  const meta: PaginationMeta = {
    total,
    page,
    limit,
    totalPages,
  };

  if (includeNavigationFlags) {
    meta.hasNextPage = page < totalPages;
    meta.hasPreviousPage = page > 1;
  }

  return meta;
}
