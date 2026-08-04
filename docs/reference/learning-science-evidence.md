# 학습과학 근거 ↔ 하루치 엔진 매핑

조사: 2026-08-04. 초등 대상 학습·수학 연구(주로 2020년 이후 메타분석·대규모 RCT)를
"근거 → 엔진의 어느 결정을 뒷받침하는가"로 정리한다. **지속 업데이트 자산이다** —
새 조사를 하면 여기에 누적하고, 엔진 결정이 근거를 얻거나 잃으면 표를 고친다.
EBS 매핑 문서(`ebs-manjeomwang-lecture-mapping.md`)와 같은 취급.

효과크기 읽는 법: g(Hedges)·d(Cohen) 모두 0.2 작음·0.5 중간·0.8 큼이 관례.
연구자 자체 제작 검사는 표준화 검사보다 효과가 크게 나오는 경향이 있어(§4 참고)
숫자를 액면 그대로 비교하지 않는다.

## 1. 기존 설계가 이미 부합하는 것 (바꾸지 말 것)

| 엔진의 결정                                             | 근거                                                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 구구단 간격 사다리 1→3→7→14 (`facts.ts`)                | 분산연습 g = 0.28, 수업 내장형이 가장 견고 — Murray et al. 2025 [^spacing]               |
| 반응시간 기반 스프린트(시간 제한 유창성 활동)           | WWC 2021 권고 6번(timed activities) [^wwc]                                               |
| 매일 1장, 꾸준한 회차 (`streak.ts`)                     | 30회 이상 세션 > 10회 미만 — Douglas et al. 2026 [^fluency]                              |
| 문장제를 연산과 별도 트랙으로 2문항 고정 (`compose.ts`) | 유창성 훈련은 문장제로 **전이되지 않음** — Douglas et al. 2026 [^fluency]                |
| 덧뺄셈(세로셈)과 곱셈(스프린트)을 함께 훈련             | 덧셈계열+곱셈계열 혼합 중재 > 단일 계열 — Douglas et al. 2026 [^fluency]                 |
| 문장제 그림 칸 + 라벨 (2026-08 커밋)                    | 그래픽 조직자 + 반구체 표상이 최상위 조합의 구성요소 — 네트워크 메타분석 2025 [^network] |
| □ 채우기 첫 문항 힌트 (`inverseHint`)                   | 예시 풀이 g = 0.48 — Barbieri et al. 2023 [^worked] (부분 부합)                          |

## 2. 2026-08-04 설계로 차용한 것

스펙: `docs/superpowers/specs/2026-08-04-interleave-review-slot-design.md`

| 변경                                     | 근거                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| 세로셈 교차 제약 (인접 동일 tag 금지)    | 교차연습 군집 RCT d = 0.83 (61% vs 38%) — Rohrer et al. 2020 [^rohrer]. **주의: 중학생 대상** |
| 마스터 유형 복습 슬롯 (기회형, 3일 간격) | 분산연습 g = 0.28 — Murray et al. 2025 [^spacing]. 우연 복습(weight 0.1)을 설계된 복습으로    |

## 3. 미착수 후보 (차용하려면 별도 브레인스토밍)

| 후보                                                       | 근거                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| 새 세로셈 유형 도입 구간에 예시 풀이 / "틀린 곳 찾기" 문항 | g = 0.48, 오답 예시는 검증된 변형 — Barbieri et al. 2023 [^worked]        |
| 문장제 스키마 회전 (합병/변화/비교 분류·추적·가중)         | 스키마 기반 지도가 최상위 조합의 핵심 — 네트워크 메타분석 2025 [^network] |
| 비교 스키마 문장제의 그림 칸에 수직선                      | WWC 2021 권고 4번(number lines) [^wwc]                                    |
| 문제 만들기 문항 (주 1회, 2장 마지막)                      | problem-posing 메타분석 — JRME 2025 [^posing]                             |

## 4. 경계할 것 (근거가 말리는 방향)

- **인출연습 자체는 수학에서 근거가 약하다**: g = 0.18, CI가 0을 포함 — Murray et al.
  2025 [^spacing]. 스프린트의 효과는 "퀴즈여서"가 아니라 **간격**에서 나온다고 보는 게
  안전하다. 퀴즈형 기능을 늘리는 것보다 사다리를 다듬는 쪽이 남는 장사.
