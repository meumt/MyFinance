CREATE TABLE `holdings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text DEFAULT 'hisse' NOT NULL,
	`market` text NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`currency` text DEFAULT 'TRY' NOT NULL,
	`quantity_micro` integer DEFAULT 0 NOT NULL,
	`total_cost_minor` integer DEFAULT 0 NOT NULL,
	`total_cost_try_minor` integer,
	`provider` text DEFAULT 'yahoo' NOT NULL,
	`manual_price_micro` integer,
	`broker_account_id` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`exclude_from_net_worth` integer DEFAULT false NOT NULL,
	`color` text DEFAULT '#8b5cf6' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`broker_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `holdings_symbol_idx` ON `holdings` (`provider`,`symbol`);--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`symbol` text NOT NULL,
	`price_micro` integer,
	`currency` text DEFAULT 'TRY' NOT NULL,
	`previous_close_micro` integer,
	`as_of` text,
	`fetched_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`error` text,
	`raw_sample` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quotes_provider_symbol_idx` ON `quotes` (`provider`,`symbol`);