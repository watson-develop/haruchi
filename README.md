# 하루치

초등 2학년 산수 연습 도구. 매일 A4 문제지를 인쇄해 손으로 풀고, 아이패드에서 채점한다.

- 설계: `docs/superpowers/specs/` (전체 설계 + Phase별 설계)
- 인수인계: `docs/superpowers/HANDOFF.md`
- 조사 자료: `docs/reference/` (교육과정·학습지 커리큘럼·통합 사다리·EBS 강좌 매핑)

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
기존 기록에 접근할 수 없다.

JSON 내보내기·가져오기는 주간 리포트 화면(`#/report`)에 있다(Phase 3). 이론상
백업 파일로 기록을 옮길 수는 있지만, 가져오기는 병합이 아니라 **전체 교체**이고
실기기 검증도 아직 절반뿐이다 — 주소를 바꾸지 않는 것이 여전히 첫 번째 보호책이다.
