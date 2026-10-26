# MindMap Studio — Supabase Cloud Integration & Setup Guide

This guide walks you through connecting **Supabase PostgreSQL & Auth** to MindMap Studio.

---

## 1. Overview & Architecture

MindMap Studio uses a dual-engine storage architecture:
- **Local/Offline Engine:** Native local HTTP server + browser `localStorage` (100% offline-ready, no credentials required).
- **Cloud Engine:** Supabase PostgreSQL with Row Level Security (RLS) + Supabase Auth.
- **Data Protection:** Local mind maps are **never** deleted or overwritten when signing into or importing to the cloud. Local projects always remain safe on your device.

---

## 2. Step-by-Step Setup Instructions

### Step 1: Create a Supabase Project
1. Go to [https://supabase.com](https://supabase.com) and sign in.
2. Click **New Project**.
3. Enter a project name (e.g., `mindmap-studio`), set a secure database password, and choose your preferred region.
4. Wait for the project initialization to complete (~1-2 minutes).

---

### Step 2: Deploy the Database Schema & Security Policies
1. In your Supabase dashboard, click **SQL Editor** from the left navigation menu.
2. Click **New Query**.
3. Open the [`supabase_schema.sql`](file:///c:/Users/lenovo/Desktop/mindmap/supabase_schema.sql) file from this repository and copy its entire content.
4. Paste the SQL code into the Supabase SQL Editor.
5. Click **Run** (green button).

**What gets created:**
- `subscription_tier` enum (`free`, `pro_monthly`, `pro_yearly`).
- `public.profiles` table (linked to `auth.users` via foreign key).
- `public.projects` table (stores mind map tree structures with JSONB).
- `handle_new_user()` trigger (automatically creates user profile on signup).
- `protect_profile_tier_update()` trigger (blocks client-side subscription tampering).
- `check_project_tier_limit()` trigger (enforces max 3 cloud projects for Free tier).
- Row Level Security (RLS) policies for complete tenant data isolation.

---

### Step 3: Obtain Supabase Credentials
In your Supabase dashboard, navigate to **Project Settings** -> **API**:
1. **Project URL:** e.g., `https://abcdefghijklm.supabase.co`
2. **Project API Keys:**
   - `anon` (public): Starts with `eyJ...` (Safe for browser/frontend).
   - `service_role` (secret): **Never** expose in frontend or client code!
3. **JWT Settings:** Under **Project Settings** -> **API** -> **JWT Settings**:
   - `JWT Secret`: Used server-side for Super Admin JWT cryptographic verification.

---

### Step 4: Configure Environment Variables

#### For Vercel Production Deployment:
Go to your project on Vercel -> **Settings** -> **Environment Variables**, and add:

| Variable Name | Value | Scope | Description |
| :--- | :--- | :--- | :--- |
| `SUPABASE_URL` | `https://your-id.supabase.co` | Production, Preview, Dev | Public project URL |
| `SUPABASE_ANON_KEY` | `eyJhbGci...` | Production, Preview, Dev | Public anon key |
| `SUPABASE_JWT_SECRET` | `your-jwt-secret` | Production, Preview, Dev | Server-side JWT signature verification |
| `ADMIN_SECRET_KEY` | *(Optional secret)* | Production, Preview, Dev | Super admin fallback access |
| `ADMIN_EMAILS` | `admin@yourdomain.com` | Production, Preview, Dev | Super admin email whitelist |

#### For Local Development:
You can either:
- Set environment variables in your terminal before running `npm start`.
- Copy `supabase-config.example.js` to `supabase-config.js` and add your `url` and `anonKey`.
- Or click the **Cloud Connection Settings** button inside the web app dropdown and enter your Project URL and Anon Key.

---

## 3. Preserving Existing Local Mind Maps

MindMap Studio guarantees that your existing local work is never lost:
1. When you sign in to your cloud account, your local maps remain safely in local storage.
2. Open the user menu at the top right and click **"Import Local Maps to Cloud"**.
3. A non-destructive preview dialog will appear displaying all detected local mind maps.
4. Clicking **"Import Copies to Cloud (Safe)"** creates safe cloud copies linked to your Supabase account.
5. Your local maps remain completely untouched and can still be accessed anytime in **Local Guest Mode**.

---

## 4. Rollback Plan

If you ever need to reset or roll back the Supabase database:
1. Open Supabase **SQL Editor**.
2. Run the rollback script located in Section 9 of [`supabase_schema.sql`](file:///c:/Users/lenovo/Desktop/mindmap/supabase_schema.sql#L225):

```sql
DROP TRIGGER IF EXISTS trigger_check_project_tier_limit ON public.projects;
DROP FUNCTION IF EXISTS public.check_project_tier_limit();
DROP TRIGGER IF EXISTS trigger_protect_profile_tier_update ON public.profiles;
DROP FUNCTION IF EXISTS public.protect_profile_tier_update();
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP TRIGGER IF EXISTS trigger_projects_updated_at ON public.projects;
DROP TRIGGER IF EXISTS trigger_profiles_updated_at ON public.profiles;
DROP FUNCTION IF EXISTS public.handle_updated_at();
DROP TABLE IF EXISTS public.projects CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TYPE IF EXISTS subscription_tier CASCADE;
```
