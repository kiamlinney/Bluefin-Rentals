


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


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."booking_status" AS ENUM (
    'pending',
    'confirmed',
    'failed',
    'canceled',
    'completed'
);


ALTER TYPE "public"."booking_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_complete_bookings"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- 1. Temporarily place the session in 'replica' mode to bypass all table triggers
  SET LOCAL session_replication_role = 'replica';
  
  -- 2. Execute the status update cleanly
  UPDATE public.bookings
  SET status = 'completed'
  WHERE status = 'confirmed'
  AND end_time < now();
  
  -- 3. Reset the session back to normal so standard users are still restricted
  RESET session_replication_role;
END;
$$;


ALTER FUNCTION "public"."auto_complete_bookings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bookings_guard_status"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  jwt_role text := coalesce(current_setting('request.jwt.claims', true)::json->>'role', '');
  is_service boolean := jwt_role = 'service_role';
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'pending'::booking_status and not is_service then
      raise exception 'New bookings must start as pending';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if not is_service then
      raise exception 'status is server-managed and cannot be changed by this role';
    end if;

    if not (
      (old.status = 'pending'   and new.status in ('confirmed', 'canceled', 'failed')) or
      (old.status = 'confirmed' and new.status in ('completed', 'canceled'))
    ) then
      raise exception 'Illegal status transition: % -> %', old.status, new.status;
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."bookings_guard_status"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."cars" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "make" "text" NOT NULL,
    "model" "text" NOT NULL,
    "year" integer NOT NULL,
    "color" "text",
    "price_per_day" numeric NOT NULL,
    "image_url" "text",
    "is_available" boolean DEFAULT true,
    "mpg" integer,
    "num_seats" integer,
    "fuel_type" "text",
    "transmission" "text",
    "features" "jsonb",
    "license_plate" "text",
    "gallery_images" "text"[],
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "trim" "text" DEFAULT '0'::"text",
    CONSTRAINT "cars_license_plate_check" CHECK ((("length"("license_plate") >= 1) AND ("length"("license_plate") <= 8))),
    CONSTRAINT "cars_mpg_check" CHECK (("mpg" > 0)),
    CONSTRAINT "cars_num_seats_check" CHECK (("num_seats" > 0))
);


ALTER TABLE "public"."cars" OWNER TO "postgres";


COMMENT ON COLUMN "public"."cars"."trim" IS 'extra information on vehicle model';



CREATE OR REPLACE FUNCTION "public"."get_available_cars"("start_ts" timestamp with time zone, "end_ts" timestamp with time zone) RETURNS SETOF "public"."cars"
    LANGUAGE "sql" STABLE
    AS $$
  -- Half-open interval logic: [start, end)
  select c.*
  from public.cars c
  where coalesce(c.is_available, true) = true

    -- 1) Exclude cars with overlapping bookings in blocking statuses
    and not exists (
      select 1
      from public.bookings b
      where b.car_id = c.id
        and b.status in ('pending','confirmed')
        and tstzrange(b.start_time, b.end_time, '[)') && tstzrange(start_ts, end_ts, '[)')
    )

    -- 2) Exclude cars with overlapping manual blocked dates (date-only)
    -- Convert to date ranges and compare using daterange(date, date)
    and not exists (
      select 1
      from public.car_blocked_dates d
      where d.car_id = c.id
        and daterange(d.start_date, d.end_date + 1, '[)')
            && daterange(start_ts::date, end_ts::date, '[)')
    )

    -- 3) Exclude cars with overlapping Turo bookings synced from Gmail.
    -- No status column here — every row is a real external booking, so it's
    -- an unconditional overlap check, same shape as (1).
    and not exists (
      select 1
      from public.turo_bookings t
      where t.car_id = c.id
        and tstzrange(t.start_time, t.end_time, '[)') && tstzrange(start_ts, end_ts, '[)')
    )

  order by c.price_per_day asc, c.make asc, c.model asc, c.year asc;
$$;


