# Marvin MCP Caching Research and Implementation Plan

## Executive Summary

This document outlines a comprehensive caching strategy to significantly improve the performance of the Marvin MCP server. Based on analysis of the Marvin API documentation and current implementation, we've identified multiple high-impact caching opportunities that can reduce API calls by 60-80% in typical usage scenarios.

## Current State Analysis

### No Caching Implementation
The current implementation has **zero caching**, meaning every MCP tool call results in fresh API requests to the Marvin server. This creates unnecessary latency and API load, especially for data that rarely changes.

### High-Frequency Operations
The following operations are called frequently but fetch relatively static data:
- `getCategories()` - Called during hierarchy fetches, searches, and task aggregations
- `getLabels()` - Called when displaying task information
- `getTodayTasks()` - Called multiple times per session
- `getAllTasks()` - Extremely expensive operation that recursively fetches from all categories

### Expensive Recursive Operations
The `getAllTasks()` method is particularly problematic:
```typescript
// Current implementation makes N+1 API calls:
// 1. Fetch all categories (1 call)
// 2. Recursively fetch children for each category (N calls)
// 3. Fetch today's tasks (1 call)
// 4. Fetch due tasks (1 call)
// 5. Fetch inbox tasks (1 call)
```

---

## Caching Opportunities Identified

### 1. Static Data (High Priority)

#### Categories (`/api/categories`)
**Characteristics:**
- Changes infrequently (only when users restructure their workspace)
- Required for hierarchy display, task organization, and recursive operations
- Currently fetched multiple times per session

**Recommended Strategy:**
- **TTL:** 5 minutes (300 seconds)
- **Invalidation:** Clear on create/update/delete category operations
- **Impact:** High - Used in nearly every operation involving task organization

#### Labels (`/api/labels`)
**Characteristics:**
- Rarely modified after initial setup
- Small dataset (typically < 100 labels)
- Required for task display and filtering

**Recommended Strategy:**
- **TTL:** 10 minutes (600 seconds)
- **Invalidation:** Clear if label creation API is added in future
- **Impact:** Medium-High - Reduces overhead in task detail displays

### 2. Date-Scoped Data (High Priority)

#### Today's Tasks (`/api/todayItems`)
**Characteristics:**
- Date-specific data that remains valid until midnight
- Frequently accessed throughout the day
- Changes only when tasks are added/removed/completed

**Recommended Strategy:**
- **TTL:** Until midnight of current day (dynamic calculation)
- **Invalidation:**
  - Clear on task create/update/delete/complete
  - Auto-invalidate at midnight (date change)
- **Impact:** High - One of the most frequently called endpoints

#### Due Tasks (`/api/dueItems`)
**Characteristics:**
- Similar to today's tasks but broader scope
- Changes less frequently than today's tasks

**Recommended Strategy:**
- **TTL:** 2 minutes (120 seconds)
- **Invalidation:** Clear on task create/update/delete/complete
- **Impact:** Medium - Used for overdue task tracking

#### Tasks by Date (`/api/todayItems?date=YYYY-MM-DD`)
**Characteristics:**
- Historical date queries are immutable
- Future date queries can change

**Recommended Strategy:**
- **TTL:** Permanent for past dates, until date for future dates
- **Invalidation:** Only clear future dates on task modifications
- **Impact:** Medium - Improves performance for date-based queries

### 3. Document Cache (Medium Priority)

#### Document Reads (`/api/doc?id=...`)
**Characteristics:**
- Marvin uses CouchDB which provides `_rev` (revision) fields
- Perfect for ETag-style caching with revision validation

**Recommended Strategy:**
- **TTL:** 1 minute (60 seconds)
- **Validation:** Compare `_rev` field on cache hit
- **Invalidation:** Clear specific doc on update/delete
- **Impact:** Low-Medium - Used less frequently but good for individual task/project lookups

### 4. Aggregate Operations (High Priority)

#### All Tasks (`getAllTasks()`)
**Characteristics:**
- Most expensive operation in the codebase
- Makes 10-50+ API calls depending on workspace structure
- Used by search functionality

**Recommended Strategy:**
- **TTL:** 1 minute (60 seconds)
- **Invalidation:** Clear on any task/category modification
- **Impact:** VERY HIGH - Can reduce search operation from 30+ API calls to 1 cache hit

#### Children (`/api/children?parentId=...`)
**Characteristics:**
- Used in recursive hierarchy traversal
- Same children fetched multiple times in recursive operations

