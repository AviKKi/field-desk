PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_credit_refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`credit_note_id` text NOT NULL,
	`receipt_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`reversal_of_id` text,
	`reason` text DEFAULT '' NOT NULL,
	`reference` text NOT NULL,
	`action_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credit_note_id`) REFERENCES `credit_notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`receipt_id`) REFERENCES `payment_receipts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reversal_of_id`) REFERENCES `credit_refunds`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "credit_refunds_amount_paise_check" CHECK(typeof("__new_credit_refunds"."amount_paise") = 'integer' and (("__new_credit_refunds"."amount_paise" > 0 and "__new_credit_refunds"."reversal_of_id" is null) or ("__new_credit_refunds"."amount_paise" < 0 and "__new_credit_refunds"."reversal_of_id" is not null)))
);
--> statement-breakpoint
INSERT INTO `__new_credit_refunds`("id", "customer_id", "credit_note_id", "receipt_id", "amount_paise", "reversal_of_id", "reason", "reference", "action_id", "created_at") SELECT "id", "customer_id", "credit_note_id", "receipt_id", "amount_paise", NULL, '', "reference", "action_id", "created_at" FROM `credit_refunds`;--> statement-breakpoint
DROP TABLE `credit_refunds`;--> statement-breakpoint
ALTER TABLE `__new_credit_refunds` RENAME TO `credit_refunds`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `credit_refunds_customer_id_idx` ON `credit_refunds` (`customer_id`);--> statement-breakpoint
CREATE INDEX `credit_refunds_credit_note_id_idx` ON `credit_refunds` (`credit_note_id`);--> statement-breakpoint
CREATE INDEX `credit_refunds_receipt_id_idx` ON `credit_refunds` (`receipt_id`);--> statement-breakpoint
CREATE INDEX `credit_refunds_reversal_idx` ON `credit_refunds` (`reversal_of_id`);--> statement-breakpoint
ALTER TABLE `credit_applications` ADD `reversal_of_id` text REFERENCES credit_applications(id);--> statement-breakpoint
ALTER TABLE `credit_applications` ADD `reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `credit_applications_reversal_idx` ON `credit_applications` (`reversal_of_id`);