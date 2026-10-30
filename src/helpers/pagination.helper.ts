import {
  createPaginationMeta,
  PaginatedResult,
} from '../utils/pagination.util';

export function buildPaginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
  includeNavigationFlags = true,
): PaginatedResult<T> {
  return {
    data,
    meta: createPaginationMeta(total, page, limit, includeNavigationFlags),
  };
}
