-- Legacy username contacts were sometimes stored with a literal `hidden`
-- phone value. It is not a usable identity; normalize it to the nullable
-- representation introduced by 041 so it cannot be displayed or selected as
-- a phone recipient.
UPDATE contacts
SET phone = NULL
WHERE lower(trim(phone)) IN ('hidden', 'phone hidden');
