CREATE TABLE `sample_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`scenario_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`requester_id` text NOT NULL,
	`complete` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sample_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`position` integer NOT NULL,
	`label` text NOT NULL,
	`envelope` text NOT NULL,
	`result` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `sample_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sample_steps_position_idx` ON `sample_steps` (`run_id`,`position`);