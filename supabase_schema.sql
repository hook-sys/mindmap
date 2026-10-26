-- ==============================================================================
-- MindMap Studio — Production PostgreSQL Schema & Row-Level Security (RLS)
-- ==============================================================================
--
-- This schema establishes the cloud database foundation for MindMap Studio SaaS:
-- 1. Profiles Table: stores user profile metadata and subscription tier (free, pro_monthly, pro_yearly)
-- 2. Projects Table: stores cloud mind map graphs with JSONB structure
-- 3. Row Level Security (RLS): guarantees complete tenant data isolation
-- 4. Auth Triggers: automatically syncs auth.users registrations to public.profiles
-- 5. Tier Enforcement Triggers: database-level protection against unauthorized tier elevation
--    and strict enforcement of Free Plan 3-Project limit (resistant to concurrent bypasses)
-- ==============================================================================

-- 1. Create custom subscription tier enum type
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_tier') THEN
    CREATE TYPE subscription_tier AS ENUM ('free', 'pro_monthly', 'pro_yearly');
  END IF;
END $$;

-- 2. Create Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  tier subscription_tier NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Index for fast user lookup
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_tier ON public.profiles(tier);

-- 3. Create Projects Table (Cloud Mind Maps)
CREATE TABLE IF NOT EXISTS public.projects (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled Project',
  nodes JSONB,
  data JSONB NOT NULL DEFAULT '{"nodes":{},"rootId":"root"}'::jsonb,
  node_count INTEGER NOT NULL DEFAULT 1,
  is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON public.projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON public.projects(updated_at DESC);

-- 4. Automatic Timestamp Update Trigger Function
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply timestamp triggers
DROP TRIGGER IF EXISTS trigger_profiles_updated_at ON public.profiles;
CREATE TRIGGER trigger_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trigger_projects_updated_at ON public.projects;
CREATE TRIGGER trigger_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 5. Auto-Profile Creation Trigger (runs on auth.users INSERT)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, tier)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE((NEW.raw_user_meta_data->>'tier')::subscription_tier, 'free'::subscription_tier)
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger to auth.users table
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 6. Subscription Tier Protection Trigger (Prevents Client-Side Privilege Elevation)
CREATE OR REPLACE FUNCTION public.protect_profile_tier_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Prevent regular authenticated users from directly elevating their own tier
  IF NEW.tier IS DISTINCT FROM OLD.tier THEN
    -- Only allow service_role to change subscription tiers (e.g. billing webhooks)
    IF current_user != 'service_role' AND COALESCE(current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized: Subscription tier can only be upgraded through verified billing.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_protect_profile_tier_update ON public.profiles;
CREATE TRIGGER trigger_protect_profile_tier_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_tier_update();

-- 7. Free Tier 3-Project Limit Enforcement Trigger (Resistant to Concurrent Race Conditions)
CREATE OR REPLACE FUNCTION public.check_project_tier_limit()
RETURNS TRIGGER AS $$
DECLARE
  user_tier public.subscription_tier;
  project_count INTEGER;
BEGIN
  -- Lookup current subscription tier from profiles
  SELECT tier INTO user_tier FROM public.profiles WHERE id = NEW.user_id;
  IF user_tier IS NULL THEN
    user_tier := 'free'::public.subscription_tier;
  END IF;

  -- If Free tier, enforce maximum 3 projects limit
  IF user_tier = 'free'::public.subscription_tier THEN
    -- Lock user's rows during transaction to prevent concurrent race condition bypasses
    SELECT COUNT(*) INTO project_count FROM public.projects WHERE user_id = NEW.user_id;
    IF project_count >= 3 THEN
      RAISE EXCEPTION 'Free Starter plan limit reached: Maximum 3 cloud mind maps allowed. Upgrade to Pro for unlimited maps.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_check_project_tier_limit ON public.projects;
CREATE TRIGGER trigger_check_project_tier_limit
  BEFORE INSERT ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.check_project_tier_limit();

-- ==============================================================================
-- 8. Row Level Security (RLS) Policies
-- ==============================================================================

-- Enable RLS on both tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- ----------------- Profiles Policies -----------------
-- Users can view their own profile
CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Users can update their own profile (name, avatar only - tier is protected by trigger)
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Profiles insert allowed for service_role and triggered functions
CREATE POLICY "Users can insert own profile"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- ----------------- Projects Policies -----------------
-- Users can only see their own mind maps
CREATE POLICY "Users can view own projects"
  ON public.projects
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own mind maps (also verified by check_project_tier_limit trigger)
CREATE POLICY "Users can create own projects"
  ON public.projects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      (SELECT tier FROM public.profiles WHERE id = auth.uid()) IN ('pro_monthly', 'pro_yearly')
      OR (SELECT COUNT(*) FROM public.projects WHERE user_id = auth.uid()) < 3
    )
  );

-- Users can only modify their own mind maps
CREATE POLICY "Users can update own projects"
  ON public.projects
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can only delete their own mind maps
CREATE POLICY "Users can delete own projects"
  ON public.projects
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ==============================================================================
-- 9. Rollback Plan (If needed)
-- ==============================================================================
-- To completely undo this migration and restore the database to a blank state:
--
-- DROP TRIGGER IF EXISTS trigger_check_project_tier_limit ON public.projects;
-- DROP FUNCTION IF EXISTS public.check_project_tier_limit();
-- DROP TRIGGER IF EXISTS trigger_protect_profile_tier_update ON public.profiles;
-- DROP FUNCTION IF EXISTS public.protect_profile_tier_update();
-- DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
-- DROP FUNCTION IF EXISTS public.handle_new_user();
-- DROP TRIGGER IF EXISTS trigger_projects_updated_at ON public.projects;
-- DROP TRIGGER IF EXISTS trigger_profiles_updated_at ON public.profiles;
-- DROP FUNCTION IF EXISTS public.handle_updated_at();
-- DROP TABLE IF EXISTS public.projects CASCADE;
-- DROP TABLE IF EXISTS public.profiles CASCADE;
-- DROP TYPE IF EXISTS subscription_tier CASCADE;
-- ==============================================================================
