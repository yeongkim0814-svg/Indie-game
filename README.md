# Indie Game

모바일 브라우저(갤럭시) 우선 3D 오픈월드 어드벤처. 운동량 발사기(반동 질량 발사)가 핵심 이동·상호작용. 기획은 `GAME_PLAN.md` 참고.

## 개발
```
npm install
npm run dev          # 로컬 개발 서버 (폰에서 같은 네트워크로 접속 가능)
npm test             # 물리 단위 테스트(Vitest)
npm run build        # 타입체크 + 빌드
npm run check:webgl  # 헤드리스 Chromium으로 WebGL 렌더/오류 확인, screenshots/m0.png 생성
```
