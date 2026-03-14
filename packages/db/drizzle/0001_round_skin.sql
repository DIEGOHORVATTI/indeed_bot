CREATE TABLE `cvs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`variant` text DEFAULT 'A' NOT NULL,
	`html_content` text NOT NULL,
	`prompt_used` text,
	`job_id` integer,
	`job_title` text,
	`job_company` text,
	`score` integer DEFAULT 0 NOT NULL,
	`template_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_cvs_job` ON `cvs` (`job_id`);--> statement-breakpoint
CREATE INDEX `idx_cvs_variant` ON `cvs` (`variant`);