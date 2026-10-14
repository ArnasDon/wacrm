-- Presence can update only the authenticated caller's row. The function
-- derives the caller and account from the transaction-local identity.
GRANT EXECUTE ON FUNCTION public.touch_presence(text) TO omni_app;
