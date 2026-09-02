CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`id_token` text,
	`password` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `account_invitations` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`account_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`role` text NOT NULL,
	`created_by_user_id` text,
	`label` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_by_user_id` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "account_invitations_role_check" CHECK(role IN ('owner', 'admin', 'agent', 'viewer')),
	CONSTRAINT "account_invitations_not_owner" CHECK(role <> 'owner')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_invitations_token_hash_unique` ON `account_invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_account_invitations_account_pending` ON `account_invitations` (`account_id`,`expires_at`) WHERE accepted_at IS NULL;--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`name` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`default_currency` text DEFAULT 'USD' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `member_presence` (
	`user_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`status` text DEFAULT 'online' NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "member_presence_status_check" CHECK("member_presence"."status" IN ('online', 'away'))
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`user_id` text NOT NULL,
	`full_name` text NOT NULL,
	`email` text NOT NULL,
	`avatar_url` text,
	`role` text DEFAULT 'user',
	`account_id` text NOT NULL,
	`account_role` text NOT NULL,
	`beta_features` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "profiles_account_role_check" CHECK(account_role IN ('owner', 'admin', 'agent', 'viewer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_user_id_unique` ON `profiles` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_profiles_account_role` ON `profiles` (`account_id`,`account_role`);--> statement-breakpoint
CREATE TABLE `contact_custom_values` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`contact_id` text NOT NULL,
	`custom_field_id` text NOT NULL,
	`value` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`custom_field_id`) REFERENCES `custom_fields`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_contact_custom_values_unique` ON `contact_custom_values` (`contact_id`,`custom_field_id`);--> statement-breakpoint
CREATE TABLE `contact_notes` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`account_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`user_id` text NOT NULL,
	`note_text` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_contact_notes_account` ON `contact_notes` (`account_id`);--> statement-breakpoint
CREATE TABLE `contact_tags` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`contact_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_contact_tags_unique` ON `contact_tags` (`contact_id`,`tag_id`);--> statement-breakpoint
CREATE INDEX `idx_contact_tags_contact` ON `contact_tags` (`contact_id`);--> statement-breakpoint
CREATE INDEX `idx_contact_tags_tag` ON `contact_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`phone` text NOT NULL,
	`phone_normalized` text,
	`name` text,
	`email` text,
	`company` text,
	`avatar_url` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_contacts_account` ON `contacts` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_contacts_phone` ON `contacts` (`phone`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_contacts_account_phone_normalized` ON `contacts` (`account_id`,`phone_normalized`) WHERE phone_normalized IS NOT NULL;--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`assigned_agent_id` text,
	`last_message_text` text,
	`last_message_at` integer,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`ai_autoreply_disabled` integer DEFAULT false NOT NULL,
	`ai_reply_count` integer DEFAULT 0 NOT NULL,
	`ai_handoff_summary` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "conversations_status_check" CHECK("conversations"."status" IN ('open', 'pending', 'closed'))
);
--> statement-breakpoint
CREATE INDEX `idx_conversations_account` ON `conversations` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_conversations_contact_id` ON `conversations` (`contact_id`);--> statement-breakpoint
CREATE TABLE `custom_fields` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`field_name` text NOT NULL,
	`field_type` text DEFAULT 'text' NOT NULL,
	`field_options` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_custom_fields_account` ON `custom_fields` (`account_id`);--> statement-breakpoint
CREATE TABLE `deals` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`pipeline_id` text NOT NULL,
	`stage_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`conversation_id` text,
	`assigned_to` text,
	`title` text NOT NULL,
	`value_minor` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD',
	`notes` text,
	`expected_close_date` text,
	`status` text DEFAULT 'active',
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pipeline_id`) REFERENCES `pipelines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`stage_id`) REFERENCES `pipeline_stages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_to`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_deals_account` ON `deals` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_deals_pipeline` ON `deals` (`pipeline_id`);--> statement-breakpoint
CREATE INDEX `idx_deals_stage` ON `deals` (`stage_id`);--> statement-breakpoint
CREATE TABLE `message_reactions` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`message_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`emoji` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "message_reactions_actor_type_check" CHECK("message_reactions"."actor_type" IN ('customer', 'agent'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_message_reactions_unique` ON `message_reactions` (`message_id`,`actor_type`,`actor_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`conversation_id` text NOT NULL,
	`sender_type` text NOT NULL,
	`sender_id` text,
	`content_type` text DEFAULT 'text' NOT NULL,
	`content_text` text,
	`media_url` text,
	`media_type` text,
	`template_name` text,
	`message_id` text,
	`status` text DEFAULT 'sent' NOT NULL,
	`reply_to_message_id` text,
	`interactive_reply_id` text,
	`interactive_payload` text,
	`ai_generated` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "messages_sender_type_check" CHECK("messages"."sender_type" IN ('customer', 'agent', 'bot')),
	CONSTRAINT "messages_content_type_check" CHECK("messages"."content_type" IN ('text', 'image', 'document', 'audio', 'video', 'location', 'template')),
	CONSTRAINT "messages_status_check" CHECK("messages"."status" IN ('sending', 'sent', 'delivered', 'read', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_messages_conversation` ON `messages` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `idx_messages_message_id` ON `messages` (`message_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`type` text DEFAULT 'conversation_assigned' NOT NULL,
	`conversation_id` text,
	`contact_id` text,
	`actor_user_id` text,
	`title` text NOT NULL,
	`body` text,
	`read_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "notifications_type_check" CHECK("notifications"."type" IN ('conversation_assigned'))
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_user_unread` ON `notifications` (`user_id`,`read_at`);--> statement-breakpoint
CREATE TABLE `pipeline_stages` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`pipeline_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`color` text DEFAULT '#3b82f6' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`pipeline_id`) REFERENCES `pipelines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_pipeline_stages_pipeline` ON `pipeline_stages` (`pipeline_id`);--> statement-breakpoint
CREATE TABLE `pipelines` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_pipelines_account` ON `pipelines` (`account_id`);--> statement-breakpoint
CREATE TABLE `quick_replies` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`kind` text DEFAULT 'text' NOT NULL,
	`content_text` text,
	`interactive_payload` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "quick_replies_kind_check" CHECK("quick_replies"."kind" IN ('text', 'interactive'))
);
--> statement-breakpoint
CREATE INDEX `idx_quick_replies_account` ON `quick_replies` (`account_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#3b82f6' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_tags_account` ON `tags` (`account_id`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`account_id` text NOT NULL,
	`created_by` text,
	`name` text NOT NULL,
	`key_prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`scopes` text DEFAULT '[]' NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_account` ON `api_keys` (`account_id`);--> statement-breakpoint
CREATE TABLE `broadcast_recipients` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`broadcast_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`whatsapp_message_id` text,
	`template_params` text,
	`sent_at` integer,
	`delivered_at` integer,
	`read_at` integer,
	`replied_at` integer,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`broadcast_id`) REFERENCES `broadcasts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "broadcast_recipients_status_check" CHECK("broadcast_recipients"."status" IN ('pending', 'sent', 'delivered', 'read', 'replied', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_broadcast_recipients_broadcast` ON `broadcast_recipients` (`broadcast_id`);--> statement-breakpoint
CREATE INDEX `idx_broadcast_recipients_wamid` ON `broadcast_recipients` (`whatsapp_message_id`);--> statement-breakpoint
CREATE TABLE `broadcasts` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`template_name` text NOT NULL,
	`template_language` text DEFAULT 'en_US' NOT NULL,
	`template_variables` text,
	`audience_filter` text,
	`scheduled_at` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`total_recipients` integer DEFAULT 0 NOT NULL,
	`sent_count` integer DEFAULT 0 NOT NULL,
	`delivered_count` integer DEFAULT 0 NOT NULL,
	`read_count` integer DEFAULT 0 NOT NULL,
	`replied_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`delivery_locked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "broadcasts_status_check" CHECK("broadcasts"."status" IN ('draft', 'scheduled', 'sending', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_broadcasts_account` ON `broadcasts` (`account_id`);--> statement-breakpoint
CREATE TABLE `message_templates` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'Marketing' NOT NULL,
	`language` text DEFAULT 'en_US',
	`header_type` text,
	`header_content` text,
	`body_text` text NOT NULL,
	`footer_text` text,
	`buttons` text,
	`status` text DEFAULT 'Draft',
	`meta_template_id` text,
	`sample_values` text,
	`header_handle` text,
	`header_media_url` text,
	`quality_score` text,
	`rejection_reason` text,
	`submission_error` text,
	`last_submitted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "message_templates_category_check" CHECK("message_templates"."category" IN ('Marketing', 'Utility', 'Authentication')),
	CONSTRAINT "message_templates_header_type_check" CHECK("message_templates"."header_type" IS NULL OR "message_templates"."header_type" IN ('text', 'image', 'video', 'document')),
	CONSTRAINT "message_templates_status_check" CHECK("message_templates"."status" IN ('Draft', 'Pending', 'Approved', 'Rejected'))
);
--> statement-breakpoint
CREATE INDEX `idx_message_templates_account` ON `message_templates` (`account_id`);--> statement-breakpoint
CREATE TABLE `webhook_endpoints` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`account_id` text NOT NULL,
	`created_by` text,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`events` text DEFAULT '[]' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_delivery_at` integer,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_webhook_endpoints_account` ON `webhook_endpoints` (`account_id`);--> statement-breakpoint
CREATE TABLE `whatsapp_config` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`phone_number_id` text NOT NULL,
	`waba_id` text,
	`access_token` text NOT NULL,
	`verify_token` text,
	`status` text DEFAULT 'disconnected' NOT NULL,
	`connected_at` integer,
	`registered_at` integer,
	`subscribed_apps_at` integer,
	`last_registration_error` text,
	`mirror_inbound_media` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "whatsapp_config_status_check" CHECK("whatsapp_config"."status" IN ('connected', 'disconnected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_config_account_id_unique` ON `whatsapp_config` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_whatsapp_config_phone_number_id` ON `whatsapp_config` (`phone_number_id`);--> statement-breakpoint
CREATE TABLE `automation_logs` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`account_id` text NOT NULL,
	`automation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`contact_id` text,
	`trigger_event` text NOT NULL,
	`steps_executed` text DEFAULT '[]' NOT NULL,
	`status` text NOT NULL,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "automation_logs_status_check" CHECK("automation_logs"."status" IN ('success', 'partial', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_automation_logs_automation` ON `automation_logs` (`automation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_automation_logs_account` ON `automation_logs` (`account_id`);--> statement-breakpoint
CREATE TABLE `automation_pending_executions` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`account_id` text NOT NULL,
	`automation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`contact_id` text,
	`log_id` text,
	`parent_step_id` text,
	`branch` text,
	`next_step_position` integer NOT NULL,
	`context` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`run_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`log_id`) REFERENCES `automation_logs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_step_id`) REFERENCES `automation_steps`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "automation_pending_status_check" CHECK("automation_pending_executions"."status" IN ('pending', 'running', 'done', 'failed')),
	CONSTRAINT "automation_pending_branch_check" CHECK("automation_pending_executions"."branch" IS NULL OR "automation_pending_executions"."branch" IN ('yes', 'no'))
);
--> statement-breakpoint
CREATE INDEX `idx_automation_pending_account` ON `automation_pending_executions` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_automation_pending_due` ON `automation_pending_executions` (`status`,`run_at`);--> statement-breakpoint
CREATE TABLE `automation_steps` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`automation_id` text NOT NULL,
	`parent_step_id` text,
	`branch` text,
	`step_type` text NOT NULL,
	`step_config` text DEFAULT '{}' NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "automation_steps_branch_check" CHECK("automation_steps"."branch" IS NULL OR "automation_steps"."branch" IN ('yes', 'no'))
);
--> statement-breakpoint
CREATE INDEX `idx_automation_steps_automation_id` ON `automation_steps` (`automation_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_automation_steps_parent` ON `automation_steps` (`parent_step_id`) WHERE parent_step_id IS NOT NULL;--> statement-breakpoint
CREATE TABLE `automations` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`trigger_type` text NOT NULL,
	`trigger_config` text DEFAULT '{}' NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`execution_count` integer DEFAULT 0 NOT NULL,
	`last_executed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_automations_account` ON `automations` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_automations_active_trigger` ON `automations` (`trigger_type`) WHERE is_active = 1;--> statement-breakpoint
CREATE TABLE `flow_nodes` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`flow_id` text NOT NULL,
	`node_key` text NOT NULL,
	`node_type` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`position_x` integer DEFAULT 0 NOT NULL,
	`position_y` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`flow_id`) REFERENCES `flows`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "flow_nodes_node_type_check" CHECK("flow_nodes"."node_type" IN ('start', 'send_buttons', 'send_list', 'send_message', 'collect_input', 'condition', 'set_tag', 'handoff', 'http_fetch', 'end'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_flow_nodes_flow_key` ON `flow_nodes` (`flow_id`,`node_key`);--> statement-breakpoint
CREATE INDEX `idx_flow_nodes_flow` ON `flow_nodes` (`flow_id`);--> statement-breakpoint
CREATE TABLE `flow_run_events` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`flow_run_id` text NOT NULL,
	`event_type` text NOT NULL,
	`node_key` text,
	`payload` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`flow_run_id`) REFERENCES `flow_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "flow_run_events_event_type_check" CHECK("flow_run_events"."event_type" IN ('started', 'node_entered', 'message_sent', 'reply_received', 'fallback_fired', 'handoff', 'timeout', 'error', 'completed'))
);
--> statement-breakpoint
CREATE INDEX `idx_flow_run_events_run` ON `flow_run_events` (`flow_run_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `flow_runs` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`account_id` text NOT NULL,
	`flow_id` text NOT NULL,
	`user_id` text NOT NULL,
	`contact_id` text,
	`conversation_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`current_node_key` text,
	`last_prompt_message_id` text,
	`vars` text DEFAULT '{}' NOT NULL,
	`reprompt_count` integer DEFAULT 0 NOT NULL,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_advanced_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`ended_at` integer,
	`end_reason` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`flow_id`) REFERENCES `flows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`last_prompt_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "flow_runs_status_check" CHECK("flow_runs"."status" IN ('active', 'completed', 'handed_off', 'timed_out', 'paused_by_agent', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_flow_runs_account` ON `flow_runs` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_one_active_run_per_contact` ON `flow_runs` (`account_id`,`contact_id`) WHERE status = 'active';--> statement-breakpoint
CREATE TABLE `flows` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`trigger_type` text NOT NULL,
	`trigger_config` text DEFAULT '{}' NOT NULL,
	`entry_node_id` text,
	`fallback_policy` text DEFAULT '{"on_unknown_reply":"reprompt","max_reprompts":2,"on_timeout_hours":24,"on_exhaust":"handoff"}' NOT NULL,
	`execution_count` integer DEFAULT 0 NOT NULL,
	`last_executed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "flows_status_check" CHECK("flows"."status" IN ('draft', 'active', 'archived')),
	CONSTRAINT "flows_trigger_type_check" CHECK("flows"."trigger_type" IN ('keyword', 'first_inbound_message', 'manual'))
);
--> statement-breakpoint
CREATE INDEX `idx_flows_account` ON `flows` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_flows_active_trigger` ON `flows` (`account_id`,`trigger_type`) WHERE status = 'active';--> statement-breakpoint
CREATE TABLE `ai_configs` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`account_id` text NOT NULL,
	`created_by` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`api_key` text NOT NULL,
	`embeddings_api_key` text,
	`system_prompt` text,
	`is_active` integer DEFAULT false NOT NULL,
	`auto_reply_enabled` integer DEFAULT false NOT NULL,
	`auto_reply_max_per_conversation` integer DEFAULT 3 NOT NULL,
	`handoff_agent_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`handoff_agent_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ai_configs_provider_check" CHECK("ai_configs"."provider" IN ('openai', 'anthropic')),
	CONSTRAINT "ai_configs_auto_reply_max_check" CHECK("ai_configs"."auto_reply_max_per_conversation" BETWEEN 1 AND 20)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_configs_account_id_unique` ON `ai_configs` (`account_id`);--> statement-breakpoint
CREATE TABLE `ai_knowledge_chunks` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`document_id` text NOT NULL,
	`account_id` text NOT NULL,
	`chunk_index` integer DEFAULT 0 NOT NULL,
	`content` text NOT NULL,
	`vectorized_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `ai_knowledge_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ai_knowledge_chunks_account` ON `ai_knowledge_chunks` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_ai_knowledge_chunks_document` ON `ai_knowledge_chunks` (`document_id`);--> statement-breakpoint
CREATE INDEX `idx_ai_knowledge_chunks_unvectorized` ON `ai_knowledge_chunks` (`account_id`) WHERE vectorized_at IS NULL;--> statement-breakpoint
CREATE TABLE `ai_knowledge_documents` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`account_id` text NOT NULL,
	`created_by` text,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_ai_knowledge_documents_account` ON `ai_knowledge_documents` (`account_id`);--> statement-breakpoint
CREATE TABLE `ai_usage_log` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`account_id` text NOT NULL,
	`conversation_id` text,
	`mode` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ai_usage_log_mode_check" CHECK("ai_usage_log"."mode" IN ('auto_reply', 'draft')),
	CONSTRAINT "ai_usage_log_provider_check" CHECK("ai_usage_log"."provider" IN ('openai', 'anthropic'))
);
--> statement-breakpoint
CREATE INDEX `idx_ai_usage_log_account` ON `ai_usage_log` (`account_id`,`created_at`);