- **문장제 g = 0.95는 부풀려졌을 가능성**: 연구자 자체 검사·질 낮은 연구에서 효과가
  크게 나왔다고 저자들이 직접 경고 — Vessonen et al. 2025 [^word]. "문장제 중재는
  효과 있다"까지만 믿고 특정 기법의 크기 비교에는 신중하게.
- **성취를 올리는 건 기능 훈련, 불안을 줄이는 건 정서 개입** — 서로 다른 처방이다
  (성취: 기능 g = 0.76 vs 정서 0.12) [^anxiety]. 하루치는 저부담(아빠 채점, 등수 없음)
  구조를 유지하되, 시간 압박이 불안을 키우는 조짐이 보이면 스프린트의 실패 경험
  설계를 부드럽게.
- **유창성 중재의 예측구간은 −0.60~2.12로 매우 넓다** [^fluency] — 평균 효과크기가
  커도 "누구에게나 통한다"는 뜻이 아니다. 아이의 실측(리포트)이 항상 우선한다.

## 5. 국내 연구 (참고)

- 자기조절학습 프로그램 메타분석(교육심리연구, 2024): 국내 92편, 전체 효과 .50.
- 수학불안↔수학성취 메타분석(청소년문화포럼): 2000~2024 국내 39편, r = −.26.

## 출처

[^spacing]: Murray, Horner, & Göbel (2025). A meta-analytic review of the effectiveness of spacing and retrieval practice for mathematics learning. _Educational Psychology Review_, 37, 75. 분산 27편/53 ES, 인출 7편/32 ES. <https://link.springer.com/article/10.1007/s10648-025-10035-1>

[^rohrer]: Rohrer, Dedrick, Hartwig, & Cheung (2020). A randomized controlled trial of interleaved mathematics practice. _Journal of Educational Psychology_, 112(1), 40–52. 사전등록 군집 RCT, 5개교 54학급 787명, 1개월+ 지연 시험. <https://gwern.net/doc/psychology/spaced-repetition/2019-rohrer.pdf> (IES 지원 대규모 반복연구 진행 중: <https://ies.ed.gov/use-work/awards/efficacy-study-interleaved-mathematics-practice>)

[^fluency]: Douglas, Myers, Mason, Powell, & Lariviere (2026). A meta-analysis of mathematics fact fluency interventions for students with mathematics difficulties. _Journal of Learning Disabilities_, 59(3), 135–160. 35편/178 ES, g = 0.76, PI −0.60~2.12. 무료 전문: <https://pmc.ncbi.nlm.nih.gov/articles/PMC13069136/>

[^word]: Vessonen, Hellstrand, Kurkela, Aunio, & Laine (2025). The effectiveness of mathematical word problem-solving interventions among elementary schoolers. _International Journal of Educational Research_, 132. 114편/531 ES, 초등 1~6학년 20,456명, g = 0.95(주의사항 §4). <https://www.sciencedirect.com/science/article/pii/S0883035525001168>

[^network]: Exploring the effectiveness of word-problem strategy and strategy combinations: A systematic review and network meta-analysis (2025). _Educational Psychology Review_. 52편, 6,900명+. 최상위 조합: CSA + 그래픽 조직자 + 메타인지 + 스키마 기반. <https://link.springer.com/article/10.1007/s10648-025-10057-9>

[^worked]: Barbieri et al. (2023). A meta-analysis of the worked examples effect on mathematics performance. _Educational Psychology Review_. 43논문/55연구/181 ES, g = 0.48. <https://link.springer.com/article/10.1007/s10648-023-09745-1>

[^wwc]: What Works Clearinghouse (2021). Assisting students struggling with mathematics: Intervention in the elementary grades. WWC 2021006. 6개 권고: 체계적 지도 / 수학 언어 / 반구체 표상 / 수직선 / 문장제 전략 / 시간 제한 유창성 활동. <https://ies.ed.gov/ncee/wwc/Docs/PracticeGuide/WWC2021006-Math-PG.pdf>

[^posing]: Effects of engaging in problem-posing interventions on learners' cognitive mathematics outcomes (2025). _Journal for Research in Mathematics Education_, 56(5). <https://pubs.nctm.org/view/journals/jrme/56/5/article-p259.xml>

[^anxiety]: Meta-analysis of skill-based and therapeutic interventions to address math anxiety (2023). _Journal of School Psychology_. K-12 17편 1,786명. 불안 감소: 정서 −0.51 vs 기능 −0.32 / 성취 향상: 기능 0.76 vs 정서 0.12. <https://pubmed.ncbi.nlm.nih.gov/37689437/>