ALTER FUNCTION "public"."get_available_cars"("start_ts" timestamp with time zone, "end_ts" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_car_unavailability"("car_id_param" bigint) RETURNS TABLE("start_time" timestamp with time zone, "end_time" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$begin
  return query
  select b.start_time, b.end_time
  from bookings b
  where b.car_id = car_id_param
    and b.status in ('confirmed');
end;$$;


ALTER FUNCTION "public"."get_car_unavailability"("car_id_param" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end; $$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_user_updated"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.profiles
  set email = new.email
  where id = new.id;
  return new;
end; $$;


ALTER FUNCTION "public"."handle_user_updated"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    (select is_admin from public.profiles where id = auth.uid()),
    false
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bookings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "car_id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone NOT NULL,
    "total_price" numeric NOT NULL,
    "status" "public"."booking_status" DEFAULT 'pending'::"public"."booking_status",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "stripe_payment_intent_id" "text",
    "pickup_location" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "miles_driven" bigint,
    CONSTRAINT "bookings_time_order_chk" CHECK (("end_time" > "start_time")),
    CONSTRAINT "bookings_total_price_nonneg_chk" CHECK (("total_price" >= (0)::numeric))
);


ALTER TABLE "public"."bookings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."car_blocked_dates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "car_id" bigint NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "blocked_dates_order_chk" CHECK (("end_date" >= "start_date"))
);


ALTER TABLE "public"."car_blocked_dates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."car_price_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "car_id" bigint NOT NULL,
    "date" "date" NOT NULL,
    "price" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "car_price_overrides_price_check" CHECK (("price" > (0)::numeric))
);


ALTER TABLE "public"."car_price_overrides" OWNER TO "postgres";


ALTER TABLE "public"."cars" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."cars_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "date_of_birth" "date",
    "phone" "text" DEFAULT ''::"text",
    "address" "text",
    "city" "text",
    "state" "text",
    "zip" "text",
    "stripe_identity_session_id" "text" DEFAULT ''::"text",
    "identity_verified" boolean DEFAULT false,
    "identity_verified_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "email" "text",
    "is_admin" boolean DEFAULT false,
    "num_trips" integer DEFAULT 0
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."num_trips" IS 'number of trips';



CREATE TABLE IF NOT EXISTS "public"."turo_bookings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "car_id" bigint NOT NULL,
    "gmail_message_id" "text" NOT NULL,
    "renter_name" "text",
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone NOT NULL,
    "turo_trip_id" "text",
    "raw_subject" "text",
    "synced_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."turo_bookings" OWNER TO "postgres";


ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."car_blocked_dates"
    ADD CONSTRAINT "car_blocked_dates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."car_price_overrides"
    ADD CONSTRAINT "car_price_overrides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."car_price_overrides"
    ADD CONSTRAINT "car_price_overrides_unique" UNIQUE ("car_id", "date");



ALTER TABLE ONLY "public"."cars"
    ADD CONSTRAINT "cars_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."turo_bookings"
    ADD CONSTRAINT "turo_bookings_gmail_message_id_key" UNIQUE ("gmail_message_id");



ALTER TABLE ONLY "public"."turo_bookings"
    ADD CONSTRAINT "turo_bookings_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_blocked_dates_car" ON "public"."car_blocked_dates" USING "btree" ("car_id", "start_date", "end_date");



CREATE INDEX "idx_bookings_availability" ON "public"."bookings" USING "btree" ("car_id", "start_time", "end_time") WHERE (("status" = 'pending'::"public"."booking_status") OR ("status" = 'confirmed'::"public"."booking_status"));



CREATE INDEX "idx_bookings_stripe_pi" ON "public"."bookings" USING "btree" ("stripe_payment_intent_id");



CREATE INDEX "idx_price_overrides_car_date" ON "public"."car_price_overrides" USING "btree" ("car_id", "date");



CREATE INDEX "idx_turo_bookings_car" ON "public"."turo_bookings" USING "btree" ("car_id", "start_time", "end_time");



