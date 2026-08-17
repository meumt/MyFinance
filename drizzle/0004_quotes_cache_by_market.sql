CREATE TABLE `quotes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`market` text NOT NULL,
	`symbol` text NOT NULL,
	`source` text,
	`price_micro` integer,
	`currency` text DEFAULT 'TRY' NOT NULL,
	`previous_close_micro` integer,
	`as_of` text,
	`fetched_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`error` text,
	`raw_sample` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quotes_market_symbol_idx` ON `quotes` (`market`,`symbol`);