#!/usr/bin/env bash
# Build và đẩy bản tĩnh lên nhánh gh-pages.
#
# Đây là đường chạy TAY. Bình thường .github/workflows/etl.yml lo việc này: Actions
# kéo dữ liệu Shopee rồi build + deploy luôn, 3 khung giờ mỗi ngày.
# Dùng script này khi cần deploy ngay mà không chờ lượt, ví dụ vừa sửa code hoặc
# vừa đổi Master Data. Chỉ cần token scope `repo`.
set -euo pipefail
cd "$(dirname "$0")/../.."

REPO=$(basename "$(git rev-parse --show-toplevel)")
echo "==> Build với base=/$REPO/"
PAGES_BASE="/$REPO/" npm run build

echo "==> Đẩy dist/ lên nhánh gh-pages"
rm -rf .deploy && mkdir .deploy
cp -R dist/. .deploy/
touch .deploy/.nojekyll          # để GitHub không bỏ qua file bắt đầu bằng _
cd .deploy
git init -q
git checkout -qb gh-pages
git add -A
git -c user.name="SELTD Supply Chain" -c user.email="it@sleepexpert.com.vn" \
    commit -q -m "Deploy $(date '+%Y-%m-%d %H:%M')"
git remote add origin "$(cd .. && git remote get-url origin)"
git push -q --force origin gh-pages
cd ..
rm -rf .deploy
echo "==> Xong: https://sleepexpert2012-oss.github.io/$REPO/"
