CREATE TABLE `action_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`requester_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`result` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `action_requests_key_idx` ON `action_requests` (`requester_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`revision` integer NOT NULL,
	`actor_id` text NOT NULL,
	`decision` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "approvals_revision_check" CHECK(typeof("approvals"."revision") = 'integer' and "approvals"."revision" > 0)
);
--> statement-breakpoint
CREATE INDEX `approvals_order_id_idx` ON `approvals` (`order_id`);--> statement-breakpoint
CREATE TABLE `business_events` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`order_id` text,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`requested_by` text NOT NULL,
	`action_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`occurred_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `business_events_customer_id_idx` ON `business_events` (`customer_id`);--> statement-breakpoint
CREATE TABLE `cancellations` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`line_key` text NOT NULL,
	`qty` integer NOT NULL,
	`reason` text NOT NULL,
	`action_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cancellations_qty_check" CHECK(typeof("cancellations"."qty") = 'integer' and "cancellations"."qty" > 0)
);
--> statement-breakpoint
CREATE INDEX `cancellations_order_id_idx` ON `cancellations` (`order_id`);--> statement-breakpoint
CREATE TABLE `corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`original_revision` integer NOT NULL,
	`new_revision` integer NOT NULL,
	`actor_id` text NOT NULL,
	`reason` text NOT NULL,
	`evidence` text NOT NULL,
	`authorization_reference` text NOT NULL,
	`location` text NOT NULL,
	`shipment_id` text,
	`action_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "corrections_original_revision_check" CHECK(typeof("corrections"."original_revision") = 'integer' and "corrections"."original_revision" > 0),
	CONSTRAINT "corrections_new_revision_check" CHECK(typeof("corrections"."new_revision") = 'integer' and "corrections"."new_revision" > 0)
);
--> statement-breakpoint
CREATE INDEX `corrections_order_id_idx` ON `corrections` (`order_id`);--> statement-breakpoint
CREATE TABLE `credit_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`credit_note_id` text NOT NULL,
	`charge_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`action_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credit_note_id`) REFERENCES `credit_notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`charge_id`) REFERENCES `receivable_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "credit_applications_amount_paise_check" CHECK(typeof("credit_applications"."amount_paise") = 'integer')
);
--> statement-breakpoint
CREATE INDEX `credit_applications_customer_id_idx` ON `credit_applications` (`customer_id`);--> statement-breakpoint
CREATE INDEX `credit_applications_credit_note_id_idx` ON `credit_applications` (`credit_note_id`);--> statement-breakpoint
CREATE INDEX `credit_applications_charge_id_idx` ON `credit_applications` (`charge_id`);--> statement-breakpoint
CREATE TABLE `credit_funds` (
	`id` text PRIMARY KEY NOT NULL,
	`credit_note_id` text NOT NULL,
	`receipt_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	FOREIGN KEY (`credit_note_id`) REFERENCES `credit_notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`receipt_id`) REFERENCES `payment_receipts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "credit_funds_amount_paise_check" CHECK(typeof("credit_funds"."amount_paise") = 'integer' and "credit_funds"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE INDEX `credit_funds_credit_note_id_idx` ON `credit_funds` (`credit_note_id`);--> statement-breakpoint
CREATE INDEX `credit_funds_receipt_id_idx` ON `credit_funds` (`receipt_id`);--> statement-breakpoint
CREATE TABLE `credit_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`return_id` text,
	`amount_paise` integer NOT NULL,
	`reason` text NOT NULL,
	`action_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "credit_notes_amount_paise_check" CHECK(typeof("credit_notes"."amount_paise") = 'integer' and "credit_notes"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE INDEX `credit_notes_customer_id_idx` ON `credit_notes` (`customer_id`);--> statement-breakpoint
CREATE TABLE `credit_refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`credit_note_id` text NOT NULL,
	`receipt_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`reference` text NOT NULL,
	`action_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credit_note_id`) REFERENCES `credit_notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`receipt_id`) REFERENCES `payment_receipts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "credit_refunds_amount_paise_check" CHECK(typeof("credit_refunds"."amount_paise") = 'integer' and "credit_refunds"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE INDEX `credit_refunds_customer_id_idx` ON `credit_refunds` (`customer_id`);--> statement-breakpoint
CREATE INDEX `credit_refunds_credit_note_id_idx` ON `credit_refunds` (`credit_note_id`);--> statement-breakpoint
CREATE INDEX `credit_refunds_receipt_id_idx` ON `credit_refunds` (`receipt_id`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`version` integer NOT NULL,
	CONSTRAINT "customers_version_check" CHECK(typeof("customers"."version") = 'integer' and "customers"."version" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_code_unique` ON `customers` (`code`);--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_line_id` text NOT NULL,
	`order_id` text NOT NULL,
	`qty` integer NOT NULL,
	`action_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`shipment_line_id`) REFERENCES `shipment_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "deliveries_qty_check" CHECK(typeof("deliveries"."qty") = 'integer' and "deliveries"."qty" > 0)
);
--> statement-breakpoint
CREATE INDEX `deliveries_shipment_line_id_idx` ON `deliveries` (`shipment_line_id`);--> statement-breakpoint
CREATE INDEX `deliveries_order_id_idx` ON `deliveries` (`order_id`);--> statement-breakpoint
CREATE TABLE `order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`order_id` text NOT NULL,
	`line_key` text NOT NULL,
	`sku_id` text NOT NULL,
	`qty` integer NOT NULL,
	`unit_price_paise` integer NOT NULL,
	`points_per_unit` integer NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `order_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sku_id`) REFERENCES `skus`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "order_lines_qty_check" CHECK(typeof("order_lines"."qty") = 'integer' and "order_lines"."qty" > 0),
	CONSTRAINT "order_lines_unit_price_paise_check" CHECK(typeof("order_lines"."unit_price_paise") = 'integer' and "order_lines"."unit_price_paise" > 0),
	CONSTRAINT "order_lines_points_per_unit_check" CHECK(typeof("order_lines"."points_per_unit") = 'integer' and "order_lines"."points_per_unit" > 0)
);
--> statement-breakpoint
CREATE INDEX `order_lines_revision_id_idx` ON `order_lines` (`revision_id`);--> statement-breakpoint
CREATE INDEX `order_lines_order_id_idx` ON `order_lines` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_lines_sku_id_idx` ON `order_lines` (`sku_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `order_lines_sku_idx` ON `order_lines` (`revision_id`,`sku_id`);--> statement-breakpoint
CREATE TABLE `order_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`revision` integer NOT NULL,
	`actor_id` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "order_revisions_revision_check" CHECK(typeof("order_revisions"."revision") = 'integer' and "order_revisions"."revision" > 0)
);
--> statement-breakpoint
CREATE INDEX `order_revisions_order_id_idx` ON `order_revisions` (`order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `order_revisions_number_idx` ON `order_revisions` (`order_id`,`revision`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`customer_id` text NOT NULL,
	`status` text NOT NULL,
	`current_revision` integer NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "orders_current_revision_check" CHECK(typeof("orders"."current_revision") = 'integer' and "orders"."current_revision" > 0),
	CONSTRAINT "orders_version_check" CHECK(typeof("orders"."version") = 'integer' and "orders"."version" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_number_unique` ON `orders` (`number`);--> statement-breakpoint
CREATE INDEX `orders_customer_id_idx` ON `orders` (`customer_id`);--> statement-breakpoint
CREATE TABLE `payment_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`receipt_id` text NOT NULL,
	`charge_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`action_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`receipt_id`) REFERENCES `payment_receipts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`charge_id`) REFERENCES `receivable_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "payment_allocations_amount_paise_check" CHECK(typeof("payment_allocations"."amount_paise") = 'integer')
);
--> statement-breakpoint
CREATE INDEX `payment_allocations_customer_id_idx` ON `payment_allocations` (`customer_id`);--> statement-breakpoint
CREATE INDEX `payment_allocations_receipt_id_idx` ON `payment_allocations` (`receipt_id`);--> statement-breakpoint
CREATE INDEX `payment_allocations_charge_id_idx` ON `payment_allocations` (`charge_id`);--> statement-breakpoint
CREATE TABLE `payment_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`reference` text NOT NULL,
	`action_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "payment_receipts_amount_paise_check" CHECK(typeof("payment_receipts"."amount_paise") = 'integer' and "payment_receipts"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE INDEX `payment_receipts_customer_id_idx` ON `payment_receipts` (`customer_id`);--> statement-breakpoint
CREATE TABLE `receivable_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`order_id` text NOT NULL,
	`line_key` text,
	`shipment_line_id` text,
	`kind` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`adjusts_id` text,
	`source_id` text NOT NULL,
	`action_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "receivable_entries_amount_paise_check" CHECK(typeof("receivable_entries"."amount_paise") = 'integer')
);
--> statement-breakpoint
CREATE INDEX `receivable_entries_customer_id_idx` ON `receivable_entries` (`customer_id`);--> statement-breakpoint
CREATE INDEX `receivable_entries_order_id_idx` ON `receivable_entries` (`order_id`);--> statement-breakpoint
CREATE TABLE `return_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`return_id` text NOT NULL,
	`shipment_line_id` text NOT NULL,
	`qty` integer NOT NULL,
	`amount_paise` integer NOT NULL,
	FOREIGN KEY (`return_id`) REFERENCES `returns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shipment_line_id`) REFERENCES `shipment_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "return_lines_qty_check" CHECK(typeof("return_lines"."qty") = 'integer' and "return_lines"."qty" > 0),
	CONSTRAINT "return_lines_amount_paise_check" CHECK(typeof("return_lines"."amount_paise") = 'integer' and "return_lines"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE INDEX `return_lines_return_id_idx` ON `return_lines` (`return_id`);--> statement-breakpoint
CREATE INDEX `return_lines_shipment_line_id_idx` ON `return_lines` (`shipment_line_id`);--> statement-breakpoint
CREATE TABLE `returns` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`gross_paise` integer NOT NULL,
	`fee_paise` integer NOT NULL,
	`reason` text NOT NULL,
	`action_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "returns_gross_paise_check" CHECK(typeof("returns"."gross_paise") = 'integer' and "returns"."gross_paise" > 0),
	CONSTRAINT "returns_fee_paise_check" CHECK(typeof("returns"."fee_paise") = 'integer' and "returns"."fee_paise" >= 0)
);
--> statement-breakpoint
CREATE INDEX `returns_order_id_idx` ON `returns` (`order_id`);--> statement-breakpoint
CREATE INDEX `returns_customer_id_idx` ON `returns` (`customer_id`);--> statement-breakpoint
CREATE TABLE `reward_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`line_key` text,
	`bucket` text NOT NULL,
	`points_delta` integer NOT NULL,
	`source_id` text NOT NULL,
	`action_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reward_ledger_points_delta_check" CHECK(typeof("reward_ledger"."points_delta") = 'integer')
);
--> statement-breakpoint
CREATE INDEX `reward_ledger_customer_id_idx` ON `reward_ledger` (`customer_id`);--> statement-breakpoint
CREATE TABLE `reward_redemptions` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`charge_id` text NOT NULL,
	`points` integer NOT NULL,
	`action_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`charge_id`) REFERENCES `receivable_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reward_redemptions_points_check" CHECK(typeof("reward_redemptions"."points") = 'integer')
);
--> statement-breakpoint
CREATE INDEX `reward_redemptions_customer_id_idx` ON `reward_redemptions` (`customer_id`);--> statement-breakpoint
CREATE INDEX `reward_redemptions_charge_id_idx` ON `reward_redemptions` (`charge_id`);--> statement-breakpoint
CREATE TABLE `shipment_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_id` text NOT NULL,
	`order_id` text NOT NULL,
	`line_key` text NOT NULL,
	`sku_id` text NOT NULL,
	`loaded_qty` integer NOT NULL,
	`dispatched_qty` integer NOT NULL,
	`unit_price_paise` integer NOT NULL,
	`points_per_unit` integer NOT NULL,
	FOREIGN KEY (`shipment_id`) REFERENCES `shipments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sku_id`) REFERENCES `skus`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "shipment_lines_loaded_qty_check" CHECK(typeof("shipment_lines"."loaded_qty") = 'integer' and "shipment_lines"."loaded_qty" >= 0),
	CONSTRAINT "shipment_lines_dispatched_qty_check" CHECK(typeof("shipment_lines"."dispatched_qty") = 'integer' and "shipment_lines"."dispatched_qty" >= 0),
	CONSTRAINT "shipment_lines_unit_price_paise_check" CHECK(typeof("shipment_lines"."unit_price_paise") = 'integer' and "shipment_lines"."unit_price_paise" > 0),
	CONSTRAINT "shipment_lines_points_per_unit_check" CHECK(typeof("shipment_lines"."points_per_unit") = 'integer' and "shipment_lines"."points_per_unit" > 0)
);
--> statement-breakpoint
CREATE INDEX `shipment_lines_shipment_id_idx` ON `shipment_lines` (`shipment_id`);--> statement-breakpoint
CREATE INDEX `shipment_lines_order_id_idx` ON `shipment_lines` (`order_id`);--> statement-breakpoint
CREATE INDEX `shipment_lines_sku_id_idx` ON `shipment_lines` (`sku_id`);--> statement-breakpoint
CREATE TABLE `shipments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`revision` integer NOT NULL,
	`status` text NOT NULL,
	`original_shipment_id` text,
	`correction_id` text,
	`created_at` text NOT NULL,
	`dispatched_at` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "shipments_revision_check" CHECK(typeof("shipments"."revision") = 'integer' and "shipments"."revision" > 0)
);
--> statement-breakpoint
CREATE INDEX `shipments_order_id_idx` ON `shipments` (`order_id`);--> statement-breakpoint
CREATE TABLE `skus` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`price_paise` integer NOT NULL,
	`points_per_unit` integer NOT NULL,
	CONSTRAINT "skus_price_paise_check" CHECK(typeof("skus"."price_paise") = 'integer' and "skus"."price_paise" > 0),
	CONSTRAINT "skus_points_per_unit_check" CHECK(typeof("skus"."points_per_unit") = 'integer' and "skus"."points_per_unit" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skus_code_unique` ON `skus` (`code`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'SALES' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "users_role_check" CHECK("__new_users"."role" in ('SALES', 'KAM', 'WAREHOUSE', 'ACCOUNTS', 'ADMIN')),
	CONSTRAINT "users_active_check" CHECK("__new_users"."active" in (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "name", "email", "password_hash", "role", "active", "created_at") SELECT "id", "name", "email", "password_hash", "role", "active", "created_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);