CREATE UNIQUE INDEX "ux_bookings_stripe_pi" ON "public"."bookings" USING "btree" ("stripe_payment_intent_id") WHERE ("stripe_payment_intent_id" IS NOT NULL);



CREATE OR REPLACE TRIGGER "trg_bookings_guard_status" BEFORE UPDATE ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."bookings_guard_status"();



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_car_id_fkey" FOREIGN KEY ("car_id") REFERENCES "public"."cars"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."car_blocked_dates"
    ADD CONSTRAINT "car_blocked_dates_car_id_fkey" FOREIGN KEY ("car_id") REFERENCES "public"."cars"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."car_price_overrides"
    ADD CONSTRAINT "car_price_overrides_car_id_fkey" FOREIGN KEY ("car_id") REFERENCES "public"."cars"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."turo_bookings"
    ADD CONSTRAINT "turo_bookings_car_id_fkey" FOREIGN KEY ("car_id") REFERENCES "public"."cars"("id") ON DELETE CASCADE;



CREATE POLICY "Admins can manage blocked dates" ON "public"."car_blocked_dates" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can manage price overrides" ON "public"."car_price_overrides" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can manage turo bookings" ON "public"."turo_bookings" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins have full access" ON "public"."bookings" USING ((("auth"."jwt"() ->> 'email'::"text") = ANY (ARRAY['bluefinbiz@gmail.com'::"text", 'liamjkinney@gmail.com'::"text"])));



CREATE POLICY "Public cars are viewable by everyone" ON "public"."cars" FOR SELECT USING (true);



CREATE POLICY "Users can insert their own bookings" ON "public"."bookings" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own bookings" ON "public"."bookings" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own bookings" ON "public"."bookings" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."car_blocked_dates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."car_price_overrides" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cars" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_delete_admin" ON "public"."profiles" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "profiles_insert_own_no_admin" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "id") AND (COALESCE("is_admin", false) = false)));



CREATE POLICY "profiles_select_owner_or_admin" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "id") OR "public"."is_admin"()));



CREATE POLICY "profiles_update_admin_any" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK (true);



CREATE POLICY "profiles_update_own" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id")) WITH CHECK ((("auth"."uid"() = "id") AND (NOT ("is_admin" IS DISTINCT FROM ( SELECT "p"."is_admin"
   FROM "public"."profiles" "p"
  WHERE ("p"."id" = "p"."id"))))));



ALTER TABLE "public"."turo_bookings" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_complete_bookings"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_complete_bookings"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_complete_bookings"() TO "service_role";



GRANT ALL ON FUNCTION "public"."bookings_guard_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."bookings_guard_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bookings_guard_status"() TO "service_role";



GRANT ALL ON TABLE "public"."cars" TO "anon";
GRANT ALL ON TABLE "public"."cars" TO "authenticated";
GRANT ALL ON TABLE "public"."cars" TO "service_role";



GRANT ALL ON FUNCTION "public"."get_available_cars"("start_ts" timestamp with time zone, "end_ts" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_available_cars"("start_ts" timestamp with time zone, "end_ts" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_available_cars"("start_ts" timestamp with time zone, "end_ts" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_car_unavailability"("car_id_param" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."get_car_unavailability"("car_id_param" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_car_unavailability"("car_id_param" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_user_updated"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_user_updated"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_user_updated"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON TABLE "public"."bookings" TO "anon";
GRANT ALL ON TABLE "public"."bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."bookings" TO "service_role";



GRANT ALL ON TABLE "public"."car_blocked_dates" TO "anon";
GRANT ALL ON TABLE "public"."car_blocked_dates" TO "authenticated";
GRANT ALL ON TABLE "public"."car_blocked_dates" TO "service_role";



GRANT ALL ON TABLE "public"."car_price_overrides" TO "anon";
GRANT ALL ON TABLE "public"."car_price_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."car_price_overrides" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cars_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cars_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cars_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."turo_bookings" TO "anon";
GRANT ALL ON TABLE "public"."turo_bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."turo_bookings" TO "service_role";



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







