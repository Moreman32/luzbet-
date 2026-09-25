-- local E2E users: owner "dima" / player "vasya", password "password123"
do $$
declare o uuid := gen_random_uuid(); p uuid := gen_random_uuid();
begin
  insert into auth.users(id,email,encrypted_password,aud,role,email_confirmed_at) values
    (o,'p_owner0001@players.luzbet.invalid',extensions.crypt('password123',extensions.gen_salt('bf')),'authenticated','authenticated',now()),
    (p,'p_player001@players.luzbet.invalid',extensions.crypt('password123',extensions.gen_salt('bf')),'authenticated','authenticated',now());
  perform public.svc_create_profile(null,o,'dima','Дмитрий Н.','owner',1000,2,false);
  perform public.svc_create_profile(o,p,'vasya','Вася','player',1000,null,true);
end $$;