**Recommended Strategy:**
- **TTL:** 2 minutes (120 seconds)
- **Key:** Parent ID specific
- **Invalidation:** Clear specific parent on task/project create/delete in that parent
- **Impact:** High - Significantly speeds up hierarchy operations

---

## Cache Architecture Design

### Recommended Implementation: In-Memory LRU Cache

**Rationale:**
- Simple to implement and maintain
- No external dependencies
- Sufficient for MCP server use case (single-user, session-based)
- Fast access times (< 1ms)

### Cache Structure

```typescript
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
  metadata?: {
    date?: string;      // For date-scoped entries
    revision?: string;  // For CouchDB revision tracking
  };
}

interface CacheConfig {
  ttl: number;           // Time to live in milliseconds
  maxSize?: number;      // Max entries (for LRU eviction)
  computeExpiry?: (data: any) => number; // Custom expiry logic
}
```

### Cache Keys Strategy

**Key Format:** `<entity>:<identifier>:<params>`

Examples:
- `categories:all` - All categories
- `labels:all` - All labels
- `todayTasks:2025-12-23` - Today's tasks for specific date
- `dueTasks:2025-12-23` - Due tasks by specific date
- `children:parent123` - Children of specific parent
- `task:task123` - Specific task document
- `allTasks:aggregate` - All tasks aggregate

### Cache Manager Class

```typescript
class CacheManager {
  private cache: Map<string, CacheEntry<any>>;
  private config: Map<string, CacheConfig>;

  // Core operations
  get<T>(key: string): T | null;
  set<T>(key: string, data: T, configKey: string): void;
  invalidate(key: string): void;
  invalidatePattern(pattern: string): void;
  clear(): void;

  // Helper methods
  isExpired(entry: CacheEntry<any>): boolean;
  getStats(): CacheStats;
}
```

---

## Invalidation Strategies

### Write-Through Invalidation

**Principle:** Any write operation invalidates related cached data

| Write Operation | Invalidate |
|----------------|------------|
| `createTask()` | `todayTasks:*`, `dueTasks:*`, `allTasks:*`, `children:<parentId>` |
| `updateTask()` | `task:<id>`, `todayTasks:*`, `dueTasks:*`, `allTasks:*` |
| `deleteTask()` | `task:<id>`, `todayTasks:*`, `dueTasks:*`, `allTasks:*`, `children:<parentId>` |
| `completeTask()` | `task:<id>`, `todayTasks:*`, `dueTasks:*`, `allTasks:*` |
| `createProject()` | `children:<parentId>`, `categories:all` |
| `createCategory()` | `categories:all` |

### Date-Aware Invalidation

**Today's Tasks Special Logic:**
```typescript
// Calculate expiry at midnight local time
function computeTodayTasksExpiry(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime();
}
```

### Pattern-Based Invalidation

**Use Cases:**
- Invalidate all date-scoped caches: `todayTasks:*`
- Invalidate all children caches: `children:*`
- Invalidate all task caches: `task:*`

**Implementation:**
```typescript
invalidatePattern(pattern: string): void {
  const regex = new RegExp('^' + pattern.replace('*', '.*') + '$');
  for (const key of this.cache.keys()) {
    if (regex.test(key)) {
      this.cache.delete(key);
    }
  }
}
```

---

## Implementation Plan

### Phase 1: Core Cache Infrastructure (Foundation)

**Scope:**
1. Create `src/cache/cache-manager.ts`
2. Implement `CacheManager` class with LRU eviction
3. Define cache configurations for each entity type
4. Add cache statistics/monitoring
5. Write unit tests for cache behavior

**Estimated Complexity:** Medium
**Files to Create:**
- `src/cache/cache-manager.ts`
- `src/cache/cache-config.ts`
- `src/cache/types.ts`

### Phase 2: Static Data Caching (Quick Wins)

**Scope:**
1. Integrate cache into `MarvinAPI` class
2. Add caching to `getCategories()`
3. Add caching to `getLabels()`
4. Implement invalidation in category creation

**Estimated Complexity:** Low
**Files to Modify:**
- `src/marvin-api.ts` - Add cache integration
- Constructor to initialize cache
- Wrap read operations with cache checks

### Phase 3: Date-Scoped Caching (High Impact)

**Scope:**
1. Add caching to `getTodayTasks()`
2. Add caching to `getDueTasks()`
3. Add caching to `getTasksByDate()`
4. Implement date-aware expiry logic
5. Add midnight invalidation mechanism

**Estimated Complexity:** Medium
**Files to Modify:**
- `src/marvin-api.ts` - Add date-based caching logic
- `src/cache/cache-manager.ts` - Add date expiry computation

