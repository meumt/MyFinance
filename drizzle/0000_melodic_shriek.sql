CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`institution_id` integer,
	`name` text NOT NULL,
	`type` text DEFAULT 'vadesiz' NOT NULL,
	`currency` text DEFAULT 'TRY' NOT NULL,
	`iban` text,
	`opening_balance_minor` integer DEFAULT 0 NOT NULL,
	`opening_date` text NOT NULL,
	`overdraft_limit_minor` integer DEFAULT 0 NOT NULL,
	`overdraft_rate_bps` integer DEFAULT 0 NOT NULL,
	`maturity_date` text,
	`interest_rate_bps` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`exclude_from_net_worth` integer DEFAULT false NOT NULL,
	`color` text DEFAULT '#0ea5e9' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `accounts_institution_idx` ON `accounts` (`institution_id`);--> statement-breakpoint
CREATE TABLE `balance_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`date` text NOT NULL,
	`balance_minor` integer NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `balance_snapshots_account_idx` ON `balance_snapshots` (`account_id`,`date`);--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`month` text,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'TRY' NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_cat_month_idx` ON `budgets` (`category_id`,`month`);--> statement-breakpoint
CREATE TABLE `cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`institution_id` integer,
	`name` text NOT NULL,
	`type` text DEFAULT 'kredi' NOT NULL,
	`parent_card_id` integer,
	`shares_parent_limit` integer DEFAULT true NOT NULL,
	`last_four` text,
	`network` text,
	`currency` text DEFAULT 'TRY' NOT NULL,
	`credit_limit_minor` integer DEFAULT 0 NOT NULL,
	`cash_advance_limit_minor` integer DEFAULT 0 NOT NULL,
	`statement_day` integer,
	`due_day` integer,
	`linked_account_id` integer,
	`auto_pay_mode` text DEFAULT 'yok' NOT NULL,
	`opening_debt_minor` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`color` text DEFAULT '#8b5cf6' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`linked_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `cards_institution_idx` ON `cards` (`institution_id`);--> statement-breakpoint
CREATE INDEX `cards_parent_idx` ON `cards` (`parent_card_id`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`parent_id` integer,
	`kind` text DEFAULT 'gider' NOT NULL,
	`icon` text,
	`color` text DEFAULT '#94a3b8' NOT NULL,
	`is_essential` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `categories_parent_idx` ON `categories` (`parent_id`);--> statement-breakpoint
CREATE TABLE `exchange_rates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`date` text NOT NULL,
	`rate_micro` integer NOT NULL,
	`source` text DEFAULT 'manuel' NOT NULL,
	`fetched_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fx_code_date_idx` ON `exchange_rates` (`code`,`date`);--> statement-breakpoint
CREATE TABLE `import_drafts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text,
	`raw_text` text NOT NULL,
	`parsed_json` text NOT NULL,
	`target_account_id` integer,
	`target_card_id` integer,
	`status` text DEFAULT 'taslak' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `installment_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer NOT NULL,
	`merchant_id` integer,
	`category_id` integer,
	`description` text NOT NULL,
	`purchase_date` text NOT NULL,
	`total_amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'TRY' NOT NULL,
	`installment_count` integer NOT NULL,
	`paid_count` integer DEFAULT 0 NOT NULL,
	`first_due_date` text NOT NULL,
	`status` text DEFAULT 'aktif' NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `plans_card_idx` ON `installment_plans` (`card_id`,`status`);--> statement-breakpoint
CREATE TABLE `installments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plan_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`amount_minor` integer NOT NULL,
	`due_date` text NOT NULL,
	`statement_id` integer,
	`is_paid` integer DEFAULT false NOT NULL,
	`transaction_id` integer,
	FOREIGN KEY (`plan_id`) REFERENCES `installment_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`statement_id`) REFERENCES `statements`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `installments_plan_seq_idx` ON `installments` (`plan_id`,`seq`);--> statement-breakpoint
CREATE INDEX `installments_due_idx` ON `installments` (`due_date`,`is_paid`);--> statement-breakpoint
CREATE TABLE `institutions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`short_name` text,
	`color` text DEFAULT '#64748b' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `loan_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`loan_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`due_date` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`principal_minor` integer DEFAULT 0 NOT NULL,
	`interest_minor` integer DEFAULT 0 NOT NULL,
	`is_paid` integer DEFAULT false NOT NULL,
	`transaction_id` integer,
	FOREIGN KEY (`loan_id`) REFERENCES `loans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `loan_payments_seq_idx` ON `loan_payments` (`loan_id`,`seq`);--> statement-breakpoint
