-- Revert Script: Drop Tables and Policies
-- This will delete all data in the 'cards' and 'decks' tables!

-- Drop Tables (Use CASCADE to drop associated policies and constraints)
drop table if exists public.cards cascade;
drop table if exists public.decks cascade;

-- (Optional) If you manually created storage policies, you can drop them:
-- drop policy if exists "Users can upload their own images" on storage.objects;
-- drop policy if exists "Users can view their own images" on storage.objects;
-- drop policy if exists "Users can delete their own images" on storage.objects;
