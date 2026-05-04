# Tạo Icon cho PWA

## Cách 1: Dùng online tool (Nhanh nhất)
1. Vào https://realfavicongenerator.net/
2. Upload file `public/icon.svg`
3. Download và copy các file icon vào folder `public/`

## Cách 2: Dùng ImageMagick (Nếu đã cài)
```bash
# Cài ImageMagick trước
# Windows: choco install imagemagick
# Mac: brew install imagemagick

# Tạo icon 192x192
magick convert public/icon.svg -resize 192x192 public/icon-192.png

# Tạo icon 512x512
magick convert public/icon.svg -resize 512x512 public/icon-512.png
```

## Cách 3: Tạm thời dùng placeholder
Tạo file PNG đơn giản bằng Paint/Photoshop với:
- 192x192px (icon-192.png)
- 512x512px (icon-512.png)
- Nền xanh #3B82F6
- Chữ "A" màu trắng ở giữa
