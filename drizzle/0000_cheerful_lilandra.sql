CREATE TABLE "accounts" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"brokerage_id" uuid NOT NULL,
	"role" text DEFAULT 'dispatcher' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_brokerage_key" UNIQUE("user_id","brokerage_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp with time zone,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "brokerages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brokerages_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "carrier_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brokerage_id" uuid NOT NULL,
	"carrier_id" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"authority_status" text NOT NULL,
	"insurance_on_file" boolean,
	"safety_rating" text NOT NULL,
	"out_of_service" boolean NOT NULL,
	"out_of_service_date" text,
	"power_units" integer,
	"drivers" integer,
	"verdict_level" text NOT NULL,
	"verdict_reasons" jsonb NOT NULL,
	"ruleset_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carriers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brokerage_id" uuid NOT NULL,
	"dot_number" text,
	"mc_number" text,
	"legal_name" text NOT NULL,
	"dba_name" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brokerage_id" uuid NOT NULL,
	"load_id" uuid,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"content_type" text DEFAULT 'application/pdf' NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_by_user_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "loads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brokerage_id" uuid NOT NULL,
	"reference_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"equipment_type" text,
	"commodity_description" text,
	"weight_lbs" integer,
	"customer_rate_cents" bigint,
	"carrier_pay_cents" bigint,
	"carrier_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loads_brokerage_reference_key" UNIQUE("brokerage_id","reference_number")
);
--> statement-breakpoint
CREATE TABLE "stops" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brokerage_id" uuid NOT NULL,
	"load_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"party_id" uuid NOT NULL,
	"opens_at_local" timestamp,
	"closes_at_local" timestamp,
	"time_zone" text,
	"appointment_type" text,
	"window_raw_text" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stops_load_sequence_key" UNIQUE("load_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brokerage_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"region" text,
	"postal_code" text,
	"country" text DEFAULT 'US' NOT NULL,
	"time_zone" text,
	"contact_name" text,
	"contact_phone" text,
	"contact_email" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_brokerage_id_brokerages_id_fk" FOREIGN KEY ("brokerage_id") REFERENCES "public"."brokerages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_checks" ADD CONSTRAINT "carrier_checks_brokerage_id_brokerages_id_fk" FOREIGN KEY ("brokerage_id") REFERENCES "public"."brokerages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_checks" ADD CONSTRAINT "carrier_checks_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carriers" ADD CONSTRAINT "carriers_brokerage_id_brokerages_id_fk" FOREIGN KEY ("brokerage_id") REFERENCES "public"."brokerages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_brokerage_id_brokerages_id_fk" FOREIGN KEY ("brokerage_id") REFERENCES "public"."brokerages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_generated_by_user_id_users_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_brokerage_id_brokerages_id_fk" FOREIGN KEY ("brokerage_id") REFERENCES "public"."brokerages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_brokerage_id_brokerages_id_fk" FOREIGN KEY ("brokerage_id") REFERENCES "public"."brokerages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_brokerage_id_brokerages_id_fk" FOREIGN KEY ("brokerage_id") REFERENCES "public"."brokerages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "carrier_checks_lookup_idx" ON "carrier_checks" USING btree ("brokerage_id","carrier_id","checked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "carriers_brokerage_dot_key" ON "carriers" USING btree ("brokerage_id","dot_number") WHERE "carriers"."dot_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "carriers_brokerage_mc_key" ON "carriers" USING btree ("brokerage_id","mc_number") WHERE "carriers"."mc_number" is not null;--> statement-breakpoint
CREATE INDEX "documents_brokerage_load_idx" ON "documents" USING btree ("brokerage_id","load_id");--> statement-breakpoint
CREATE INDEX "loads_brokerage_status_idx" ON "loads" USING btree ("brokerage_id","status");--> statement-breakpoint
CREATE INDEX "stops_brokerage_load_idx" ON "stops" USING btree ("brokerage_id","load_id");--> statement-breakpoint
CREATE INDEX "parties_brokerage_name_idx" ON "parties" USING btree ("brokerage_id","name");