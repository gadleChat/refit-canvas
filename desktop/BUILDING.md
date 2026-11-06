# 데스크톱 빌드

Node 22.12+가 필요합니다. 일반 사용자에게는 Node 설치가 필요 없습니다.

1. source/에서 npm ci --ignore-scripts 후 npm run build 및 npm run test:mask 실행.
2. desktop/에서 npm ci --ignore-scripts 실행.
3. desktop/에서 npm run package:win 실행. 공식 Electron 45.2.0 Windows x64 런타임을 다운로드하며 dist/에 앱을 만듭니다.

Python embedded runtime은 ../runtime에 있어야 합니다. 배포 ZIP의 resources/backend/runtime을 소스 폴더의 runtime으로 복사하면 됩니다. server.py/api.py/static도 ../에 있어야 하며 source-code에 포함되어 있습니다.

개발 중 npm start는 설치된 현재 운영체제 Electron을 사용합니다. 서버는 Windows에선 내장 Python을, 다른 운영체제에선 시스템 python3를 사용합니다.

빌드한 EXE는 코드 서명되지 않았습니다. Electron 공식 런타임 라이선스 및 Chromium 고지를 그대로 함께 배포해야 합니다. 원본 SDStudio와 번들 라이브러리의 라이선스도 보존하세요.
