CREATE TYPE "public"."analysis_status" AS ENUM('pending', 'analyzing', 'ready', 'error');--> statement-breakpoint
CREATE TYPE "public"."bot_status" AS ENUM('stopped', 'scanning', 'logged_in', 'error');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('web', 'wechat');--> statement-breakpoint
CREATE TYPE "public"."character_family" AS ENUM('colleague', 'relationship', 'celebrity');--> statement-breakpoint
CREATE TYPE "public"."emotional_state" AS ENUM('warm', 'playful', 'nostalgic', 'melancholy', 'happy', 'distant');--> statement-breakpoint
CREATE TYPE "public"."file_type" AS ENUM('chat_txt', 'chat_csv', 'image', 'video');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."pipeline_stage" AS ENUM('intake', 'collecting', 'analyzing_persona', 'analyzing_work', 'building', 'merging', 'correcting', 'complete', 'error');--> statement-breakpoint
CREATE TYPE "public"."process_status" AS ENUM('uploaded', 'processing', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "llm_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"providerName" varchar(64) NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"apiKey" varchar(512),
	"baseUrl" varchar(512),
	"model" varchar(128),
	"systemMessage" text,
	"extraConfig" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"personaId" integer NOT NULL,
	"userId" integer NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"emotionalState" varchar(50),
	"channel" "channel" DEFAULT 'web' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"personaId" integer NOT NULL,
	"userId" integer NOT NULL,
	"fileType" "file_type" NOT NULL,
	"originalName" varchar(255) NOT NULL,
	"fileKey" varchar(500) NOT NULL,
	"fileUrl" text NOT NULL,
	"fileSize" integer NOT NULL,
	"extractedMemory" text,
	"processStatus" "process_status" DEFAULT 'uploaded' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"avatarUrl" text,
	"relationshipDesc" varchar(200),
	"togetherFrom" varchar(50),
	"togetherTo" varchar(50),
	"personaData" jsonb,
	"analysisStatus" "analysis_status" DEFAULT 'pending' NOT NULL,
	"analysisProgress" integer DEFAULT 0 NOT NULL,
	"analysisMessage" text,
	"emotionalState" "emotional_state" DEFAULT 'warm' NOT NULL,
	"chatCount" integer DEFAULT 0 NOT NULL,
	"lastChatAt" timestamp,
	"skillJobId" integer,
	"llmProvider" varchar(64),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"personaId" integer NOT NULL,
	"userId" integer NOT NULL,
	"characterFamily" character_family DEFAULT 'relationship' NOT NULL,
	"pipelineStage" "pipeline_stage" DEFAULT 'intake' NOT NULL,
	"stageProgress" integer DEFAULT 0 NOT NULL,
	"stageMessage" text,
	"inputMeta" jsonb,
	"analysisResult" jsonb,
	"generatedSkillPath" varchar(500),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(100) NOT NULL,
	"passwordHash" varchar(255),
	"openId" varchar(64),
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "role" DEFAULT 'user' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
CREATE TABLE "wechat_bindings" (
	"id" serial PRIMARY KEY NOT NULL,
	"personaId" integer NOT NULL,
	"userId" integer NOT NULL,
	"wechatContactId" varchar(255) NOT NULL,
	"wechatName" varchar(255),
	"wechatAlias" varchar(255),
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wechat_bot_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"status" "bot_status" DEFAULT 'stopped' NOT NULL,
	"qrCodeUrl" text,
	"loggedInUser" varchar(255),
	"lastError" text,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