CREATE INDEX `loan_payments_due_idx` ON `loan_payments` (`due_date`,`is_paid`);--> statement-breakpoint
CREATE TABLE `loans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`institution_id` integer,
	`name` text NOT NULL,
	`type` text DEFAULT 'ihtiyac' NOT NULL,
	`principal_minor` integer NOT NULL,
	`currency` text DEFAULT 'TRY' NOT NULL,
	`annual_rate_bps` integer DEFAULT 0 NOT NULL,
	`installment_count` integer NOT NULL,
	`monthly_payment_minor` integer NOT NULL,
	`first_payment_date` text NOT NULL,
	`payment_account_id` integer,
	`status` text DEFAULT 'aktif' NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`payment_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `merchants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`normalized` text NOT NULL,
	`default_category_id` integer,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`default_category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchants_normalized_unique` ON `merchants` (`normalized`);--> statement-breakpoint
CREATE INDEX `merchants_usage_idx` ON `merchants` (`usage_count`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dedupe_key` text NOT NULL,
	`type` text NOT NULL,
	`severity` text DEFAULT 'bilgi' NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`target_date` text,
	`entity_type` text,
	`entity_id` integer,
	`channels` text,
	`sent_at` integer,
	`read_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedupe_key_unique` ON `notifications` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notifications_created_idx` ON `notifications` (`created_at`);--> statement-breakpoint
CREATE TABLE `recurring_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'gelir' NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'TRY' NOT NULL,
	`cycle` text DEFAULT 'aylik' NOT NULL,
	`day_of_month` integer DEFAULT 1 NOT NULL,
	`account_id` integer,
	`card_id` integer,
	`category_id` integer,
	`start_date` text NOT NULL,
	`end_date` text,
	`next_date` text NOT NULL,
	`auto_post` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`notes` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `recurring_next_idx` ON `recurring_items` (`next_date`,`is_active`);--> statement-breakpoint
CREATE TABLE `savings_goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`target_minor` integer NOT NULL,
	`currency` text DEFAULT 'TRY' NOT NULL,
	`target_date` text,
	`account_id` integer,
	`manual_saved_minor` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`color` text DEFAULT '#10b981' NOT NULL,
	`notes` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `statements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`statement_date` text NOT NULL,
	`due_date` text NOT NULL,
	`previous_balance_minor` integer DEFAULT 0 NOT NULL,
	`total_due_minor` integer DEFAULT 0 NOT NULL,
	`minimum_due_minor` integer DEFAULT 0 NOT NULL,
	`paid_minor` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'acik' NOT NULL,
	`currency` text DEFAULT 'TRY' NOT NULL,
	`notes` text,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `statements_card_period_idx` ON `statements` (`card_id`,`period_end`);--> statement-breakpoint
CREATE INDEX `statements_due_idx` ON `statements` (`due_date`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`merchant_id` integer,
	`category_id` integer,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'TRY' NOT NULL,
	`cycle` text DEFAULT 'aylik' NOT NULL,
	`cycle_days` integer,
	`start_date` text NOT NULL,
	`next_renewal_date` text NOT NULL,
	`end_date` text,
	`last_charged_date` text,
	`payment_card_id` integer,
	`payment_account_id` integer,
	`auto_renew` integer DEFAULT true NOT NULL,
	`reminder_days_before` integer DEFAULT 2 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`payment_card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`payment_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `subs_next_idx` ON `subscriptions` (`next_renewal_date`,`is_active`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`kind` text DEFAULT 'gider' NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'TRY' NOT NULL,
	`fx_rate_micro` integer,
	`account_id` integer,
	`card_id` integer,
	`counter_account_id` integer,
	`counter_card_id` integer,
	`category_id` integer,
	`merchant_id` integer,
	`statement_id` integer,
	`installment_plan_id` integer,
	`installment_no` integer,
	`subscription_id` integer,
	`loan_payment_id` integer,
	`description` text,
	`note` text,
	`tags` text,
	`source` text DEFAULT 'manuel' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`counter_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`counter_card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`statement_id`) REFERENCES `statements`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tx_date_idx` ON `transactions` (`date`);--> statement-breakpoint
CREATE INDEX `tx_account_idx` ON `transactions` (`account_id`,`date`);--> statement-breakpoint
CREATE INDEX `tx_card_idx` ON `transactions` (`card_id`,`date`);--> statement-breakpoint
CREATE INDEX `tx_category_idx` ON `transactions` (`category_id`,`date`);--> statement-breakpoint
CREATE INDEX `tx_plan_idx` ON `transactions` (`installment_plan_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text,
	`session_epoch` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);