-- Repair missing PostgREST table privileges for ASTRA's authenticated browser client.
-- Row Level Security policies remain enabled and continue restricting every row to auth.uid().

grant usage on schema public to authenticated;

grant select, insert, update, delete
  on table public.astra_conversations
  to authenticated;

grant select, insert, delete
  on table public.astra_messages
  to authenticated;

grant execute on function public.astra_search_messages(uuid, text, integer)
  to authenticated;
