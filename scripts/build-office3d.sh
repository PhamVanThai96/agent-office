#!/bin/bash
# Gộp toàn bộ mã văn phòng 3D (hàng trăm module ES) + three.js thành MỘT file nén public/office3d/dist/boot.js để trang tải nhanh.
# Chạy lại sau khi sửa bất kỳ file nào trong public/office3d/js/, bridge.js hoặc boot.js. Cần Internet lần đầu (npx tải esbuild, không cài vào dự án).
set -e
cd "$(dirname "$0")/../public/office3d"
${ESBUILD:-npx --yes esbuild} boot.js --bundle --minify --format=esm --target=es2022 --legal-comments=none \
  --alias:three=./vendor/three/three.module.js --alias:three/addons=./vendor/three/addons \
  --define:process.env.NEXT_PUBLIC_OFFICE_STATIC="''" --define:process.env.NEXT_PUBLIC_BASE_PATH="'/office3d'" --define:process.env.NEXT_PUBLIC_SITE_ROOT="''" \
  --outfile=dist/boot.js
# đóng dấu phiên bản vào địa chỉ tệp: trình duyệt từng lưu bản cũ của dist/boot.js (cache 1 giờ) sẽ tải bản mới ngay
V=$(shasum dist/boot.js | cut -c1-8)
sed -i.bak -E "s#dist/boot\.js(\?v=[0-9a-f]+)?#dist/boot.js?v=$V#g" index.html ../index.html
sed -i.bak -E "s#office3d/(\?v=[0-9a-f]+)?'#office3d/?v=$V'#g" ../index.html
rm -f index.html.bak ../index.html.bak
echo "phiên bản $V"
ls -la dist/boot.js
