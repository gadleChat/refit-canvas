# 소스 재빌드

배포된 앱 실행에는 이 과정이 필요 없다. 편집하려는 개발자만 Node.js와 npm을 사용한다.

source 폴더에서:

```sh
npm ci --ignore-scripts
npm run build
```

esbuild 플랫폼 패키지가 정상 설치된 환경에서 작동한다. 빌드는 다음을 수행한다.

1. vendor/SDStudio의 원본 BrushTool.tsx에서 export된 이미지·마스크 함수를 그대로 추출한다.
2. 원본 nai.ts와 의존 모듈을 standalone 호스트 어댑터와 함께 번들링한다.
3. ../static/sdstudio-core.js 및 소스맵을 만든다.

실제 원본 코드는 수정하지 않았다. 변경한다면 UPSTREAM.json의 원본 해시를 덮어쓰기보다 변경 내역을 별도로 남겨 구분한다.

부모 앱 폴더의 Python 검사:

```sh
python -m unittest discover -s tests -v
```

SOURCE_PROVENANCE.md에서 모듈별 역할을 확인할 수 있다.
