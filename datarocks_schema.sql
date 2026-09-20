


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";





SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."ai_chat_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text",
    "messages" "jsonb" DEFAULT '[]'::"jsonb",
    "insights" "jsonb" DEFAULT '[]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."ai_chat_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."connector_config" (
    "connector" "text" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."connector_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."custom_connectors" (
    "id" "text" NOT NULL,
    "label" "text" NOT NULL,
    "color" "text" NOT NULL,
    "windsor_source" "text" NOT NULL,
    "metric_schema" "text" NOT NULL,
    "primary_dimension" "jsonb" NOT NULL,
    "dimensions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "ai_dimensions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "custom_metrics" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."custom_connectors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."custom_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "type" "text",
    "start_date" "text" NOT NULL,
    "end_date" "text",
    "title" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."custom_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."optimizer_analysis" (
    "hash" "text" NOT NULL,
    "connector" "text" NOT NULL,
    "goal_label" "text" DEFAULT 'revenue'::"text" NOT NULL,
    "findings" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "worded" "jsonb",
    "analyzed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."optimizer_analysis" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."optimizer_marks" (
    "user_id" "uuid" NOT NULL,
    "connector" "text" NOT NULL,
    "period" "text" NOT NULL,
    "recommendation_id" "text" NOT NULL,
    "state" "text" NOT NULL,
    "marked_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "snapshot" "jsonb",
    CONSTRAINT "optimizer_marks_period_shape" CHECK (("period" ~ '^\d{4}(-(0[1-9]|1[0-2]))?$'::"text")),
    CONSTRAINT "optimizer_marks_state" CHECK (("state" = ANY (ARRAY['completed'::"text", 'dismissed'::"text"])))
);


ALTER TABLE "public"."optimizer_marks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prompts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "content" "text" DEFAULT ''::"text" NOT NULL,
    "active" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "prompts_type_check" CHECK (("type" = ANY (ARRAY['core'::"text", 'google_ads'::"text", 'meta_ads'::"text", 'ga4'::"text", 'shopify'::"text", 'preset_questions'::"text", 'preset_google_ads'::"text", 'preset_meta_ads'::"text", 'preset_ga4'::"text", 'preset_shopify'::"text", 'optimizer_google_ads'::"text", 'optimizer_meta_ads'::"text", 'optimizer_ga4'::"text", 'optimizer_shopify'::"text"])))
);


ALTER TABLE "public"."prompts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."smart_goal_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "type" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date",
    "title" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "smart_goal_events_category_check" CHECK (("category" = ANY (ARRAY['events'::"text", 'ads'::"text", 'website'::"text"]))),
    CONSTRAINT "smart_goal_events_span" CHECK ((("end_date" IS NULL) OR ("end_date" >= "start_date")))
);


ALTER TABLE "public"."smart_goal_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."smart_goals" (
    "user_id" "uuid" NOT NULL,
    "period" "text" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "connector" "text" DEFAULT 'google_ads'::"text" NOT NULL,
    CONSTRAINT "smart_goals_period_shape" CHECK (("period" ~ '^\d{4}(-(0[1-9]|1[0-2]))?$'::"text"))
);


ALTER TABLE "public"."smart_goals" OWNER TO "postgres";


ALTER TABLE ONLY "public"."ai_chat_sessions"
    ADD CONSTRAINT "ai_chat_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."connector_config"
    ADD CONSTRAINT "connector_config_pkey" PRIMARY KEY ("connector");



ALTER TABLE ONLY "public"."custom_connectors"
    ADD CONSTRAINT "custom_connectors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."custom_events"
    ADD CONSTRAINT "custom_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."optimizer_analysis"
    ADD CONSTRAINT "optimizer_analysis_pkey" PRIMARY KEY ("hash");



ALTER TABLE ONLY "public"."optimizer_marks"
    ADD CONSTRAINT "optimizer_marks_pkey" PRIMARY KEY ("user_id", "connector", "period", "recommendation_id");



