CREATE TYPE "public"."graduation_status" AS ENUM('suggested', 'graduated', 'declined');--> statement-breakpoint
CREATE TYPE "public"."memory_category" AS ENUM('milestone', 'memory', 'anniversary');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('text', 'voice', 'image');--> statement-breakpoint
CREATE TABLE "diary_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"personaId" integer NOT NULL,
	"userId" integer NOT NULL,
	"date" varchar(20) NOT NULL,
	"summary" text NOT NULL,
	"highlights" jsonb,
	"emotionalArc" jsonb,
	"quotes" jsonb,
	"reflection" text,
	"messageCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emotion_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"personaId" integer NOT NULL,
	"userId" integer NOT NULL,
	"emotionalState" varchar(50) NOT NULL,
	"messageCount" integer DEFAULT 0 NOT NULL,
	"date" varchar(20) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" serial PRIMARY KEY NOT NULL,
	"personaId" integer NOT NULL,
	"userId" integer NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"category" "memory_category" DEFAULT 'memory' NOT NULL,
	"date" varchar(50),
	"messageId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenes" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer,
	"name" varchar(100) NOT NULL,
	"description" text,
	"icon" varchar(10),
	"systemPromptOverlay" text,
	"emotionalState" varchar(50),
	"starters" jsonb,
	"isBuiltin" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "messageType" "message_type" DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "mediaUrl" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "mediaDuration" integer;--> statement-breakpoint
ALTER TABLE "personas" ADD COLUMN "intimacyScore" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "personas" ADD COLUMN "intimacyLevel" varchar(50) DEFAULT '初识' NOT NULL;--> statement-breakpoint
ALTER TABLE "personas" ADD COLUMN "activeSceneId" integer;--> statement-breakpoint
ALTER TABLE "personas" ADD COLUMN "graduationStatus" "graduation_status";--> statement-breakpoint
ALTER TABLE "personas" ADD COLUMN "graduatedAt" timestamp;--> statement-breakpoint
ALTER TABLE "personas" ADD COLUMN "farewellLetter" text;