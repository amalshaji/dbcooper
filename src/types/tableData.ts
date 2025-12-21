export interface TableDataResponse {
  data: Record<string, unknown>[];
  total: number;
  page: number;
  limit: number;
}
