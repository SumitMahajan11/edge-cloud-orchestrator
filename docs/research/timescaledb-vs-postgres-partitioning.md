# TimescaleDB versus native PostgreSQL partitioning for `NodeMetric`

**Issue:** #35 / #20  
**Status:** Recommendation  
**Author:** Manus AI  
**Date:** 2026-09-20

## Conclusion

The project should keep **native PostgreSQL range partitioning as the default for `NodeMetric`**. TimescaleDB is not justified by node count alone. It becomes worth evaluating when the platform needs time-series capabilities that native partitioning does not provide economically, such as automated chunk management across multiple dimensions, continuous aggregates, columnar compression, or a much larger retention and analytics workload.

For the current workload, native PostgreSQL has three advantages. It does not add an extension lifecycle to the deployment. It remains close to the existing Prisma and migration model. It also addresses the immediate operational requirement—bounded retention and time-range pruning—without changing the application query interface. TimescaleDB should remain a documented migration option, not a production dependency, until a benchmark demonstrates a material improvement in the project’s real queries.

## Workload assumptions

The issue estimates 100 nodes sending a heartbeat every five seconds, which produces approximately 1.7 million metric rows per day. At that rate, a 30-day raw retention window contains approximately 52 million rows. The write pattern is append-heavy, and the dominant access patterns are expected to filter by tenant, node, and time range. Historical dashboards may also aggregate metrics by hour or day.

The current schema has both `timestamp` and `createdAt`, a composite primary key containing `timestamp`, and an index on `(tenantId, createdAt)`. The migration history already contains an experimental `pg_partman` migration that partitions by `timestamp` with daily intervals and a seven-day retention setting. That history does not match the current issue proposal, which calls for weekly partitions, a 30-day default, and `createdAt`. This inconsistency must be resolved before any production migration is attempted.

## Comparison

| Concern                  | Native PostgreSQL range partitioning                                    | TimescaleDB hypertable                                                                                |
| ------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Core mechanism           | Declarative partitions with explicit bounds                             | PostgreSQL table with automated time-based chunks                                                     |
| Operational dependency   | PostgreSQL only; partition creation and retention are project-managed   | PostgreSQL plus TimescaleDB extension and its version-compatible deployment path                      |
| Query compatibility      | Existing SQL and Prisma queries can continue to target the parent table | Existing SQL clients can generally query the hypertable as a regular table                            |
| Retention                | Scheduled detach/drop or a maintained cleanup job                       | Built-in scheduled retention policies can drop old chunks                                             |
| Aggregation              | Requires application queries or materialized views                      | Adds continuous aggregates and time-series-oriented functions                                         |
| Multi-dimensional layout | Can be implemented with subpartitioning, but maintenance is manual      | Supports time plus an optional space dimension through hypertable configuration                       |
| Primary-key constraints  | A partition key must be included in a unique or primary-key constraint  | The same PostgreSQL constraint limitation applies to the underlying partitioned design                |
| Migration cost           | Correct the existing migration and maintain a partition-management job  | Install and operate the extension, then migrate the table to a hypertable with extension-specific DDL |

PostgreSQL treats a partitioned table as a virtual parent whose rows live in child partitions. Queries can prune partitions when the predicate includes the partition key, and dropping or detaching an old partition can remove large volumes of data without row-by-row deletion [1]. The tradeoff is that new partitions must be created and maintained by project-owned automation; inserts that do not match a partition fail unless a suitable partition or default partition exists [1].

TimescaleDB hypertables automate the time-based chunk layout. The database routes rows to time chunks and can optionally partition by another dimension. Queries continue to use the hypertable as a normal PostgreSQL table, while the extension manages chunk metadata and indexes [2]. TimescaleDB also provides scheduled retention policies that drop complete chunks instead of deleting individual rows [3]. It remains a PostgreSQL extension rather than a separate database, but it adds an extension version and operational compatibility requirement to every deployment [4].

## Node-count threshold

