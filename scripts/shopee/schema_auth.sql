-- Token Shopee sống trong DB, không sống trong file.
-- Lý do: access_token hết hạn 4h, refresh_token tự đổi mỗi lần refresh. Khi job
-- chạy trên GitHub Actions thì không có chỗ nào ghi lại được (secret chỉ đọc),
-- nên máy nào chạy cũng phải đọc/ghi chung một chỗ = DB.
create table if not exists shopee.oauth_token (
  shop_id       bigint      primary key,
  access_token  text        not null,
  refresh_token text        not null,
  token_at      bigint      not null,          -- epoch giây lúc lấy token
  expire_in     integer     not null default 14400,
  updated_by    text,
  updated_at    timestamptz not null default now()
);
alter table shopee.oauth_token enable row level security;
-- không cấp quyền cho anon/authenticated: chỉ ETL (dùng chuỗi kết nối Postgres) đọc được
revoke all on shopee.oauth_token from anon, authenticated;
