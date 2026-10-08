# art-src

GPT로 만든 풍경 원본 이미지를 여기에 둔다. 파일명이 레이어 이름이다.

- `sky.png` : 하늘 (배경 전체를 채운다)
- `far.png`, `mid.png`, `near.png` : 원경/중경/근경. **배경은 순수 마젠타 `#FF00FF`** 로 칠해야 한다 (그 부분이 투명 처리됨).
- 확장자는 png / jpg / webp 모두 가능. 없는 레이어는 건너뛴다.
- 가로로 긴 이미지를 권장한다. 높이가 180px이 되도록 축소되고, 폭이 540px 미만이면 좌우를 거울 반사로 채운다.

변환 (모든 레이어를 다시 처리하고 하나의 48색 팔레트로 통일):

```
python3 scripts/import_art.py
```

결과는 `public/art/vista-<layer>.png` 와 `public/art/manifest.json`.