### Phase 4: Write Operation Invalidation (Critical)

**Scope:**
1. Add cache invalidation to `createTask()`
2. Add cache invalidation to `updateTask()`
3. Add cache invalidation to `deleteTask()`
4. Add cache invalidation to `completeTask()`
5. Add cache invalidation to project/category operations

**Estimated Complexity:** Medium
**Files to Modify:**
- `src/marvin-api.ts` - Add invalidation calls after write operations

### Phase 5: Aggregate Caching (Performance Multiplier)

**Scope:**
1. Add caching to `getAllTasks()`
2. Add caching to `getChildren()`
3. Optimize recursive operations to use cached children
4. Add smart invalidation for parent-child relationships

**Estimated Complexity:** High
**Files to Modify:**
- `src/marvin-api.ts` - Complex invalidation logic

### Phase 6: Advanced Features (Polish)

**Scope:**
1. Add cache warming on server startup
2. Implement cache preloading strategies
3. Add cache metrics endpoint
4. Add cache debugging tools
5. Add configurable cache TTLs via environment variables

**Estimated Complexity:** Medium
**Files to Modify:**
- `src/index.ts` - Add startup cache warming
- `src/cache/cache-manager.ts` - Add metrics/debugging

---

## Performance Impact Estimates

### Before Caching (Current State)

**Typical Session (10 interactions):**
- Get today's tasks: 10 API calls
- Search tasks: 5 searches × 30 API calls = 150 API calls
- Get labels: 10 API calls
- Get categories: 10 API calls
- Create/update tasks: 5 API calls
- **Total: ~185 API calls**

### After Caching (Projected)

**Same Session:**
- Get today's tasks: 1 API call (+ 9 cache hits)
- Search tasks: 1 API call for getAllTasks() (+ 4 cache hits)
- Get labels: 1 API call (+ 9 cache hits)
- Get categories: 1 API call (+ 9 cache hits)
- Create/update tasks: 5 API calls + 5 cache invalidations
- **Total: ~9 API calls + ~31 cache hits**

**Improvement: 95% reduction in API calls**

### Response Time Improvements

| Operation | Current | With Cache | Improvement |
|-----------|---------|------------|-------------|
| Get Labels | ~150ms | ~1ms | 150x faster |
| Get Categories | ~180ms | ~1ms | 180x faster |
| Get Today's Tasks | ~200ms | ~1ms | 200x faster |
| Search Tasks | ~5-10s | ~50-100ms | 50-100x faster |
| Get All Tasks | ~8-15s | ~100ms | 80-150x faster |

---

## Trade-offs and Considerations

### Memory Usage

**Estimated Memory per Entity:**
- Categories: ~5-10 KB (typical: 20-50 categories)
- Labels: ~2-5 KB (typical: 10-30 labels)
- Today's tasks: ~10-50 KB (typical: 10-30 tasks)
- All tasks cache: ~100-500 KB (typical: 200-1000 tasks)

**Total Estimated Memory:** 150-600 KB for typical workspace

**Verdict:** Negligible memory footprint, well within acceptable limits

### Cache Coherence

**Risk:** Cache becomes stale if user modifies data outside MCP
**Mitigation:**
- Keep TTLs reasonably short (1-5 minutes for most data)
- Provide manual cache clear operation
- Consider adding cache validation using `_rev` fields

### Complexity

**Added Complexity:**
- ~300-500 lines of cache infrastructure code
- Invalidation logic in write operations
- Testing and maintenance overhead

**Verdict:** Complexity is justified by significant performance gains

### Alternative Approaches Considered

#### 1. Redis/External Cache
**Pros:** Shared cache across processes, persistence
**Cons:** Added dependency, complexity, overkill for single-user MCP
**Decision:** Not needed for current use case

#### 2. HTTP Cache Headers
**Pros:** Browser-standard caching
**Cons:** Marvin API doesn't provide cache headers, can't control invalidation
**Decision:** Not feasible with current API

#### 3. Persistent Cache (Disk)
**Pros:** Survives restarts
**Cons:** Added I/O overhead, stale data risk, complexity
**Decision:** Not worth it for session-based MCP usage

---

## Configuration Strategy

### Environment Variables

