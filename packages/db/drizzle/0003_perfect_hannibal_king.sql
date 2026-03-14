ALTER TABLE `jobs` ADD `apply_type` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `job_key` text;--> statement-breakpoint
CREATE INDEX `idx_jobs_source` ON `jobs` (`source`);--> statement-breakpoint
CREATE INDEX `idx_jobs_job_key` ON `jobs` (`job_key`);