There is no defensible universal threshold such as “TimescaleDB starts at 1,000 nodes.” The relevant threshold is the combination of ingest rate, retention period, query concurrency, aggregation complexity, and operator capacity.

For this repository, the first decision point should be based on measured workload rather than node count:

- **Up to approximately 100 nodes and 30 days of raw retention:** native weekly partitions are the lower-risk choice. At the issue’s estimate of 1.7 million rows per day, the table is large enough to require partitioning but not automatically large enough to require an extension.
- **Approximately 100–500 nodes:** continue with native partitions if the primary workload is recent tenant and node range queries. Add pre-aggregated hourly data if dashboards repeatedly scan the same history.
- **Above approximately 500 nodes, or when sustained ingest exceeds roughly 10 million rows per day:** run a TimescaleDB benchmark. At this point, automated chunk management, compression or columnstore, and continuous aggregates may outweigh extension operations.
- **At any node count:** choose TimescaleDB earlier if product requirements include continuous aggregates, long retention with compressed history, or space-partitioned access patterns that native partition management would make difficult.

These ranges are planning triggers, not capacity guarantees. They must be replaced by benchmark results using production-shaped rows, indexes, tenant cardinality, and query concurrency.

## Recommended migration path

The immediate migration should remain within native PostgreSQL. First, select one canonical partition key. The issue proposal names `createdAt`, so the schema and all write paths should use `createdAt` consistently; if `timestamp` is the intended metric event time, the issue should be amended before implementation. Next, create a compatibility migration that preserves the full current column set, including `tenantId`, the foreign keys, and the composite primary-key requirement. Create weekly partitions with a default partition during rollout, then add a scheduled job that creates future partitions and detaches or drops partitions older than the configured retention period.

The cleanup job should use a configurable retention setting with a default of 30 days. Partition deletion is preferable to row-by-row deletion because PostgreSQL documents partition detach and drop as the efficient maintenance path for old data [1]. The job must record its actions, tolerate a missing partition, and avoid deleting data newer than the retention boundary. The migration should also retain the `(tenantId, createdAt)` index required by the issue.

A later TimescaleDB migration should be treated as a separate, benchmark-gated project. The safe sequence is to provision a PostgreSQL environment with the same TimescaleDB major-version compatibility as production, copy a representative slice of `NodeMetric`, create a hypertable using the canonical time column, recreate indexes and constraints, and compare write latency, recent range queries, historical aggregations, retention cost, and operational recovery. Production migration should use a dual-write or controlled maintenance-window plan rather than changing the table type in place without a rollback path.

## Benchmark acceptance criteria

The benchmark should generate at least 30 days of production-shaped data with the expected tenant and node distribution. It should compare native weekly partitions against a TimescaleDB hypertable under the same hardware and PostgreSQL settings. The test suite should include recent per-node queries, tenant-wide range queries, hourly rollups, concurrent dashboard reads during heartbeat ingestion, retention cleanup, and restart or failover recovery.

TimescaleDB should be adopted only if it provides a material improvement that justifies the new operational dependency. A reasonable initial gate is a 2x improvement in the 95th-percentile latency of the dominant historical query or a materially lower storage and cleanup cost at the target retention window, with no unacceptable increase in write latency or recovery complexity. If neither condition is met, native PostgreSQL partitioning remains the recommended design.

## Decision

Implement the native PostgreSQL path first, correct the existing migration history mismatch, and measure the resulting workload. Revisit TimescaleDB when measured ingest, retention, or aggregation requirements cross the benchmark triggers above. Do not introduce TimescaleDB solely because the table is time-series data.

## References

[1]: https://www.postgresql.org/docs/current/ddl-partitioning.html "PostgreSQL 18 Documentation: Table Partitioning"
[2]: https://www.tigerdata.com/docs/learn/hypertables/understand-hypertables "Tiger Data Documentation: Understand hypertables"
[3]: https://www.tigerdata.com/docs/build/data-management/data-retention/create-a-retention-policy "Tiger Data Documentation: Add a data retention policy"
[4]: https://www.tigerdata.com/docs "Tiger Data Documentation: TimescaleDB overview"