```bash
# Enable/disable caching
MARVIN_CACHE_ENABLED=true

# Cache TTLs (in seconds)
MARVIN_CACHE_TTL_CATEGORIES=300      # 5 minutes
MARVIN_CACHE_TTL_LABELS=600          # 10 minutes
MARVIN_CACHE_TTL_TODAY_TASKS=0       # Until midnight
MARVIN_CACHE_TTL_DUE_TASKS=120       # 2 minutes
MARVIN_CACHE_TTL_ALL_TASKS=60        # 1 minute
MARVIN_CACHE_TTL_CHILDREN=120        # 2 minutes

# Cache size limits
MARVIN_CACHE_MAX_SIZE=1000           # Max entries before LRU eviction

# Debug
MARVIN_CACHE_DEBUG=false             # Log cache hits/misses
```

### Runtime Configuration

```typescript
// Allow cache clearing via tool call
{
  name: "marvin_clear_cache",
  description: "Clear all cached data and force fresh API calls",
  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Optional pattern to clear specific caches (e.g., 'todayTasks:*')"
      }
    }
  }
}
```

---

## Testing Strategy

### Unit Tests
- Cache hit/miss logic
- TTL expiration
- LRU eviction
- Pattern-based invalidation
- Date-aware expiry calculation

### Integration Tests
- End-to-end operations with cache
- Invalidation on write operations
- Multi-operation cache consistency

### Performance Tests
- Measure cache hit rates
- Compare response times before/after
- Memory usage monitoring
- Cache eviction behavior under load

---

## Success Metrics

### Key Performance Indicators (KPIs)

1. **Cache Hit Rate:** Target > 70% after warm-up
2. **API Call Reduction:** Target > 60% reduction
3. **Response Time Improvement:** Target > 10x faster for cached operations
4. **Memory Usage:** Target < 1 MB total cache size
5. **Cache Invalidation Accuracy:** Zero stale data incidents

### Monitoring

```typescript
interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
  memoryUsage: number;
  evictions: number;
  invalidations: number;
}
```

---

## Future Enhancements

### Short Term
1. Add cache warming on server start
2. Implement smart prefetching
3. Add cache compression for large datasets

### Long Term
1. Implement distributed cache for multi-instance deployments
2. Add cache analytics dashboard
3. Machine learning-based cache preloading
4. Adaptive TTL based on data change patterns

---

## Conclusion

Implementing caching in the Marvin MCP server will provide **immediate and substantial performance improvements** with minimal complexity overhead. The proposed architecture is:

✅ **Simple:** In-memory LRU cache, no external dependencies
✅ **Effective:** 60-95% reduction in API calls
✅ **Maintainable:** Clear invalidation rules and configuration
✅ **Scalable:** Handles typical workspace sizes with ease
✅ **Safe:** Conservative TTLs and smart invalidation prevent stale data

**Recommended Next Steps:**
1. Review and approve this plan
2. Begin Phase 1 implementation (Core Cache Infrastructure)
3. Iteratively implement phases 2-4 for immediate impact
4. Monitor cache performance and adjust TTLs as needed
5. Implement phases 5-6 for advanced optimization

---

## Appendix: Code Examples

### Example: Cached getCategories()

```typescript
async getCategories(): Promise<MarvinCategory[]> {
  const cacheKey = 'categories:all';

  // Try cache first
  const cached = this.cacheManager.get<MarvinCategory[]>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  // Cache miss - fetch from API
  const categories = await this.request<MarvinCategory[]>("/categories");

  // Store in cache
  this.cacheManager.set(cacheKey, categories, 'categories');

  return categories;
}
```

### Example: Cache Invalidation on Task Creation

```typescript
async createTask(options: CreateTaskOptions): Promise<MarvinTask> {
  const task = await this.request<MarvinTask>("/addTask", {
    method: "POST",
    body: payload,
  });

  // Invalidate related caches
  this.cacheManager.invalidatePattern('todayTasks:*');
  this.cacheManager.invalidatePattern('dueTasks:*');
  this.cacheManager.invalidatePattern('allTasks:*');

  if (options.parentId) {
    this.cacheManager.invalidate(`children:${options.parentId}`);
  }

  return task;
}
```

### Example: Date-Aware Today's Tasks Cache

```typescript
async getTodayTasks(): Promise<MarvinTask[]> {
  const today = new Date().toISOString().split('T')[0];
  const cacheKey = `todayTasks:${today}`;

  const cached = this.cacheManager.get<MarvinTask[]>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const tasks = await this.request<MarvinTask[]>("/todayItems");

  // Cache until midnight
  this.cacheManager.set(cacheKey, tasks, 'todayTasks');

  return tasks;
}
```

---

**Document Version:** 1.0
**Last Updated:** 2025-12-23
**Author:** Research & Analysis
**Status:** Ready for Review