ALTER TABLE ONLY "public"."prompts"
    ADD CONSTRAINT "prompts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."smart_goal_events"
    ADD CONSTRAINT "smart_goal_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."smart_goals"
    ADD CONSTRAINT "smart_goals_pkey" PRIMARY KEY ("user_id", "connector", "period");



CREATE INDEX "optimizer_analysis_pending_idx" ON "public"."optimizer_analysis" USING "btree" ("created_at") WHERE ("worded" IS NULL);



CREATE INDEX "optimizer_marks_lookup" ON "public"."optimizer_marks" USING "btree" ("user_id", "connector", "period");



CREATE INDEX "smart_goal_events_user_start" ON "public"."smart_goal_events" USING "btree" ("user_id", "start_date");



ALTER TABLE ONLY "public"."ai_chat_sessions"
    ADD CONSTRAINT "ai_chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."custom_events"
    ADD CONSTRAINT "custom_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."optimizer_marks"
    ADD CONSTRAINT "optimizer_marks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."smart_goal_events"
    ADD CONSTRAINT "smart_goal_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."smart_goals"
    ADD CONSTRAINT "smart_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Users can delete their own custom events" ON "public"."custom_events" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own custom events" ON "public"."custom_events" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own custom events" ON "public"."custom_events" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."ai_chat_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."connector_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."custom_connectors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."custom_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."optimizer_analysis" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."optimizer_marks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "own" ON "public"."ai_chat_sessions" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "own goal events: delete" ON "public"."smart_goal_events" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "own goal events: read" ON "public"."smart_goal_events" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "own goal events: update" ON "public"."smart_goal_events" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own goal events: write" ON "public"."smart_goal_events" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own optimizer marks: delete" ON "public"."optimizer_marks" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "own optimizer marks: read" ON "public"."optimizer_marks" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "own optimizer marks: update" ON "public"."optimizer_marks" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own optimizer marks: write" ON "public"."optimizer_marks" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own smart goals: delete" ON "public"."smart_goals" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "own smart goals: read" ON "public"."smart_goals" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "own smart goals: update" ON "public"."smart_goals" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own smart goals: write" ON "public"."smart_goals" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."prompts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."smart_goal_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."smart_goals" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";





































































































































































GRANT ALL ON TABLE "public"."ai_chat_sessions" TO "anon";
GRANT ALL ON TABLE "public"."ai_chat_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_chat_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."connector_config" TO "anon";
GRANT ALL ON TABLE "public"."connector_config" TO "authenticated";
GRANT ALL ON TABLE "public"."connector_config" TO "service_role";



GRANT ALL ON TABLE "public"."custom_connectors" TO "anon";
GRANT ALL ON TABLE "public"."custom_connectors" TO "authenticated";
GRANT ALL ON TABLE "public"."custom_connectors" TO "service_role";



GRANT ALL ON TABLE "public"."custom_events" TO "anon";
GRANT ALL ON TABLE "public"."custom_events" TO "authenticated";
GRANT ALL ON TABLE "public"."custom_events" TO "service_role";



GRANT ALL ON TABLE "public"."optimizer_analysis" TO "anon";
GRANT ALL ON TABLE "public"."optimizer_analysis" TO "authenticated";
GRANT ALL ON TABLE "public"."optimizer_analysis" TO "service_role";



GRANT ALL ON TABLE "public"."optimizer_marks" TO "anon";
GRANT ALL ON TABLE "public"."optimizer_marks" TO "authenticated";
GRANT ALL ON TABLE "public"."optimizer_marks" TO "service_role";



GRANT ALL ON TABLE "public"."prompts" TO "anon";
GRANT ALL ON TABLE "public"."prompts" TO "authenticated";
GRANT ALL ON TABLE "public"."prompts" TO "service_role";



GRANT ALL ON TABLE "public"."smart_goal_events" TO "anon";
GRANT ALL ON TABLE "public"."smart_goal_events" TO "authenticated";
GRANT ALL ON TABLE "public"."smart_goal_events" TO "service_role";



GRANT ALL ON TABLE "public"."smart_goals" TO "anon";
GRANT ALL ON TABLE "public"."smart_goals" TO "authenticated";
GRANT ALL ON TABLE "public"."smart_goals" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































