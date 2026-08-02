# 하루치

초등 2학년 산수 연습 도구. 매일 A4 문제지를 인쇄해 손으로 풀고, 아이패드에서 채점한다.

- 설계: `docs/superpowers/specs/2026-08-02-haruchi-design.md`
- 계획: `docs/superpowers/plans/`

## 개발

```bash
mise install
npm ci
npm run dev      # http://localhost:5173/haruchi/
npm test
npm run build
```

## 배포

`main`에 push하면 GitHub Actions가 테스트 → 빌드 → GitHub Pages 배포를 수행한다.

**배포 URL은 변경하지 않는다.** 데이터가 origin별 IndexedDB에 저장되므로 주소가 바뀌면
기존 기록에 접근할 수 없다. 옮겨야 한다면 옛 주소에서 JSON을 내보내 새 주소에서 가져온다.
