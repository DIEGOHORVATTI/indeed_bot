CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text NOT NULL,
	`source` text,
	`title` text,
	`company` text,
	`location` text,
	`salary` text,
	`date_posted` text,
	`search_query` text,
	`description` text,
	`score` integer,
	`score_reason` text,
	`tailored_cv` text,
	`cv_pdf_path` text,
	`cover_pdf_path` text,
	`status` text DEFAULT 'discovered' NOT NULL,
	`fail_reason` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_url_unique` ON `jobs` (`url`);--> statement-breakpoint
CREATE INDEX `idx_jobs_status` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_jobs_score` ON `jobs` (`score`);--> statement-breakpoint
CREATE INDEX `idx_jobs_url` ON `jobs` (`url`);--> statement-breakpoint
CREATE TABLE `logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer,
	`stage` text NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`message` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_logs_job` ON `logs` (`job_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
