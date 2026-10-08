-- Social provider ids remain to preserve secure account linking and duplicate protection.
-- Display/profile claims are not needed after account creation and are removed.
update public.user_identities
set username = null,
    display_name = null,
    avatar_url = null,
    email = null,
    phone = null,
    metadata = case when provider = 'telegram' and metadata ? 'telegramBotUserId'
      then jsonb_build_object('telegramBotUserId', metadata->'telegramBotUserId')
      else '{}'::jsonb end
where provider in ('telegram', 'max')
  and (username is not null or display_name is not null or avatar_url is not null
    or email is not null or phone is not null
    or metadata <> case when provider = 'telegram' and metadata ? 'telegramBotUserId'
      then jsonb_build_object('telegramBotUserId', metadata->'telegramBotUserId')
      else '{}'::jsonb end);
