#!/usr/bin/env bash
# Build và đẩy bản tĩnh lên nhánh gh-pages.
#
# Vì sao không dùng GitHub Actions: token của account sleepexpert2012-oss không có
# scope `workflow` nên GitHub từ chối nhận file .github/workflows/*. Cách này chỉ cần
# scope `repo`. Muốn quay lại Actions thì chạy:
#     gh auth refresh -h github.com -u sleepexpert2012-oss -s workflow
# rồi copy scripts/pages/github-actions-deploy.yml.txt -> .github/workflows/deploy.yml
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
